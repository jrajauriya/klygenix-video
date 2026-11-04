from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.messages import err
from app.core.models.team import TenantMember
from app.core.models.user import User
from app.core.services import teams
from app.core.services.feature_catalog import all_feature_keys
from app.core.services.permission_defaults import LEVELS
from app.video.models.social import Channel
from app.video.present import iso
from app.video.routers.deps import Ctx, StudioCtx, signed_in, studio
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video", tags=["teams"])


class InviteIn(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)
    role: str = Field(pattern="^(manager|editor|moderator|analyst)$")


class RoleIn(BaseModel):
    role: str = Field(pattern="^(manager|editor|moderator|analyst)$")


class AcceptIn(BaseModel):
    token: str = Field(min_length=10, max_length=100)


def _out(db, m: TenantMember) -> dict:
    u = db.get(User, m.user_id) if m.user_id else None
    return {"id": m.id, "email": m.email, "name": u.name if u else None, "role": m.role, "status": m.status,
            "invited_at": iso(m.created_at), "accepted_at": iso(m.accepted_at), "expires_at": iso(m.expires_at)}


def _manage(ctx: StudioCtx, member: TenantMember | None = None) -> None:
    if ctx.member is not None and ctx.member.role != "manager":
        raise err(status.HTTP_403_FORBIDDEN, "insufficient_permissions")
    if member is not None and ctx.member is not None and member.id == ctx.member.id:
        raise err(status.HTTP_400_BAD_REQUEST, "team_cannot_change_self")


@router.get("/studio/team")
def team(ctx: StudioCtx = Depends(studio("video.users"))):
    rows = teams.members(ctx.db, ctx.tenant_id)
    return {"members": [_out(ctx.db, m) for m in rows], "limit": teams.limit(ctx.db, ctx.tenant_id),
            "roles": list(teams.ROLES), "owner_only": sorted(teams.OWNER_ONLY)}


@router.post("/studio/team/invites", status_code=201)
def invite(data: InviteIn, ctx: StudioCtx = Depends(studio("video.users", "full"))):
    _manage(ctx)
    row, _ = teams.invite(ctx.db, ctx.tenant_id, ctx.user, str(data.email), data.role, ctx.channel.name)
    ctx.db.commit()
    return _out(ctx.db, row)


@router.patch("/studio/team/{member_id}")
def change_role(member_id: int, data: RoleIn, ctx: StudioCtx = Depends(studio("video.users", "full"))):
    row = teams.get(ctx.db, ctx.tenant_id, member_id)
    _manage(ctx, row)
    teams.set_role(ctx.db, row, data.role)
    ctx.db.commit()
    return _out(ctx.db, row)


@router.delete("/studio/team/{member_id}")
def remove(member_id: int, ctx: StudioCtx = Depends(studio("video.users", "full"))):
    row = teams.get(ctx.db, ctx.tenant_id, member_id)
    _manage(ctx, row)
    teams.remove(ctx.db, row)
    ctx.db.commit()
    return {"ok": True}


@router.get("/studio/team/me")
def acting(ctx: StudioCtx = Depends(studio("video.dashboard", need_channel=False))):
    keys = all_feature_keys("video")
    if ctx.member is None:
        from app.core.middleware.auth import has_permission

        perms = {k: next((lv for lv in ("full", "view") if has_permission(ctx.db, ctx.user, k, lv)), "none") for k in keys}
    else:
        names = {v: k for k, v in LEVELS.items()}
        perms = {k: names[teams.level(ctx.db, ctx.tenant_id, ctx.member.role, k)] for k in keys}
    from app.video.commerce import quotas
    from app.video.routers.billing import plan_out

    owner = quotas.owner_user_id(ctx.db, ctx.tenant_id)
    plan = quotas.active_plan(ctx.db, owner, "creator") if owner else None
    usage = [quotas.usage(ctx.db, owner, m) for m in ("ai_minutes", "renders", "ai_images")] if owner else []
    return {"tenant_id": ctx.tenant_id, "role": ctx.member.role if ctx.member else "owner", "member": ctx.member is not None,
            "channel": {"name": ctx.channel.name, "handle": ctx.channel.handle} if ctx.channel else None, "permissions": perms,
            "plan": plan_out(plan, "IN") if plan else None, "usage": usage}


@router.get("/team/invite")
def preview(token: str, ctx: Ctx = Depends(signed_in)):
    from hashlib import sha256

    with platform_session() as db:
        row = db.execute(select(TenantMember).where(TenantMember.token_hash == sha256(token.strip().encode()).hexdigest(),
                                                    TenantMember.status == "invited")).scalars().first()
        if row is None:
            raise err(status.HTTP_404_NOT_FOUND, "team_invite_not_found")
        if row.expires_at and row.expires_at <= teams.now():
            raise err(status.HTTP_410_GONE, "team_invite_expired")
        ch = db.execute(select(Channel).where(Channel.tenant_id == row.tenant_id)).scalars().first()
        inviter = db.get(User, row.invited_by) if row.invited_by else None
        return {"channel": {"name": ch.name, "handle": ch.handle} if ch else None, "role": row.role,
                "inviter": inviter.name if inviter else None, "expires_at": iso(row.expires_at),
                "for_you": row.email == ctx.user.email.strip().lower()}


@router.post("/team/accept")
def accept(data: AcceptIn, ctx: Ctx = Depends(signed_in)):
    row = teams.accept(ctx.db, ctx.user, data.token)
    ctx.db.commit()
    return {"tenant_id": row.tenant_id, "role": row.role}


@router.get("/me/channels")
def my_channels(ctx: Ctx = Depends(signed_in)):
    own = ctx.db.execute(select(Channel).where(Channel.tenant_id == ctx.tenant_id)).scalars().first()
    out = [{"tenant_id": ctx.tenant_id, "role": "owner", "name": own.name, "handle": own.handle}] if own else []
    rows = teams.memberships(ctx.db, ctx.user)
    if rows:
        with platform_session() as db:
            chans = {c.tenant_id: c for c in db.execute(select(Channel).where(
                Channel.tenant_id.in_([m.tenant_id for m in rows]))).scalars()}
            out += [{"tenant_id": m.tenant_id, "role": m.role, "name": chans[m.tenant_id].name, "handle": chans[m.tenant_id].handle}
                    for m in rows if m.tenant_id in chans]
    return out


@router.post("/me/channels/{tenant_id}/leave")
def leave(tenant_id: int, ctx: Ctx = Depends(signed_in)):
    row = teams.membership(ctx.db, ctx.user, tenant_id)
    if row is None:
        raise err(status.HTTP_404_NOT_FOUND, "team_member_not_found")
    teams.remove(ctx.db, row)
    ctx.db.commit()
    return {"ok": True}
