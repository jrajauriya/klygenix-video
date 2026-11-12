"""One permissions router, parameterised by app.

The master estate has a near-identical copy of this file per app — admin_roles.py,
roles.py, and one inside each product package — which is how their key sets drifted.
Here there is one implementation and a factory, so adding an app (master plan §06) adds
a router line, not a file.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.core import audit
from app.database import get_db
from app.core.models.user import User
from app.core.models.tenant import Tenant
from app.core.models.role_permission import RolePermission
from app.core.models.tenant_feature import TenantFeature
from app.core.middleware.auth import (
    get_current_user,
    require_admin_tenant,
    require_permission,
)
from app.core.schemas.permissions import RolePermissionsUpdate
from app.core.services.feature_catalog import (
    FEATURE_CATALOG,
    GATEABLE_APPS,
    all_feature_keys,
)
from app.core.services.permission_defaults import defaults_for_app

ACCESS_LEVELS = ("none", "view", "full")

ROLE_HINTS = {
    "admin": "Runs the day to day. Approves within their band.",
    "user": "Sees only what this matrix allows.",
    "manager": "Runs the channel with you and invites the team. Never sees money.",
    "editor": "Uploads, edits and clips videos.",
    "moderator": "Looks after comments, danmaku and live chat.",
    "analyst": "Reads analytics and videos, changes nothing.",
}
ROLE_LABELS = {"admin": "Manager", "user": "Staff", "manager": "Team manager", "editor": "Editor", "moderator": "Moderator",
               "analyst": "Analyst"}
EDITABLE_ROLES = ("admin", "user")
TEAM_ROLES = ("manager", "editor", "moderator", "analyst")


def _permissions_for(db: Session, tenant_id: int, app: str, role: str) -> dict[str, str]:
    keys = all_feature_keys(app)
    if role in ("global_admin", "owner"):
        return {k: "full" for k in keys}

    # Scope BOTH the read and the write by this app's keys. Unscoped, one app's save
    # deletes every other app's rows — the master estate lost 97 rows to exactly this.
    rows = (
        db.query(RolePermission)
        .filter(
            RolePermission.tenant_id == tenant_id,
            RolePermission.role == role,
            RolePermission.permission_key.in_(keys),
        )
        .all()
    )
    if rows:
        return {r.permission_key: r.access_level for r in rows}
    return defaults_for_app(app, role)


def _platform_off(features: dict[str, bool]) -> dict[str, bool]:
    if "video.live" in features:
        from app.video.live.service import available

        features["video.live"] = features["video.live"] and available()
    return features


def build_router(app: str, *, admin_only: bool = False) -> APIRouter:
    """Return the four permission endpoints for one app."""
    router = APIRouter(prefix=f"/api/{app}", tags=[f"{app}-permissions"])
    keys = all_feature_keys(app)
    roles = EDITABLE_ROLES + (TEAM_ROLES if app == "video" else ())

    def guard(key: str, level: str = "view"):
        return require_admin_tenant(key, level) if admin_only else require_permission(key, level)

    read_key = f"{app}.dashboard"
    admin_key = f"{app}.users" if not admin_only else "admin.team"
    write_key = f"{app}.users" if not admin_only else "admin.settings"

    def _tenant(db: Session, user: User) -> Tenant:
        if admin_only:
            tenant = db.query(Tenant).filter(Tenant.slug == settings.ADMIN_TENANT_SLUG).first()
            if not tenant:
                raise HTTPException(status_code=404, detail="Admin tenant not found")
            return tenant
        if not user.tenant_id:
            raise HTTPException(status_code=403, detail="Tenant context required")
        tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return tenant

    @router.get("/permission-catalog")
    def permission_catalog(_: User = Depends(guard(admin_key))):
        """The permission tree with its labels, so the editor never restates them."""
        spec = FEATURE_CATALOG[app]
        return {
            "label": spec["label"],
            "groups": [
                {"label": g["label"], "items": [dict(i) for i in g["items"]]}
                for g in spec["groups"]
            ],
            "roles": [
                {"role": r, "label": ROLE_LABELS[r], "hint": ROLE_HINTS[r]}
                for r in roles
            ],
            "levels": list(ACCESS_LEVELS),
            "defaults": {r: defaults_for_app(app, r) for r in roles},
        }

    @router.get("/permissions")
    def my_permissions(
        db: Session = Depends(get_db),
        user: User = Depends(guard(read_key)),
    ):
        """The current user's own map. Every screen guard reads this."""
        tenant = _tenant(db, user)
        return _permissions_for(db, tenant.id, app, user.role)

    @router.get("/roles/permissions")
    def role_matrix(
        db: Session = Depends(get_db),
        user: User = Depends(guard(admin_key)),
    ):
        tenant = _tenant(db, user)
        return {r: _permissions_for(db, tenant.id, app, r) for r in roles}

    @router.put("/roles/permissions")
    def save_role_matrix(
        payload: RolePermissionsUpdate,
        db: Session = Depends(get_db),
        user: User = Depends(guard(write_key, "full")),
    ):
        tenant = _tenant(db, user)
        # This route runs on a plain session, so neither the tenant nor the actor is on
        # it — and without both the trail cannot record who changed what.
        audit.attribute(
            db,
            tenant_id=tenant.id,
            actor=audit.Actor(audit.USER, user_id=user.id, label=user.email),
        )
        was = {r: _permissions_for(db, tenant.id, app, r) for r in roles}

        for role, items in payload.permissions.items():
            if role not in roles:
                continue
            db.query(RolePermission).filter(
                RolePermission.tenant_id == tenant.id,
                RolePermission.role == role,
                RolePermission.permission_key.in_(keys),
            ).delete(synchronize_session=False)
            # Flush the deletes before the inserts: SQLAlchemy otherwise emits INSERTs
            # first and they collide on uq(tenant, role, key).
            db.flush()
            for item in items:
                if item.permission_key not in keys:
                    continue
                if item.access_level not in ACCESS_LEVELS:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unknown access level: {item.access_level}",
                    )
                db.add(
                    RolePermission(
                        tenant_id=tenant.id,
                        role=role,
                        permission_key=item.permission_key,
                        access_level=item.access_level,
                    )
                )
        db.flush()
        now = {r: _permissions_for(db, tenant.id, app, r) for r in roles}
        moved_before: dict[str, str] = {}
        moved_after: dict[str, str] = {}
        for role in roles:
            for key in sorted(set(was.get(role, {})) | set(now.get(role, {}))):
                old_level = was.get(role, {}).get(key, "none")
                new_level = now.get(role, {}).get(key, "none")
                if old_level != new_level:
                    moved_before[f"{role}.{key}"] = old_level
                    moved_after[f"{role}.{key}"] = new_level
        if moved_after:
            audit.record(
                db,
                action="permissions.changed",
                target_table="role_permissions",
                target_id=tenant.id,
                before=moved_before,
                after=moved_after,
            )
        db.commit()
        return {"success": True}

    if app in GATEABLE_APPS:

        @router.get("/tenant-features")
        def tenant_features(
            db: Session = Depends(get_db),
            user: User = Depends(get_current_user),
        ):
            """Gate one, as this tenant sees it. A missing key means enabled."""
            if not user.tenant_id:
                return _platform_off({k: True for k in keys})
            rows = (
                db.query(TenantFeature)
                .filter(
                    TenantFeature.tenant_id == user.tenant_id,
                    TenantFeature.feature_key.in_(keys),
                )
                .all()
            )
            saved = {r.feature_key: r.is_enabled for r in rows}
            return _platform_off({k: saved.get(k, True) for k in keys})

    else:

        @router.get("/tenant-features")
        def tenant_features_all_on(user: User = Depends(get_current_user)):
            return {k: True for k in keys}

    return router


admin_permissions_router = build_router("admin", admin_only=True)
video_permissions_router = build_router("video")
