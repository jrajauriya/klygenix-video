from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update

from app.core import audit
from app.core.messages import err
from app.video.models.ai import AskMessage
from app.video.models.commerce import Checkout, Subscription, UsageCounter
from app.video.models.media import Video
from app.video.models.social import (
    Channel, Comment, Danmaku, DeviceToken, Follow, Like, Playlist, Profile, WatchProgress,
)
from app.video.models.trust import Appeal, Report
from app.video.present import iso
from app.video.routers.deps import Ctx, signed_in

router = APIRouter(prefix="/api/video", tags=["me"])


class PushToken(BaseModel):
    token: str = Field(min_length=10, max_length=300)
    platform: str = Field(pattern=r"^(ios|android|web)$")


class ForgetToken(BaseModel):
    token: str = Field(min_length=10, max_length=300)


@router.post("/devices/push-token")
def save_push_token(data: PushToken, ctx: Ctx = Depends(signed_in)):
    from app.video.sessions import platform_session

    with platform_session() as db:
        row = db.execute(select(DeviceToken).where(DeviceToken.token == data.token)).scalars().first()
        if row is None:
            db.add(DeviceToken(tenant_id=ctx.tenant_id, user_id=ctx.user.id, token=data.token, platform=data.platform))
        else:
            row.tenant_id, row.user_id, row.platform = ctx.tenant_id, ctx.user.id, data.platform
            row.last_seen_at = datetime.now(timezone.utc)
        db.commit()
    return {"saved": True}


@router.post("/devices/push-token/forget")
def forget_push_token(data: ForgetToken, ctx: Ctx = Depends(signed_in)):
    ctx.db.execute(delete(DeviceToken).where(DeviceToken.token == data.token, DeviceToken.user_id == ctx.user.id))
    ctx.db.commit()
    return {"forgotten": True}


def rows(db, model, *where) -> list:
    return db.execute(select(model).where(*where)).scalars().all()


@router.post("/me/export")
def export(ctx: Ctx = Depends(signed_in)):
    db, uid, u = ctx.db, ctx.user.id, ctx.user
    profile = db.get(Profile, uid)
    channel = db.execute(select(Channel).where(Channel.tenant_id == ctx.tenant_id)).scalars().first()
    vids = {v.id: v.public_id for v in rows(db, Video, Video.tenant_id == ctx.tenant_id)}
    watched = rows(db, WatchProgress, WatchProgress.user_id == uid)
    liked = rows(db, Like, Like.user_id == uid)
    ref = {v.id: v.public_id for v in db.execute(select(Video).where(
        Video.id.in_({r.video_id for r in watched} | {r.video_id for r in liked}))).scalars().all()} if (watched or liked) else {}
    data = {
        "exported_at": iso(datetime.now(timezone.utc)),
        "account": {"id": uid, "email": u.email, "name": u.name, "created_at": iso(u.created_at),
                    "last_login": iso(u.last_login), "settings": u.settings or {}},
        "profile": None if profile is None else {
            "display_name": profile.display_name, "birth_date": profile.birth_date.isoformat() if profile.birth_date else None,
            "country": profile.country, "language": profile.language, "danmaku_prefs": profile.danmaku_prefs},
        "channel": None if channel is None else {"handle": channel.handle, "name": channel.name, "about": channel.about,
                                                 "created_at": iso(channel.created_at)},
        "videos": [{"id": pid} for pid in vids.values()],
        "following": [r.channel_id for r in rows(db, Follow, Follow.user_id == uid)],
        "likes": [ref.get(r.video_id) for r in liked],
        "history": [{"video": ref.get(r.video_id), "position_ms": r.position_ms, "completed": r.completed,
                     "updated_at": iso(r.updated_at)} for r in watched],
        "comments": [{"id": r.id, "video_id": r.video_id, "body": r.body, "status": r.status, "created_at": iso(r.created_at)}
                     for r in rows(db, Comment, Comment.user_id == uid)],
        "danmaku": [{"id": r.id, "video_id": r.video_id, "text": r.text, "t_ms": r.t_ms, "created_at": iso(r.created_at)}
                    for r in rows(db, Danmaku, Danmaku.user_id == uid)],
        "questions": [{"video_id": r.video_id, "question": r.question, "answer": r.answer, "status": r.status,
                       "created_at": iso(r.created_at)} for r in rows(db, AskMessage, AskMessage.user_id == uid)],
        "playlists": [{"id": r.id, "title": r.title, "visibility": r.visibility} for r in rows(db, Playlist, Playlist.tenant_id == ctx.tenant_id)],
        "subscriptions": [{"plan_key": r.plan_key, "status": r.status, "current_period_end": iso(r.current_period_end)}
                          for r in rows(db, Subscription, Subscription.user_id == uid)],
        "checkouts": [{"id": r.id, "plan_key": r.plan_key, "amount_minor": r.amount_minor, "currency": r.currency,
                       "status": r.status, "created_at": iso(r.created_at)} for r in rows(db, Checkout, Checkout.user_id == uid)],
        "reports_filed": [{"target_type": r.target_type, "reason": r.reason, "status": r.status, "created_at": iso(r.created_at)}
                          for r in rows(db, Report, Report.reporter_user_id == uid)],
        "appeals": [{"id": r.id, "status": r.status, "created_at": iso(r.created_at)} for r in rows(db, Appeal, Appeal.user_id == uid)],
    }
    audit.record(db, action="data.export", target_table="kv_admin.users", target_id=uid)
    db.commit()
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="klygenix-play-{uid}.json"',
                                       "Cache-Control": "no-store"})


class EraseIn(BaseModel):
    confirm: str


@router.delete("/me", status_code=204)
def erase(data: EraseIn, ctx: Ctx = Depends(signed_in)):
    if data.confirm != "DELETE":
        raise err(400, "confirm_erase")
    db, uid, u = ctx.db, ctx.user.id, ctx.user
    paid = db.execute(select(Subscription).where(Subscription.user_id == uid, Subscription.status.in_(("active", "grace")),
                                                 Subscription.cancel_at_period_end.is_(False))).scalars().first()
    if paid is not None:
        raise err(409, "cancel_plan_first")
    for model in (Follow, Like, WatchProgress, AskMessage, UsageCounter, DeviceToken):
        db.execute(delete(model).where(model.user_id == uid))
    db.execute(update(Comment).where(Comment.user_id == uid).values(status="deleted", body="", author_name="Deleted user"))
    db.execute(update(Danmaku).where(Danmaku.user_id == uid).values(status="deleted", text=""))
    db.execute(update(Playlist).where(Playlist.tenant_id == ctx.tenant_id).values(visibility="private"))
    channel = db.execute(select(Channel).where(Channel.tenant_id == ctx.tenant_id)).scalars().first()
    if channel is not None:
        db.execute(update(Video).where(Video.tenant_id == ctx.tenant_id).values(is_deleted=True))
        channel.is_suspended = True
        channel.name = "Deleted channel"
        channel.about = ""
    profile = db.get(Profile, uid)
    if profile is not None:
        profile.display_name = "Deleted user"
        profile.birth_date = None
        profile.danmaku_prefs = {}
    u.email = f"erased-{uid}@erased.invalid"
    u.name = "Deleted user"
    u.password_hash = None
    u.phone = None
    u.totp_secret = None
    u.totp_enabled_at = None
    u.is_active = False
    u.settings = {}
    u.session_epoch = (u.session_epoch or 0) + 1
    audit.record(db, action="data.erase", target_table="kv_admin.users", target_id=uid,
                 after={"kept": "invoices, payments and ledger entries (tax law)"})
    db.commit()
    return Response(status_code=204)
