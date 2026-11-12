import secrets
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.core.models.user import User
from app.core.models.tenant import Tenant, TenantModule, TenantPayment, CustomField
from app.core.models.tenant_feature import TenantFeature
from app.core.schemas.tenant import (
    PaymentCreate,
    PaymentOut,
    TenantCreate,
    TenantResponse,
    TenantUpdate,
)
from app.config import settings
from app.core.middleware.auth import require_admin_tenant
from app.core.services.tenant_service import create_tenant_with_admin
from app.core.services.auth_service import hash_password
from app.core.services.email_service import send_email
from app.core.services.welcome_email import build_welcome_html
from app.core.services.feature_catalog import (
    FEATURE_CATALOG,
    GATEABLE_APPS,
    all_feature_keys,
    is_known_feature,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class TenantFeaturesUpdate(BaseModel):
    features: dict[str, bool]


class AdminStatsOut(BaseModel):
    total_tenants: int
    active_tenants: int
    expired_tenants: int
    total_revenue_minor: int
    currency: str
    recent_onboardings: list[TenantResponse]


class ModuleToggle(BaseModel):
    module_name: str
    is_enabled: bool


class ModuleOut(BaseModel):
    tenant_id: int
    module_name: str
    is_enabled: bool


class PasswordResetOut(BaseModel):
    ok: bool
    email_sent: bool
    message: str


class FeaturesSavedOut(BaseModel):
    ok: bool
    saved: int


def _tenant_response(tenant: Tenant) -> TenantResponse:
    resp = TenantResponse.model_validate(tenant)
    resp.products = [m.module_name for m in tenant.modules if m.is_enabled]
    owner = next((u for u in tenant.users if u.role == "owner"), None)
    if owner:
        resp.owner_name = owner.name
        resp.owner_email = owner.email
    return resp


@router.get("/stats", response_model=AdminStatsOut)
def admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.dashboard")),
):
    total = db.query(func.count(Tenant.id)).scalar()
    active = db.query(func.count(Tenant.id)).filter(
        Tenant.is_active == True, Tenant.license_end >= date.today()
    ).scalar()
    expired = total - active
    revenue = db.query(func.coalesce(func.sum(TenantPayment.amount_minor), 0)).scalar()
    recent = (
        db.query(Tenant)
        .order_by(Tenant.created_at.desc())
        .limit(5)
        .all()
    )
    return {
        "total_tenants": total,
        "active_tenants": active,
        "expired_tenants": expired,
        "total_revenue_minor": int(revenue),
        # One currency, because the licence is priced in one. A second would need the
        # column to be read per row rather than summed.
        "currency": "INR",
        "recent_onboardings": [_tenant_response(t) for t in recent],
    }


@router.get("/tenants", response_model=list[TenantResponse])
def list_tenants(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.tenants")),
):
    tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    return [_tenant_response(t) for t in tenants]


@router.post("/tenants", response_model=TenantResponse)
def create_tenant(
    data: TenantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_tenant("admin.tenants", "full")),
):
    existing = db.query(Tenant).filter(Tenant.slug == data.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="Slug already exists")

    # Build kwargs, only include license dates if provided
    extra = {}
    if data.license_start:
        extra["license_start"] = data.license_start
    if data.license_end:
        extra["license_end"] = data.license_end

    tenant, owner, plaintext_password = create_tenant_with_admin(
        db,
        name=data.name,
        slug=data.slug,
        owner_email=data.owner_email,
        owner_name=data.owner_name,
        products=data.products,
        plan=data.plan,
        gst_number=data.gst_number,
        address=data.address,
        city=data.city,
        state=data.state,
        phone=data.phone,
        email=data.email,
        max_users=data.max_users,
        **extra,
    )

    # Send welcome email (never fail tenant creation due to email)
    try:
        html = build_welcome_html(
            user_name=owner.name,
            email=owner.email,
            password=plaintext_password,
            login_url=settings.APP_LOGIN_URL,
            tenant_name=tenant.name,
            products=data.products,
        )
        send_email(
            db=db,
            to_email=owner.email,
            subject="Welcome",
            body_html=html,
            tenant_name=tenant.name,
            cc_emails=[current_user.email, settings.SMTP_FROM_EMAIL],
        )
    except Exception:
        pass

    return _tenant_response(tenant)


@router.get("/tenants/{tenant_id}", response_model=TenantResponse)
def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.tenants")),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return _tenant_response(tenant)


@router.patch("/tenants/{tenant_id}", response_model=TenantResponse)
def update_tenant(
    tenant_id: int,
    data: TenantUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.tenants", "full")),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    updates = data.model_dump(exclude_unset=True)

    # Handle owner fields separately (they belong to the User, not Tenant)
    owner_name = updates.pop("owner_name", None)
    owner_email = updates.pop("owner_email", None)
    if owner_name is not None or owner_email is not None:
        owner = next((u for u in tenant.users if u.role == "owner"), None)
        if owner:
            if owner_email is not None and owner_email != owner.email:
                existing = db.query(User).filter(User.email == owner_email, User.id != owner.id).first()
                if existing:
                    raise HTTPException(status_code=400, detail="Email already in use by another user")
                owner.email = owner_email
            if owner_name is not None:
                owner.name = owner_name

    legal = updates.pop("legal", None)
    if legal is not None:
        merged = dict(tenant.settings or {})
        officer = {k: str(v).strip() for k, v in (legal.pop("grievance_officer", None) or {}).items()}
        merged.update({k: str(v).strip() for k, v in legal.items()})
        merged["grievance_officer"] = officer
        tenant.settings = merged
    for field, value in updates.items():
        setattr(tenant, field, value)
    db.commit()
    db.refresh(tenant)
    return _tenant_response(tenant)


@router.post("/tenants/{tenant_id}/reset-owner-password", response_model=PasswordResetOut)
def reset_owner_password(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_tenant("admin.tenants", "full")),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    owner = next((u for u in tenant.users if u.role == "owner"), None)
    if not owner:
        raise HTTPException(status_code=404, detail="No owner found for this tenant")

    # Generate new password and update hash
    new_password = secrets.token_urlsafe(8)
    owner.password_hash = hash_password(new_password)
    db.commit()

    # Send email with new credentials
    products = [m.module_name for m in tenant.modules if m.is_enabled]
    html = build_welcome_html(
        user_name=owner.name,
        email=owner.email,
        password=new_password,
        login_url=settings.APP_LOGIN_URL,
        tenant_name=tenant.name,
        products=products,
        message="Your password has been reset by the administrator. Here are your updated login credentials:",
    )
    # The password is already changed and committed. Raising here reported a server error
    # for a request that had locked the owner out: their old password was gone and the
    # new one had gone nowhere. Say what actually happened instead.
    sent = True
    try:
        send_email(
            db=db,
            to_email=owner.email,
            subject="Your password has been reset",
            body_html=html,
            tenant_name=tenant.name,
            cc_emails=[current_user.email],
        )
    except Exception:  # noqa: BLE001 — the reset stands; the delivery is what failed
        sent = False

    return PasswordResetOut(
        ok=True,
        email_sent=sent,
        message=(
            f"New password sent to {owner.email}"
            if sent
            else f"The password was reset, but the email to {owner.email} did not go. "
            "Nobody holds the new one — fix the email configuration and reset again."
        ),
    )


@router.post("/tenants/{tenant_id}/modules", response_model=ModuleOut)
def toggle_module(
    tenant_id: int,
    data: ModuleToggle,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.tenants", "full")),
):
    """Which products this customer has bought. A module off hides the whole app."""
    if not db.get(Tenant, tenant_id):
        raise HTTPException(status_code=404, detail="Tenant not found")

    mod = db.query(TenantModule).filter(
        TenantModule.tenant_id == tenant_id,
        TenantModule.module_name == data.module_name,
    ).first()
    if mod:
        mod.is_enabled = data.is_enabled
    else:
        mod = TenantModule(
            tenant_id=tenant_id, module_name=data.module_name, is_enabled=data.is_enabled
        )
        db.add(mod)
    db.commit()
    db.refresh(mod)
    return mod


@router.get("/feature-catalog")
def get_feature_catalog(
    _: User = Depends(require_admin_tenant("admin.tenants")),
):
    """Return the static catalogue of toggleable features grouped by app + group."""
    return {k: v for k, v in FEATURE_CATALOG.items() if k in GATEABLE_APPS}


@router.get("/tenants/{tenant_id}/features")
def get_tenant_features(
    tenant_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.tenants")),
):
    """Return the feature flags for one tenant.

    Unknown / never-saved keys are returned as `True` (max-permissive default).
    The caller can rely on the result containing every key in the catalogue.
    """
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    rows = db.query(TenantFeature).filter(TenantFeature.tenant_id == tenant_id).all()
    saved = {r.feature_key: r.is_enabled for r in rows}
    return {
        key: saved.get(key, True)
        for app in GATEABLE_APPS
        for key in all_feature_keys(app)
    }


@router.put("/tenants/{tenant_id}/features", response_model=FeaturesSavedOut)
def put_tenant_features(
    tenant_id: int,
    data: TenantFeaturesUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.tenants", "full")),
):
    """Bulk upsert the feature matrix for a tenant.

    Only known feature keys are accepted (silent ignore of unknown keys keeps
    the API forward-compatible if older admin clients submit retired keys).
    """
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    existing = {
        r.feature_key: r
        for r in db.query(TenantFeature).filter(TenantFeature.tenant_id == tenant_id).all()
    }

    for key, enabled in data.features.items():
        if not is_known_feature(key):
            continue
        row = existing.get(key)
        if row:
            row.is_enabled = bool(enabled)
        else:
            db.add(TenantFeature(tenant_id=tenant_id, feature_key=key, is_enabled=bool(enabled)))

    db.commit()
    return FeaturesSavedOut(ok=True, saved=len(data.features))


@router.post(
    "/tenants/{tenant_id}/payments", response_model=PaymentOut, status_code=201
)
def add_payment(
    tenant_id: int,
    data: PaymentCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.tenants", "full")),
):
    """What this customer has paid for their licence. Minor units, with the currency."""
    if not db.get(Tenant, tenant_id):
        raise HTTPException(status_code=404, detail="Tenant not found")
    if data.amount_minor <= 0:
        raise HTTPException(status_code=409, detail="A payment of nothing is not a payment.")

    payload = data.model_dump()
    payload["currency"] = payload["currency"].upper()
    payment = TenantPayment(tenant_id=tenant_id, **payload)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/tenants/{tenant_id}/payments", response_model=list[PaymentOut])
def list_payments(
    tenant_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.tenants", "full")),
):
    payments = (
        db.query(TenantPayment)
        .filter(TenantPayment.tenant_id == tenant_id)
        .order_by(TenantPayment.payment_date.desc())
        .all()
    )
    return payments
