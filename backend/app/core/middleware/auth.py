from datetime import date
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import PyJWTError as JWTError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.core.models.user import User
from app.core.models.tenant import Tenant
from app.core.messages import err, msg, reading_as_staff

# auto_error is off because a second credential may carry the request instead. With it on,
# HTTPBearer 403s before this function runs and an X-API-Key caller is never reached.
security = HTTPBearer(auto_error=False)

API_KEY_HEADER = "X-API-Key"
KEY_STATE = "api_key"


def _no_credential() -> HTTPException:
    # 403, not 401: this is the status the console and the suites have always seen for a
    # request that carries nothing, and adding a second credential must not move it.
    return err(status.HTTP_403_FORBIDDEN, "not_authenticated")


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    db: Session = Depends(get_db),
) -> User:
    """One door, two credentials.

    Everything downstream — `get_tenant_db`, `require_entity`, `require_permission`,
    the idempotency middleware — takes the `User` this returns, so an API key gets the
    whole product without a second implementation of anything. A key acts AS the user who
    issued it, which is what makes "a key can never do more than its creator" a property
    of the design rather than a check somebody has to remember.
    """
    if x_api_key:
        return _user_for_key(request, db, x_api_key)

    if credentials is None:
        raise _no_credential()

    try:
        payload = jwt.decode(credentials.credentials, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: int = payload.get("user_id")
        if user_id is None:
            raise err(status.HTTP_401_UNAUTHORIZED, "invalid_token")
    except JWTError:
        raise err(status.HTTP_401_UNAUTHORIZED, "invalid_token")

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise err(status.HTTP_401_UNAUTHORIZED, "user_not_found")
    if int(payload.get("ep") or 0) != int(user.session_epoch or 0):
        raise err(status.HTTP_401_UNAUTHORIZED, "session_was_signed_out")
    reading_as_staff(user)
    if payload.get("imp"):
        _impersonating(request, db, user, payload)
    return user


def _impersonating(request: Request, db: Session, user: User, payload: dict) -> None:
    from datetime import datetime, timezone

    from app.core.models.impersonation import ImpersonationSession

    imp = db.get(ImpersonationSession, payload.get("imp"))
    now = datetime.now(timezone.utc)
    if imp is None or imp.target_user_id != user.id or imp.ended_at is not None or imp.expires_at <= now:
        raise err(status.HTTP_401_UNAUTHORIZED, "support_session_has_ended")
    staff = db.get(User, imp.staff_user_id)
    user.impersonated_by = {"session_id": imp.id, "staff_user_id": imp.staff_user_id,
                            "staff_email": staff.email if staff else payload.get("imp_by"),
                            "staff_name": staff.name if staff else None, "reason": imp.reason,
                            "expires_at": imp.expires_at.isoformat()}
    request.state.impersonation = user.impersonated_by


def refuse_impersonated(user: User) -> None:
    if getattr(user, "impersonated_by", None):
        raise err(status.HTTP_403_FORBIDDEN, "support_sessions_cannot_change_sign_credentials")


def _user_for_key(request: Request, db: Session, presented: str) -> User:
    from app.core.services import api_keys as keys
    from app.core.services import rate_limit

    key = keys.resolve(db, presented)
    if key is None:
        raise err(status.HTTP_401_UNAUTHORIZED, "api_key_not_valid")

    # Before the scope check, not after: a key presented and refused is still a key in use,
    # and it is the one somebody investigating a leak most wants to see.
    keys.touch(key)

    host = request.client.host if request.client else None
    if not keys.allows(key.allowed_ips, host):
        raise err(status.HTTP_403_FORBIDDEN, "key_ip_refused", ips=", ".join(key.allowed_ips),
                  host=host or msg("key_unknown_address"))

    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    if not keys.may_reach(key.scopes, request.method, path):
        raise err(status.HTTP_403_FORBIDDEN, "key_scope_refused", scopes=", ".join(key.scopes) or msg("key_no_scopes"),
                  method=request.method, path=path)

    rate_limit.claim(request, tenant_id=key.tenant_id, key_id=key.id)

    # A key is not a principal of its own: it borrows one, and it stops when they do.
    user = db.query(User).filter(User.id == key.user_id, User.is_active == True).first()
    if not user:
        raise err(status.HTTP_401_UNAUTHORIZED, "user_key_was_issued_by_no")

    request.state.api_key = key
    return user


def get_current_tenant(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Tenant:
    if not user.tenant_id:
        raise err(status.HTTP_403_FORBIDDEN, "no_tenant_assigned")

    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    if not tenant:
        raise err(status.HTTP_404_NOT_FOUND, "tenant_not_found")
    if not tenant.is_active:
        raise err(status.HTTP_403_FORBIDDEN, "tenant_inactive")
    if tenant.license_end < date.today():
        raise err(status.HTTP_403_FORBIDDEN, "license_expired")
    return tenant


def require_global_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "global_admin":
        raise err(status.HTTP_403_FORBIDDEN, "global_admin_access_required")
    return user


def require_role(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise err(status.HTTP_403_FORBIDDEN, "insufficient_permissions")
        return user
    return checker


def require_admin_tenant(key: str, level: str = "view"):
    """Factory that returns a FastAPI dependency that checks the user belongs
    to the admin tenant (by slug) AND passes RBAC permission checks."""

    permission_checker = require_permission(key, level)

    def checker(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        # Check tenant slug matches admin tenant
        if not user.tenant_id:
            raise err(status.HTTP_403_FORBIDDEN, "admin_portal_access_restricted")
        tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
        if not tenant or tenant.slug != settings.ADMIN_TENANT_SLUG:
            raise err(status.HTTP_403_FORBIDDEN, "admin_portal_access_restricted")
        # Delegate to RBAC check
        return permission_checker(user=user, db=db)

    return checker


def assert_permission(db: Session, user: User, key: str, level: str = "view") -> User:
    """The check itself, callable from inside a handler.

    A dependency is resolved before the request body is, so an endpoint whose permission
    key depends on what is being uploaded cannot express it as `Depends(...)`. Attachments
    are the one place that is true.
    """
    from app.core.services.permission_defaults import LEVELS
    from app.core.services.account import must_enrol

    if must_enrol(user):
        raise err(status.HTTP_403_FORBIDDEN, "organisation_requires_two_step_sign_set")

    if user.role in ("global_admin", "owner"):
        return user

    from app.core.models.role_permission import RolePermission
    row = db.query(RolePermission).filter(
        RolePermission.tenant_id == user.tenant_id,
        RolePermission.role == user.role,
        RolePermission.permission_key == key,
    ).first()

    if row:
        user_level = LEVELS.get(row.access_level, 0)
    else:
        # No saved row: fall back to the declared defaults for this role across
        # every app. Lives in a service, not a router, so there is no import cycle.
        from app.core.services.permission_defaults import defaults_for
        user_level = LEVELS.get(defaults_for(user.role).get(key, "none"), 0)

    if user_level < LEVELS.get(level, 1):
        raise err(status.HTTP_403_FORBIDDEN, "insufficient_permissions")
    return user


def has_permission(db: Session, user: User, key: str, level: str = "view") -> bool:
    """The same question as `assert_permission`, asked without raising."""
    try:
        assert_permission(db, user, key, level)
    except HTTPException:
        return False
    return True


def require_permission(key: str, level: str = "view"):
    """Factory that returns a FastAPI dependency checking RBAC permissions."""

    def checker(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        return assert_permission(db, user, key, level)

    return checker
