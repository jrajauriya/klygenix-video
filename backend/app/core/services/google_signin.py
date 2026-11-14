from __future__ import annotations

import base64
import json
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.core.models.user import User
from app.core.services.auth_service import hash_password

TICKET_AUDIENCE = "google_signup"
TICKET_MINUTES = 15
ISSUERS = ("accounts.google.com", "https://accounts.google.com")


def _sandbox(token: str) -> dict:
    try:
        raw = token.split(".", 1)[1]
        info = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except Exception:
        raise err(401, "invalid_google_token")
    return {"sub": str(info.get("sub") or ""), "email": info.get("email"), "name": info.get("name"),
            "picture": info.get("picture"), "email_verified": info.get("email_verified", True), "iss": ISSUERS[1]}


def _loopback(peer: str | None) -> bool:
    import ipaddress

    try:
        return ipaddress.ip_address(peer or "").is_loopback
    except ValueError:
        return False


def verify(token: str, peer: str | None = None) -> dict:
    token = (token or "").strip()
    if settings.SANDBOX_ENABLED and token.startswith("sandbox.") and _loopback(peer):
        info = _sandbox(token)
    else:
        if not settings.GOOGLE_CLIENT_ID:
            raise err(501, "google_oauth_not_configured_set_google")
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        try:
            info = id_token.verify_oauth2_token(token, google_requests.Request(), settings.GOOGLE_CLIENT_ID)
        except ValueError:
            raise err(401, "invalid_google_token")
    if info.get("iss") not in ISSUERS or not info.get("sub"):
        raise err(401, "invalid_google_token")
    if not info.get("email"):
        raise err(401, "no_email_found_google_token")
    if info.get("email_verified") not in (True, "true"):
        raise err(401, "google_email_not_verified")
    info["email"] = str(info["email"]).strip().lower()
    return info


def find_user(db: Session, info: dict) -> User | None:
    user = db.query(User).filter(User.google_sub == info["sub"]).first()
    if user is None:
        user = db.query(User).filter(User.email == info["email"]).first()
        if user is None:
            return None
        if user.google_sub and user.google_sub != info["sub"]:
            raise err(409, "google_other_account_linked")
    if not user.is_active:
        raise err(401, "no_active_account_found_with_email")
    if user.google_sub is None:
        user.google_sub = info["sub"]
    if user.email_verified_at is None and user.email == info["email"]:
        user.email_verified_at = datetime.now(timezone.utc)
        user.password_hash = hash_password(secrets.token_urlsafe(24))
        user.session_epoch = int(user.session_epoch or 0) + 1
    return user


def make_ticket(info: dict) -> str:
    claims = {"aud": TICKET_AUDIENCE, "sub": info["sub"], "email": info["email"],
              "name": (info.get("name") or "").strip()[:200],
              "exp": datetime.now(timezone.utc) + timedelta(minutes=TICKET_MINUTES)}
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def read_ticket(ticket: str) -> dict:
    try:
        return jwt.decode(ticket, settings.SECRET_KEY, algorithms=[settings.ALGORITHM], audience=TICKET_AUDIENCE)
    except jwt.PyJWTError:
        raise err(401, "google_ticket_expired")
