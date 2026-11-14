import hashlib
import json
import secrets
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import settings
from app.core.models.user import User
from app.core.models.tenant import Tenant
from app.core.schemas.auth import (
    LoginRequest,
    GoogleLoginRequest,
    GoogleNeedsProfile,
    HandoffIn,
    HandoffOut,
    TokenResponse,
    UserResponse,
    ChangePasswordRequest,
    UserSettings,
    UserSettingsUpdate,
)
from sqlalchemy.orm.attributes import flag_modified
from app.core.services.auth_service import verify_password, create_access_token, hash_password
from app.core.middleware.auth import get_current_user, refuse_impersonated
from app.core.middleware.activity import log_login
from app.core.services import rate_limit
from app.core.messages import err, refused

router = APIRouter(prefix="/api/auth", tags=["auth"])
TOO_MANY_LOGINS = "Too many sign-in attempts. Wait a while and try again."


def _check_tenant_status(user: User, db: Session):
    """Raise 403 if user's tenant is inactive or license expired. Admin tenant exempt."""
    if not user.tenant_id:
        return
    tenant = user.tenant or db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    if not tenant:
        return
    if tenant.slug == settings.ADMIN_TENANT_SLUG:
        return
    contact = settings.SMTP_FROM_EMAIL
    if not tenant.is_active:
        raise err(status.HTTP_403_FORBIDDEN, "organization_s_account_has_been_deactivated", contact=contact)
    if tenant.license_end and tenant.license_end < date.today():
        raise err(status.HTTP_403_FORBIDDEN, "organization_s_license_has_expired_please", contact=contact)


TOTP_HEADER = "X-Totp-Required"


def user_response(user: User) -> UserResponse:
    from app.core.services import account

    resp = UserResponse.model_validate(user)
    if user.tenant:
        resp.tenant_name = user.tenant.name
    resp.must_enrol_totp = account.must_enrol(user)
    resp.impersonated_by = getattr(user, "impersonated_by", None)
    return resp


def _second_step(db: Session, user: User, code: str | None) -> None:
    from app.core.services import account

    if user.totp_enabled_at is None:
        return
    if not code:
        raise err(status.HTTP_401_UNAUTHORIZED, "enter_six_digit_code_from_authenticator", headers={TOTP_HEADER: "1"})
    if not (account.check_code(user, code) or account.use_recovery_code(db, user, code)):
        db.commit()
        raise err(status.HTTP_401_UNAUTHORIZED, "code_not_right", headers={TOTP_HEADER: "1"})


def _issue(db: Session, user: User, request: Request) -> TokenResponse:
    from app.core.services import region

    region.guard(user.home_region or "in")
    user.last_login = datetime.now(timezone.utc)
    log_login(db, user, request)
    db.commit()
    token = create_access_token(
        {"user_id": user.id, "tenant_id": user.tenant_id, "role": user.role, "ep": user.session_epoch}
    )
    return TokenResponse(access_token=token, user=user_response(user))


HANDOFF_TTL = 60


def _handoff_key(code: str) -> str:
    return "kv:handoff:" + hashlib.sha256(code.encode()).hexdigest()


@router.post("/handoff", response_model=HandoffOut)
def handoff(request: Request, user: User = Depends(get_current_user)):
    from app.core.redis_client import get_redis

    if getattr(request.state, "api_key", None) is not None or getattr(user, "impersonated_by", None):
        raise err(status.HTTP_403_FORBIDDEN, "handoff_not_for_keys")
    code = secrets.token_urlsafe(32)
    get_redis().setex(_handoff_key(code), HANDOFF_TTL, json.dumps({"user_id": user.id, "ep": user.session_epoch}))
    return HandoffOut(code=code)


@router.post("/handoff/redeem", response_model=TokenResponse)
def redeem_handoff(req: HandoffIn, request: Request, db: Session = Depends(get_db)):
    from app.core.redis_client import get_redis

    ip = rate_limit.client_ip(request)
    rate_limit.limit(f"handoff:ip:{ip}", settings.RL_LOGIN_IP_PER_HOUR, 3600, message=TOO_MANY_LOGINS, ip=ip)
    raw = get_redis().getdel(_handoff_key(req.code))
    data = json.loads(raw) if raw else None
    user = db.get(User, data["user_id"]) if data else None
    if user is None or not user.is_active or user.session_epoch != data["ep"]:
        raise err(status.HTTP_401_UNAUTHORIZED, "handoff_invalid")
    _check_tenant_status(user, db)
    return _issue(db, user, request)


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = rate_limit.client_ip(request)
    rate_limit.limit(f"login:ip:{ip}", settings.RL_LOGIN_IP_PER_HOUR, 3600, message=TOO_MANY_LOGINS, ip=ip)
    rate_limit.limit(f"login:email:{req.email.strip().lower()}", settings.RL_LOGIN_EMAIL_PER_HOUR, 3600,
                     message=TOO_MANY_LOGINS, ip=ip)
    user = db.query(User).filter(User.email == req.email.strip().lower(), User.is_active == True).first()
    if user is None:
        user = db.query(User).filter(User.email == req.email, User.is_active == True).first()
    if not user or not user.password_hash:
        raise err(status.HTTP_401_UNAUTHORIZED, "invalid_credentials")
    if not verify_password(req.password, user.password_hash):
        raise err(status.HTTP_401_UNAUTHORIZED, "invalid_credentials")

    _check_tenant_status(user, db)
    _second_step(db, user, req.code)
    return _issue(db, user, request)


@router.post("/google", response_model=TokenResponse | GoogleNeedsProfile)
def google_login(req: GoogleLoginRequest, request: Request, db: Session = Depends(get_db)):
    from app.core.services import beta, google_signin

    ip = rate_limit.client_ip(request)
    rate_limit.limit(f"login:ip:{ip}", settings.RL_LOGIN_IP_PER_HOUR, 3600, message=TOO_MANY_LOGINS, ip=ip)
    info = google_signin.verify(req.token, request.client.host if request.client else None)
    user = google_signin.find_user(db, info)
    if user is None:
        mode = beta.signup_mode()
        if mode == "closed":
            raise err(status.HTTP_403_FORBIDDEN, "sign_ups_closed")
        return GoogleNeedsProfile(ticket=google_signin.make_ticket(info), email=info["email"],
                                  name=(info.get("name") or "").strip(), invite_needed=mode == "invite")
    if user.role == "global_admin":
        db.rollback()
        raise err(status.HTTP_403_FORBIDDEN, "google_not_for_admin")
    _check_tenant_status(user, db)
    _second_step(db, user, req.code)
    return _issue(db, user, request)


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A bearer token says who is signed in, not that they know the password. Without
    this check a borrowed session is a permanent takeover: the holder sets a new password
    and the owner is locked out of their own account."""
    refuse_impersonated(user)
    if not user.password_hash or not verify_password(req.current_password, user.password_hash):
        raise err(status.HTTP_401_UNAUTHORIZED, "not_current_password")
    from app.core.services import account

    try:
        account.check_password(req.new_password)
    except account.AccountError as exc:
        raise refused(status.HTTP_400_BAD_REQUEST, str(exc))
    if verify_password(req.new_password, user.password_hash):
        raise err(status.HTTP_400_BAD_REQUEST, "password_you_already_have")
    user.password_hash = hash_password(req.new_password)
    user.session_epoch = int(user.session_epoch or 0) + 1
    db.commit()
    token = create_access_token({"user_id": user.id, "tenant_id": user.tenant_id, "role": user.role, "ep": user.session_epoch})
    return {"message": "Password changed successfully", "access_token": token}


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_tenant_status(user, db)
    return user_response(user)


def _load_settings(user: User) -> UserSettings:
    raw = user.settings if isinstance(user.settings, dict) else {}
    return UserSettings.model_validate(raw)


@router.get("/me/settings", response_model=UserSettings)
def read_my_settings(user: User = Depends(get_current_user)):
    return _load_settings(user)


@router.put("/me/settings", response_model=UserSettings)
def update_my_settings(
    payload: UserSettingsUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    merged = _load_settings(user).model_dump()
    for section, values in payload.model_dump(exclude_unset=True).items():
        prior = merged.get(section)
        if isinstance(values, dict) and isinstance(prior, dict):
            merged[section] = {**prior, **values}
        elif values is None and isinstance(prior, dict):
            continue
        else:
            merged[section] = values

    validated = UserSettings.model_validate(merged)
    existing = user.settings if isinstance(user.settings, dict) else {}
    user.settings = {**existing, **validated.model_dump()}
    flag_modified(user, "settings")
    db.commit()
    return validated
