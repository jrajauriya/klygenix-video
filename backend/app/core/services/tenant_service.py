"""Onboarding a customer: the tenant, its owner, its modules and its feature matrix.

One place creates a tenant. The master estate has two — this service and a seeder in
main.py — and they disagree about which modules exist and what a new tenant gets.
"""

import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.core.models.tenant import Tenant, TenantModule
from app.core.models.tenant_feature import TenantFeature
from app.core.models.user import User
from app.core.models.role_permission import RolePermission
from app.core.services.auth_service import hash_password
from app.core.services.feature_catalog import all_feature_keys, GATEABLE_APPS
from app.core.services.permission_defaults import defaults_for_app

# Every product this platform sells. One list, imported everywhere it is needed.
MODULES = ["video"]

DEFAULT_PASSWORD = "welcome@123"
DEFAULT_LICENSE_DAYS = 365


def create_tenant_with_admin(
    db: Session,
    *,
    name: str,
    slug: str,
    owner_email: str,
    owner_name: str,
    products: list[str] | None = None,
    plan: str = "standard",
    max_users: int = 5,
    license_end: date | None = None,
    password: str | None = None,
    verified: bool = True,
    **fields,
) -> tuple[Tenant, User, str]:
    """Create the tenant, its owner and its access rows in one transaction.

    Returns (tenant, owner, plaintext_password). The password is returned once, for the
    welcome email, and never stored in the clear.
    """
    products = products or ["video"]
    password = password or (DEFAULT_PASSWORD if settings.SANDBOX_ENABLED else secrets.token_urlsafe(12))

    # Check before creating anything: email is globally unique, and a half-created
    # tenant with no owner is worse than a refusal.
    if db.query(User).filter(User.email == owner_email).first():
        raise HTTPException(status_code=400, detail=f"{owner_email} already has an account")
    if db.query(Tenant).filter(Tenant.slug == slug).first():
        raise HTTPException(status_code=400, detail=f"The slug '{slug}' is taken")

    # Caller-supplied columns win over the defaults, so passing license_start does not
    # collide with the default below.
    columns = {
        "plan": plan,
        "max_users": max_users,
        "license_start": date.today(),
        "license_end": license_end or (date.today() + timedelta(days=DEFAULT_LICENSE_DAYS)),
        "is_active": True,
    }
    columns.update({k: v for k, v in fields.items() if v is not None and hasattr(Tenant, k)})
    tenant = Tenant(name=name, slug=slug, verified_at=datetime.now(timezone.utc) if verified else None, **columns)
    db.add(tenant)
    db.flush()

    for module in MODULES:
        db.add(
            TenantModule(
                tenant_id=tenant.id,
                module_name=module,
                is_enabled=module in products,
            )
        )

    # Max-permissive: every menu of every purchased app starts on, and the global admin
    # unchecks what the customer did not buy.
    for app in products:
        if app not in GATEABLE_APPS:
            continue
        for key in all_feature_keys(app):
            db.add(TenantFeature(tenant_id=tenant.id, feature_key=key, is_enabled=True))

    owner = User(
        tenant_id=tenant.id,
        email=owner_email,
        name=owner_name,
        password_hash=hash_password(password),
        role="owner",
        products=products,
        is_active=True,
        email_verified_at=datetime.now(timezone.utc) if verified else None,
    )
    db.add(owner)

    for app in list(products) + ["admin"]:
        if app not in ("admin", *GATEABLE_APPS):
            continue
        for role in ("admin", "user"):
            for key, level in defaults_for_app(app, role).items():
                db.add(
                    RolePermission(
                        tenant_id=tenant.id,
                        role=role,
                        permission_key=key,
                        access_level=level,
                    )
                )

    _provision_product(db, tenant)
    db.commit()
    db.refresh(tenant)
    db.refresh(owner)
    return tenant, owner, password


def _provision_product(db: Session, tenant: Tenant) -> None:
    """Give the new tenant its store — handle, chart of accounts, store page — in the same
    transaction (Pay's lesson: what a tenant needs before its first piece of work belongs in
    provisioning, run for every tenant). The rows are tenant-scoped under RLS, so the session
    acts as the new tenant for the duration and then goes back to whoever it was acting as."""
    from sqlalchemy import text

    from app.video.services.provisioning import provision

    previous = db.info.get("tenant_id")
    db.info["tenant_id"] = tenant.id
    db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    try:
        provision(db, tenant)
    finally:
        if previous is None:
            db.info.pop("tenant_id", None)
        else:
            db.info["tenant_id"] = previous
        db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(previous or "")})
