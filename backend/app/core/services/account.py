from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets as pysecrets
import struct
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.core.models.account import AuthToken, RecoveryCode
from app.core.models.user import User
from app.core.services import secrets

logger = logging.getLogger(__name__)

LIFETIME = {
    "verify": timedelta(hours=48),
    "reset": timedelta(minutes=30),
    "invite": timedelta(days=7),
}
PATHS = {"verify": "/verify", "reset": "/reset", "invite": "/invite"}
STEP_SECONDS = 30
DIGITS = 6
ISSUER = "Klygenix Play"
MIN_PASSWORD = 8
RECOVERY_CODES = 10


class AccountError(Exception):
    pass


class Unverified(HTTPException):
    def __init__(self, email: str | None) -> None:
        super().__init__(
            status_code=409,
            detail=(
                f"Confirm your email address first — the link went to {email or 'the owner'}. "
                "Until then invoices can be drafted but not issued or sent."
            ),
        )


def assert_verified(db: Session, tenant_id: int | None) -> None:
    from app.core.models.tenant import Tenant

    tenant = db.get(Tenant, tenant_id) if tenant_id else None
    if tenant is not None and tenant.verified_at is None:
        owner = db.execute(
            select(User.email).where(User.tenant_id == tenant.id, User.role == "owner")
        ).scalar_one_or_none()
        raise Unverified(owner)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def check_password(password: str) -> None:
    if len(password or "") < MIN_PASSWORD:
        raise AccountError(f"A password needs at least {MIN_PASSWORD} characters")
    if password.lower() == password and password.isalpha():
        raise AccountError("A password of letters only is too easy to guess. Add a number or a symbol.")


def issue_token(db: Session, user: User, purpose: str) -> str:
    db.execute(
        update(AuthToken)
        .where(AuthToken.user_id == user.id, AuthToken.purpose == purpose, AuthToken.used_at.is_(None))
        .values(used_at=_now())
    )
    token = pysecrets.token_urlsafe(32)
    db.add(
        AuthToken(
            user_id=user.id, purpose=purpose, token_hash=digest(token),
            expires_at=_now() + LIFETIME[purpose],
        )
    )
    db.flush()
    return token


def redeem(db: Session, token: str, purpose: str) -> User:
    row = db.execute(
        select(AuthToken)
        .where(AuthToken.token_hash == digest(token or ""), AuthToken.purpose == purpose)
        .with_for_update()
    ).scalar_one_or_none()
    if row is None or row.used_at is not None or row.expires_at <= _now():
        raise AccountError("That link has expired or has already been used. Ask for a new one.")
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise AccountError("That link has expired or has already been used. Ask for a new one.")
    row.used_at = _now()
    return user


def link(purpose: str, token: str) -> str:
    return f"{settings.STUDIO_APP_URL.rstrip('/')}{PATHS[purpose]}?token={quote(token)}"


def verified(db: Session, user: User) -> None:
    from app.core.models.tenant import Tenant

    if user.email_verified_at is None:
        user.email_verified_at = _now()
    if user.role == "owner" and user.tenant_id:
        tenant = db.get(Tenant, user.tenant_id)
        if tenant is not None and tenant.verified_at is None:
            tenant.verified_at = _now()


def send_link(db: Session, user: User, purpose: str, token: str, **words) -> bool:
    from app.core.services import mailer

    lang = (user.settings or {}).get("language")
    try:
        mailer.send(db, f"account_{purpose}", user.email, {"name": user.name, "link": link(purpose, token), **words},
                    lang if lang in ("en", "hi") else "en", tenant_id=user.tenant_id)
        db.commit()
        return True
    except Exception:
        db.rollback()
        logger.warning("could not send the %s email to user %s", purpose, user.id)
        return False


def slug_for(db: Session, company: str) -> str:
    from app.core.models.tenant import Tenant

    base = re.sub(r"[^a-z0-9]+", "-", (company or "").lower()).strip("-")[:40] or "company"
    while True:
        slug = f"{base}-{pysecrets.token_hex(2)}"
        if db.execute(select(Tenant.id).where(Tenant.slug == slug)).first() is None:
            return slug


def _code(secret: bytes, step: int) -> str:
    mac = hmac.new(secret, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    value = struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** DIGITS)).zfill(DIGITS)


def _secret_bytes(user: User) -> bytes:
    plain = secrets.resolve(user.totp_secret or "")
    return base64.b32decode(plain + "=" * (-len(plain) % 8))


def code_for(base32: str, at: float | None = None) -> str:
    secret = base64.b32decode(base32 + "=" * (-len(base32) % 8))
    return _code(secret, int((at if at is not None else time.time()) // STEP_SECONDS))


def begin_totp(user: User) -> tuple[str, str]:
    if user.totp_enabled_at is not None:
        raise AccountError("Two-step sign-in is already on for this account")
    if not secrets.has_key():
        raise AccountError(
            "There is no master key on this server, so a two-step secret cannot be stored "
            "encrypted — and it will not be stored any other way."
        )
    plain = base64.b32encode(pysecrets.token_bytes(20)).decode().rstrip("=")
    user.totp_secret = secrets.encrypt(plain)
    user.totp_last_step = None
    label = quote(f"{ISSUER}:{user.email}")
    url = f"otpauth://totp/{label}?secret={plain}&issuer={quote(ISSUER)}&digits={DIGITS}&period={STEP_SECONDS}"
    return plain, url


def check_code(user: User, code: str, *, at: float | None = None) -> bool:
    if not user.totp_secret:
        return False
    cleaned = re.sub(r"\s", "", code or "")
    if not re.fullmatch(r"\d{6}", cleaned):
        return False
    secret = _secret_bytes(user)
    now_step = int((at if at is not None else time.time()) // STEP_SECONDS)
    for step in (now_step - 1, now_step, now_step + 1):
        if user.totp_last_step is not None and step <= user.totp_last_step:
            continue
        if hmac.compare_digest(_code(secret, step), cleaned):
            user.totp_last_step = step
            return True
    return False


def use_recovery_code(db: Session, user: User, code: str) -> bool:
    cleaned = re.sub(r"[\s-]", "", code or "").lower()
    if len(cleaned) != 10:
        return False
    row = db.execute(
        select(RecoveryCode).where(
            RecoveryCode.user_id == user.id, RecoveryCode.code_hash == digest(cleaned),
            RecoveryCode.used_at.is_(None),
        ).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        return False
    row.used_at = _now()
    return True


def enable_totp(db: Session, user: User, code: str) -> list[str]:
    if user.totp_enabled_at is not None:
        raise AccountError("Two-step sign-in is already on for this account")
    if not user.totp_secret:
        raise AccountError("Start the set-up first, so there is a secret to check the code against")
    if not check_code(user, code):
        raise AccountError("That code is not right. Check the time on your phone and try the next one.")
    user.totp_enabled_at = _now()
    db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete()
    codes = []
    for _ in range(RECOVERY_CODES):
        plain = pysecrets.token_hex(5)
        codes.append(f"{plain[:5]}-{plain[5:]}")
        db.add(RecoveryCode(user_id=user.id, code_hash=digest(plain)))
    return codes


def disable_totp(db: Session, user: User) -> None:
    user.totp_secret = None
    user.totp_enabled_at = None
    user.totp_last_step = None
    db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete()


def must_enrol(user: User) -> bool:
    tenant = user.tenant
    return bool(
        tenant is not None and tenant.require_totp and user.role in ("owner", "admin")
        and user.totp_enabled_at is None
    )
