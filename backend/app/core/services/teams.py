from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.core import audit
from app.core.messages import err
from app.core.models.role_permission import RolePermission
from app.core.models.team import TenantMember
from app.core.models.user import User
from app.core.services.permission_defaults import LEVELS, defaults_for

ROLES = ("manager", "editor", "moderator", "analyst")
OWNER_ONLY = frozenset({"video.billing", "video.earnings"})
INVITE_DAYS = 7
DEFAULT_LIMITS = {"free": 1, "pro": 5, "business": 25}


def now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.strip().encode()).hexdigest()


def limit(db: Session, tenant_id: int) -> int:
    from app.video.commerce.quotas import active_plan, owner_user_id

    uid = owner_user_id(db, tenant_id)
    if uid is None:
        return 0
    plan = active_plan(db, uid, "creator")
    value = (plan.limits or {}).get("team_members")
    if value is None:
        value = next((n for k, n in DEFAULT_LIMITS.items() if k in plan.key), DEFAULT_LIMITS["free"])
    return int(value)


def open_count(db: Session, tenant_id: int) -> int:
    return db.execute(select(func.count(TenantMember.id)).where(TenantMember.tenant_id == tenant_id,
                                                               TenantMember.status != "removed")).scalar() or 0


def members(db: Session, tenant_id: int) -> list[TenantMember]:
    return list(db.execute(select(TenantMember).where(TenantMember.tenant_id == tenant_id, TenantMember.status != "removed")
                           .order_by(TenantMember.id)).scalars())


def invite(db: Session, tenant_id: int, inviter: User, email: str, role: str, channel_name: str) -> tuple[TenantMember, str]:
    from app.core.services import mailer

    email = email.strip().lower()
    if role not in ROLES:
        raise err(status.HTTP_400_BAD_REQUEST, "team_role_unknown")
    owner = db.execute(select(User.email).where(User.tenant_id == tenant_id).order_by(User.id)).scalar()
    if email == (owner or "").lower() or email == inviter.email.lower():
        raise err(status.HTTP_400_BAD_REQUEST, "team_invite_self")
    if db.execute(select(TenantMember.id).where(TenantMember.tenant_id == tenant_id, TenantMember.email == email,
                                                TenantMember.status != "removed")).first():
        raise err(status.HTTP_409_CONFLICT, "team_already_member")
    cap = limit(db, tenant_id)
    if open_count(db, tenant_id) >= cap:
        raise err(status.HTTP_402_PAYMENT_REQUIRED, "team_limit_reached", limit=cap)
    token = secrets.token_urlsafe(24)
    row = TenantMember(tenant_id=tenant_id, email=email, role=role, status="invited", token_hash=_hash(token),
                       invited_by=inviter.id, expires_at=now() + timedelta(days=INVITE_DAYS))
    db.add(row)
    db.flush()
    known = db.execute(select(User).where(func.lower(User.email) == email)).scalars().first()
    lang = ((known.settings or {}).get("language") if known else None) or (inviter.settings or {}).get("language") or "en"
    mailer.send(db, "team_invite", email, {"name": known.name if known else email.split("@")[0], "inviter": inviter.name,
                                            "channel": channel_name, "role": role,
                                            "link": f"{settings.STUDIO_APP_URL}/team/accept?token={token}",
                                            "days": INVITE_DAYS}, lang=lang if lang in ("en", "hi") else "en", tenant_id=tenant_id)
    audit.record(db, action="team.invite", target_table="kv_admin.tenant_members", target_id=row.id,
                 after={"email": email, "role": role})
    if known is not None:
        from app.video.after_commit import later
        from app.video.services import push

        later(db, push.notify_job, known.id, "team_invite", f"{inviter.name} invited you to {channel_name}",
              f"Join as {role}", {"url": f"/team/accept?token={token}"}, f"team-invite:{row.id}")
    return row, token


def accept(db: Session, user: User, token: str) -> TenantMember:
    row = db.execute(select(TenantMember).where(TenantMember.token_hash == _hash(token))).scalars().first()
    if row is None or row.status != "invited":
        raise err(status.HTTP_404_NOT_FOUND, "team_invite_not_found")
    if row.expires_at and row.expires_at <= now():
        raise err(status.HTTP_410_GONE, "team_invite_expired")
    if row.email != user.email.strip().lower():
        raise err(status.HTTP_403_FORBIDDEN, "team_invite_other_email")
    if row.tenant_id == user.tenant_id:
        raise err(status.HTTP_400_BAD_REQUEST, "team_invite_self")
    row.status, row.user_id, row.accepted_at, row.token_hash = "active", user.id, now(), None
    db.flush()
    audit.record(db, action="team.accept", target_table="kv_admin.tenant_members", target_id=row.id,
                 after={"user_id": user.id, "role": row.role})
    return row


def get(db: Session, tenant_id: int, member_id: int) -> TenantMember:
    row = db.get(TenantMember, member_id)
    if row is None or row.tenant_id != tenant_id or row.status == "removed":
        raise err(status.HTTP_404_NOT_FOUND, "team_member_not_found")
    return row


def set_role(db: Session, row: TenantMember, role: str) -> TenantMember:
    if role not in ROLES:
        raise err(status.HTTP_400_BAD_REQUEST, "team_role_unknown")
    before = row.role
    row.role = role
    db.flush()
    audit.record(db, action="team.role", target_table="kv_admin.tenant_members", target_id=row.id,
                 before={"role": before}, after={"role": role})
    return row


def remove(db: Session, row: TenantMember) -> TenantMember:
    row.status, row.removed_at, row.token_hash = "removed", now(), None
    db.flush()
    audit.record(db, action="team.remove", target_table="kv_admin.tenant_members", target_id=row.id,
                 before={"email": row.email, "role": row.role})
    return row


def membership(db: Session, user: User, tenant_id: int) -> TenantMember | None:
    return db.execute(select(TenantMember).where(TenantMember.tenant_id == tenant_id, TenantMember.user_id == user.id,
                                                 TenantMember.status == "active")).scalars().first()


def memberships(db: Session, user: User) -> list[TenantMember]:
    return list(db.execute(select(TenantMember).where(TenantMember.user_id == user.id, TenantMember.status == "active")
                           .order_by(TenantMember.id)).scalars())


def level(db: Session, tenant_id: int, role: str, key: str) -> int:
    if key in OWNER_ONLY:
        return 0
    row = db.execute(select(RolePermission.access_level).where(
        RolePermission.tenant_id == tenant_id, RolePermission.role == role, RolePermission.permission_key == key)).scalar()
    return LEVELS.get(row if row else defaults_for(role).get(key, "none"), 0)


def can_act(db: Session, user: User, tenant_id: int, keys: tuple[str, ...], need: str = "full") -> bool:
    if user.tenant_id == tenant_id:
        return True
    member = membership(db, user, tenant_id)
    return member is not None and any(level(db, tenant_id, member.role, k) >= LEVELS.get(need, 2) for k in keys)


def assert_member(db: Session, tenant_id: int, member: TenantMember, key: str, need: str) -> None:
    if level(db, tenant_id, member.role, key) < LEVELS.get(need, 1):
        raise err(status.HTTP_403_FORBIDDEN, "insufficient_permissions")
