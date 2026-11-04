from __future__ import annotations

from datetime import date

import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import audit
from app.core.audit import USER, Actor
from app.core.middleware.auth import get_current_user, refuse_impersonated
from app.core.models.tenant import Tenant
from app.config import settings
from app.core.models.user import User
from app.core.schemas.auth import TokenResponse
from app.core.services import account
from app.core.services.auth_service import hash_password, verify_password
from app.core.services.tenant_service import create_tenant_with_admin
from app.database import get_db
from app.core.messages import err, refused

router = APIRouter(prefix="/api/auth", tags=["auth"])

WINDOW_SECONDS = 3600
SIGNUPS_PER_HOUR = 10
ASKS_PER_HOUR = 5
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
GSTIN = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
QUIET = "If that address has an account, a link to reset its password is on its way."


class SignupIn(BaseModel):
    name: str
    email: str
    password: str
    birth_date: date
    country: str = "IN"
    language: str = "en"
    handle: str | None = None
    channel_name: str | None = None
    invite: str | None = None


class TokenIn(BaseModel):
    token: str


class ForgotIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    token: str
    password: str


class InviteAcceptIn(BaseModel):
    token: str
    password: str
    name: str | None = None


class TotpSetupOut(BaseModel):
    secret: str
    otpauth_url: str


class TotpCodeIn(BaseModel):
    code: str


class TotpDisableIn(BaseModel):
    password: str
    code: str


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


class MessageOut(BaseModel):
    message: str
    email_sent: bool | None = None


def _refused(err: Exception, code: int = 409) -> HTTPException:
    return refused(code, str(err))


def _limited(scope: str, limit: int) -> bool:
    try:
        from app.core.redis_client import get_redis

        redis = get_redis()
        key = f"account:{scope}"
        count = redis.incr(key)
        if count == 1:
            redis.expire(key, WINDOW_SECONDS)
        return count > limit
    except Exception:
        return False


def _host(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def token_for(db: Session, user: User, request: Request) -> TokenResponse:
    from app.core.routers.auth import _issue

    return _issue(db, user, request)


def _chosen_handle(db: Session, wanted: str | None) -> str | None:
    from app.video.models.social import Channel
    from app.video.services.text import is_valid_creator_handle

    handle = (wanted or "").strip().lower().lstrip("@")
    if not handle:
        return None
    if not is_valid_creator_handle(handle):
        raise err(400, "handle_3_40_letters_numbers_hyphens")
    from app.video.services import handles

    if handles.taken(db, handle):
        raise err(409, "taken_try_another", handle=handle)
    return handle


@router.get("/signup/open")
def signup_open():
    from app.core.services import beta

    mode = beta.signup_mode()
    return {"open": mode != "closed", "mode": mode, "creator": beta.creator_mode()}


@router.post("/signup", response_model=TokenResponse, status_code=201)
def signup(data: SignupIn, request: Request, db: Session = Depends(get_db)):
    from app.video.models.social import Profile
    from app.video.services.provisioning import open_channel
    from app.video.trust.age import minimum_age, old_enough

    from app.core.services import beta

    if beta.signup_mode() == "closed":
        raise err(403, "sign_ups_closed")
    from app.core.services.rate_limit import _exempt

    if not _exempt(_host(request)) and _limited(f"signup:{_host(request)}", SIGNUPS_PER_HOUR):
        raise err(429, "too_many_sign_ups_from_here")
    email = data.email.strip().lower()
    if not EMAIL.match(email):
        raise err(400, "not_email_address")
    if not data.name.strip():
        raise err(400, "name_needed")
    country = (data.country or "IN").strip().upper()[:2]
    if not old_enough(data.birth_date, country):
        raise err(403, "too_young_for_account", age=minimum_age(country))
    try:
        account.check_password(data.password)
    except account.AccountError as exc:
        raise _refused(exc, 400)
    if db.query(User).filter(User.email == email).first():
        raise err(409, "address_already_has_account_sign_reset")
    handle = _chosen_handle(db, data.handle)
    from app.core.services import region

    home = region.region_for(country)
    region.guard(home)
    beta.gate_signup(db, email=email, invite=data.invite, opens_channel=bool(handle))

    tenant, owner, _ = create_tenant_with_admin(
        db, name=data.name.strip(), slug=account.slug_for(db, data.name), owner_email=email,
        owner_name=data.name.strip(), password=data.password, verified=False, email=email, max_users=3,
    )
    audit.attribute(db, tenant_id=tenant.id, actor=Actor(USER, user_id=owner.id, label=owner.name))
    from app.video.sessions import bind_tenant

    bind_tenant(db, tenant.id)
    owner.settings = {**(owner.settings or {}), "language": data.language}
    owner.home_region = home
    db.add(Profile(user_id=owner.id, tenant_id=tenant.id, display_name=data.name.strip()[:80],
                   birth_date=data.birth_date, country=country, language=data.language))
    if handle:
        open_channel(db, tenant, name=(data.channel_name or data.name).strip(), handle=handle,
                     language=data.language, country=country)
    token = account.issue_token(db, owner, "verify")
    db.commit()
    account.send_link(db, owner, "verify", token)
    return token_for(db, owner, request)


@router.post("/verify", response_model=MessageOut)
def verify_email(data: TokenIn, db: Session = Depends(get_db)):
    try:
        user = account.redeem(db, data.token, "verify")
    except account.AccountError as exc:
        raise _refused(exc)
    account.verified(db, user)
    db.commit()
    return MessageOut(message="Your email address is confirmed. You can publish paid products now.")


@router.post("/verify/resend", response_model=MessageOut)
def resend_verification(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.email_verified_at is not None:
        return MessageOut(message="This address is already confirmed.", email_sent=False)
    if _limited(f"verify:{user.id}", ASKS_PER_HOUR):
        raise err(429, "link_was_sent_moment_ago_check")
    token = account.issue_token(db, user, "verify")
    db.commit()
    sent = account.send_link(db, user, "verify", token)
    return MessageOut(
        message=f"A new link is on its way to {user.email}." if sent else
        "The link could not be emailed. Ask whoever runs this server to check its mail settings.",
        email_sent=sent,
    )


@router.post("/forgot", response_model=MessageOut, status_code=202)
def forgot_password(data: ForgotIn, request: Request, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    if _limited(f"forgot:{_host(request)}", ASKS_PER_HOUR * 4) or _limited(f"forgot:{email}", ASKS_PER_HOUR):
        return MessageOut(message=QUIET)
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).first()
    if user is not None:
        token = account.issue_token(db, user, "reset")
        db.commit()
        account.send_link(db, user, "reset", token)
    return MessageOut(message=QUIET)


@router.post("/reset", response_model=MessageOut)
def reset_password(data: ResetIn, db: Session = Depends(get_db)):
    try:
        account.check_password(data.password)
        user = account.redeem(db, data.token, "reset")
    except account.AccountError as exc:
        raise _refused(exc)
    user.password_hash = hash_password(data.password)
    user.session_epoch = (user.session_epoch or 0) + 1
    account.verified(db, user)
    db.commit()
    return MessageOut(message="Your password is changed, and every other session is signed out.")


@router.post("/invite/accept", response_model=TokenResponse)
def accept_invite(data: InviteAcceptIn, request: Request, db: Session = Depends(get_db)):
    try:
        account.check_password(data.password)
        user = account.redeem(db, data.token, "invite")
    except account.AccountError as exc:
        raise _refused(exc)
    user.password_hash = hash_password(data.password)
    if data.name and data.name.strip():
        user.name = data.name.strip()
    account.verified(db, user)
    db.commit()
    return token_for(db, user, request)


@router.post("/totp/setup", response_model=TotpSetupOut)
def totp_setup(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    refuse_impersonated(user)
    try:
        secret, url = account.begin_totp(user)
    except account.AccountError as exc:
        raise _refused(exc)
    db.commit()
    return TotpSetupOut(secret=secret, otpauth_url=url)


@router.post("/totp/enable", response_model=RecoveryCodesOut)
def totp_enable(data: TotpCodeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        codes = account.enable_totp(db, user, data.code)
    except account.AccountError as exc:
        raise _refused(exc)
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/totp/disable", response_model=MessageOut)
def totp_disable(data: TotpDisableIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    refuse_impersonated(user)
    if user.totp_enabled_at is None:
        raise err(409, "two_step_sign_not_account")
    tenant = db.get(Tenant, user.tenant_id) if user.tenant_id else None
    if tenant is not None and tenant.require_totp and user.role in ("owner", "admin"):
        raise err(409, "organisation_requires_two_step_sign_owners")
    if not user.password_hash or not verify_password(data.password, user.password_hash):
        raise err(400, "not_current_password")
    if not (account.check_code(user, data.code) or account.use_recovery_code(db, user, data.code)):
        raise err(400, "code_not_right")
    account.disable_totp(db, user)
    db.commit()
    return MessageOut(message="Two-step sign-in is off.")



@router.get("/region")
def region_info():
    from app.core.services import region

    return {"region": region.here(), "enforced": settings.REGION_ENFORCE, "regions": region.urls()}
