from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.core.models.beta import InviteCode, WaitlistEntry

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def now() -> datetime:
    return datetime.now(timezone.utc)


def signup_mode() -> str:
    mode = (settings.SIGNUP_MODE or "").strip().lower()
    if mode in ("open", "invite", "closed"):
        return mode
    return "open" if settings.SIGNUP_ENABLED else "closed"


def creator_mode() -> str:
    mode = (settings.CREATOR_SIGNUP or "open").strip().lower()
    return mode if mode in ("open", "invite", "closed") else "open"


def digest(code: str) -> str:
    return hashlib.sha256(code.strip().upper().replace("-", "").encode()).hexdigest()


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(12))
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"


def make(db: Session, *, role: str = "viewer", max_uses: int = 1, days: int | None = 30, email: str | None = None,
         note: str = "", created_by: int | None = None) -> tuple[InviteCode, str]:
    code = new_code()
    row = InviteCode(code_hash=digest(code), hint=code[-4:], role=role, max_uses=max(1, min(max_uses, 10000)),
                     expires_at=now() + timedelta(days=days) if days else None, email=(email or None) and email.lower(),
                     note=note[:200], created_by=created_by)
    db.add(row)
    db.flush()
    return row, code


def lookup(db: Session, code: str | None) -> InviteCode | None:
    if not code or len(code) > 40:
        return None
    row = db.query(InviteCode).filter(InviteCode.code_hash == digest(code)).first()
    if row is None or row.revoked_at is not None or row.used >= row.max_uses:
        return None
    if row.expires_at is not None and row.expires_at <= now():
        return None
    return row


def redeem(db: Session, code: str, email: str, need: str) -> InviteCode:
    row = lookup(db, code)
    if row is None:
        raise err(403, "invite_invalid")
    if row.email and row.email != email.lower():
        raise err(403, "invite_invalid")
    if need == "creator" and row.role != "creator":
        raise err(403, "creator_invite_needed")
    took = db.execute(update(InviteCode).where(InviteCode.id == row.id, InviteCode.used < InviteCode.max_uses,
                                               InviteCode.revoked_at.is_(None),
                                               or_(InviteCode.expires_at.is_(None), InviteCode.expires_at > now()))
                      .values(used=InviteCode.used + 1).returning(InviteCode.id)).first()
    if took is None:
        raise err(403, "invite_invalid")
    db.query(WaitlistEntry).filter(WaitlistEntry.email == email.lower(),
                                   WaitlistEntry.status.in_(("pending", "confirmed", "invited"))).update(
        {"status": "joined"}, synchronize_session=False)
    return row


def gate_signup(db: Session, *, email: str, invite: str | None, opens_channel: bool) -> None:
    mode, cmode = signup_mode(), creator_mode()
    if mode == "closed":
        raise err(403, "sign_ups_closed")
    if opens_channel and cmode == "closed":
        raise err(403, "creator_signup_closed")
    need = "creator" if opens_channel and cmode == "invite" else ("viewer" if mode == "invite" else None)
    if need is None:
        return
    if not invite:
        raise err(403, "creator_invite_needed" if need == "creator" else "invite_needed")
    redeem(db, invite, email, need)


def gate_channel(db: Session, *, email: str, invite: str | None) -> None:
    cmode = creator_mode()
    if cmode == "closed":
        raise err(403, "creator_signup_closed")
    if cmode == "invite":
        if not invite:
            raise err(403, "creator_invite_needed")
        redeem(db, invite, email, "creator")
