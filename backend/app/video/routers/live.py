from __future__ import annotations

import asyncio
import json
import os
import subprocess
from datetime import datetime

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import settings
from app.core import audit
from app.core.messages import err
from app.core.redis_client import get_redis
from app.video.live import service
from app.video.media.ffmpeg import FFMPEG
from app.video.media.signing import alive, expiry, sign, valid
from app.video.models.community import LiveMessage
from app.video.models.media import LiveStream, Video
from app.video.models.social import Channel, Profile
from app.video.present import iso
from app.video.realtime.rooms import publish as _publish
from app.video.routers.deps import Ctx, StudioCtx, Viewer, optional_viewer, platform, signed_in, studio
from app.video.sessions import platform_session
from app.video.services import handles

router = APIRouter(prefix="/api/video", tags=["live"])
ROOM_OFFSET = 10**12


def room_id(s: LiveStream) -> int:
    return ROOM_OFFSET + s.id


def emit(s: LiveStream, event: dict) -> None:
    _publish(room_id(s), event)


def viewers(s: LiveStream) -> int:
    try:
        return int(get_redis().scard(f"kv:live:{s.id}:members"))
    except Exception:
        return 0


def message_out(m: LiveMessage, viewer_id: int | None = None) -> dict:
    out = {"id": m.id, "kind": m.kind, "body": m.body, "author": m.author_name, "paid_minor": m.paid_minor,
           "tier": m.tier, "pinned_until": iso(m.pinned_until), "created_at": iso(m.created_at)}
    if viewer_id is not None:
        out["mine"] = m.user_id == viewer_id
    return out


def _stream(db, public_id: str) -> LiveStream:
    s = db.execute(select(LiveStream).where(LiveStream.public_id == public_id)).scalars().first()
    if s is None:
        raise err(404, "live_not_found")
    return s


def detail(db, s: LiveStream, user) -> dict:
    ch = db.get(Channel, s.channel_id)
    out = service.out(s, ch, viewers(s))
    ok = service.allowed(db, user, s)
    out["locked"] = None if ok else {"access": "members", "members_rank": s.members_rank}
    out["playback"] = service.playback(s) if ok else None
    out["is_owner"] = bool(user and user.tenant_id == s.tenant_id)
    if user is not None:
        from app.video.models.social import Follow

        out["following"] = db.execute(select(Follow.id).where(Follow.user_id == user.id,
                                                              Follow.channel_id == s.channel_id)).first() is not None

    replay = db.get(Video, s.replay_video_id) if s.replay_video_id else None
    out["replay"] = None if replay is None else {"id": replay.public_id, "status": replay.status}
    pinned = db.execute(select(LiveMessage).where(LiveMessage.stream_id == s.id, LiveMessage.status == "visible",
                                                  LiveMessage.pinned_until > service.now())
                        .order_by(LiveMessage.paid_minor.desc())).scalars().all()
    out["pinned"] = [message_out(m) for m in pinned]
    return out


@router.get("/live")
def live_now(limit: int = Query(20, le=50)):
    with platform_session() as db:
        rows = db.execute(select(LiveStream).join(Channel, Channel.id == LiveStream.channel_id).where(
            LiveStream.status == "live", Channel.is_suspended.is_(False)).order_by(LiveStream.started_at.desc())
            .limit(limit)).scalars().all()
        return [service.out(s, db.get(Channel, s.channel_id), viewers(s)) for s in rows]


@router.get("/live/{public_id}")
def live_detail(public_id: str, viewer: Viewer = Depends(optional_viewer)):
    with platform_session() as db:
        return detail(db, _stream(db, public_id), viewer.user)


@router.get("/channels/{handle}/live")
def channel_live(handle: str):
    with platform_session() as db:
        ch = handles.resolve(db, handle)[0]
        if ch is None:
            raise err(404, "channel_not_found")
        rows = db.execute(select(LiveStream).where(LiveStream.channel_id == ch.id, LiveStream.status.in_(("scheduled", "live")))
                          .order_by(LiveStream.created_at.desc())).scalars().all()
        return [service.out(s, ch, viewers(s)) for s in rows]


@router.get("/live/{public_id}/chat")
def chat_history(public_id: str, limit: int = Query(50, le=200), viewer: Viewer = Depends(optional_viewer)):
    with platform_session() as db:
        s = _stream(db, public_id)
        if not service.allowed(db, viewer.user, s):
            raise err(402, "video_locked")
        rows = db.execute(select(LiveMessage).where(LiveMessage.stream_id == s.id, LiveMessage.status == "visible")
                          .order_by(LiveMessage.id.desc()).limit(limit)).scalars().all()
        uid = viewer.user.id if viewer.user else None
        return [message_out(m, uid) for m in reversed(rows)]


class ChatIn(BaseModel):
    body: str = Field(min_length=1, max_length=200)


def can_moderate(db, user, s: LiveStream) -> bool:
    from app.video.routers.community import can_moderate as mod

    return mod(db, user, s.channel_id)


@router.post("/live/{public_id}/chat", status_code=201)
def post_chat(public_id: str, data: ChatIn, ctx: Ctx = Depends(signed_in)):
    from app.video.social.filter import clean, has_link

    with platform_session() as db:
        s = _stream(db, public_id)
        if s.status != "live":
            raise err(409, "live_not_live")
        if not service.allowed(db, ctx.user, s):
            raise err(402, "video_locked")
        r = get_redis()
        if r.exists(f"kv:live:{s.id}:to:{ctx.user.id}"):
            raise err(403, "live_timed_out")
        mod = can_moderate(db, ctx.user, s)
        if s.slow_mode_seconds and not mod and not r.set(f"kv:live:{s.id}:slow:{ctx.user.id}", 1, nx=True,
                                                          ex=s.slow_mode_seconds):
            raise err(429, "live_slow_mode", seconds=s.slow_mode_seconds)
        ok, text = clean(data.body.strip())
        if not text:
            raise err(400, "comment_empty")
        if not ok or has_link(text):
            raise err(400, "danmaku_blocked_words")
        prof = db.get(Profile, ctx.user.id)
        m = LiveMessage(tenant_id=ctx.tenant_id, stream_id=s.id, user_id=ctx.user.id,
                        author_name=((prof.display_name if prof else None) or ctx.user.name or "Viewer")[:80],
                        kind="chat", body=text)
        db.add(m)
        db.commit()
        item = message_out(m)
        item["moderator"] = mod
        emit(s, {"type": "chat", "item": item})
        return item


class ModerateIn(BaseModel):
    action: str
    message_id: int | None = None
    user_id: int | None = None
    seconds: int = Field(default=300, ge=10, le=86400)


@router.post("/live/{public_id}/moderate")
def moderate(public_id: str, data: ModerateIn, ctx: Ctx = Depends(signed_in)):
    from app.core.audit import USER, Actor

    with platform_session(Actor(USER, user_id=ctx.user.id, label=ctx.user.email)) as db:
        s = _stream(db, public_id)
        if not can_moderate(db, ctx.user, s):
            raise err(403, "action_not_allowed")
        if data.action == "hide" and data.message_id:
            m = db.get(LiveMessage, data.message_id)
            if m is None or m.stream_id != s.id:
                raise err(404, "action_not_allowed")
            refund = service.hide_message(db, m, ctx.user.id)
            db.commit()
            emit(s, {"type": "chat_removed", "id": m.id})
            return {"ok": True, "refunded": bool(refund)}
        if data.action == "timeout" and data.message_id and not data.user_id:
            target = db.get(LiveMessage, data.message_id)
            if target is None or target.stream_id != s.id:
                raise err(404, "action_not_allowed")
            data.user_id = target.user_id
        if data.action == "timeout" and data.user_id:
            get_redis().setex(f"kv:live:{s.id}:to:{data.user_id}", data.seconds, 1)
            emit(s, {"type": "timeout", "user_id": data.user_id, "seconds": data.seconds})
            return {"ok": True}
        if data.action == "slow_mode":
            s.slow_mode_seconds = max(0, min(data.seconds if data.seconds else 0, 600))
            db.commit()
            emit(s, {"type": "slow_mode", "seconds": s.slow_mode_seconds})
            return {"ok": True, "slow_mode_seconds": s.slow_mode_seconds}
        if data.action == "slow_mode_off":
            s.slow_mode_seconds = 0
            db.commit()
            emit(s, {"type": "slow_mode", "seconds": 0})
            return {"ok": True, "slow_mode_seconds": 0}
        raise err(400, "action_not_allowed")


_ROOMS: dict[str, tuple[float, tuple[int, int, str] | None]] = {}


def _room_lookup(public_id: str) -> tuple[int, int, str] | None:
    import time

    hit = _ROOMS.get(public_id)
    if hit and hit[0] > time.time():
        return hit[1]
    with platform_session() as db:
        s = db.execute(select(LiveStream).where(LiveStream.public_id == public_id)).scalars().first()
        found = None if s is None else (s.id, room_id(s), s.status)
    if len(_ROOMS) > 2000:
        _ROOMS.clear()
    _ROOMS[public_id] = (time.time() + 5, found)
    return found


@router.websocket("/ws/live/{public_id}")
async def live_room(websocket: WebSocket, public_id: str):
    from app.video.realtime.hub import hub, relay
    from app.video.realtime.rooms import channel as room_channel

    found = await asyncio.to_thread(_room_lookup, public_id)
    if found is None:
        await websocket.close(code=4404)
        return
    sid, rid, status = found
    await websocket.accept()
    client = await hub.client()
    q = await hub.subscribe(room_channel(rid))
    members = f"kv:live:{sid}:members"
    me = os.urandom(8).hex()
    await client.sadd(members, me)
    await client.expire(members, 12 * 3600)
    count = int(await client.scard(members))
    await client.publish(room_channel(rid), json.dumps({"type": "viewers", "viewers": count}))
    peak = f"kv:live:{sid}:peak"
    if count > int(await client.get(peak) or 0):
        await client.set(peak, count, ex=12 * 3600)
    task = asyncio.create_task(relay(websocket, q))
    try:
        await websocket.send_text(json.dumps({"type": "hello", "status": status, "viewers": count}))
        while True:
            if await websocket.receive_text() == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        await client.srem(members, me)
        try:
            await client.publish(room_channel(rid), json.dumps({"type": "viewers", "viewers": int(await client.scard(members))}))
        except Exception:
            pass
        await hub.unsubscribe(room_channel(rid), q)


class StreamIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=5000)
    scheduled_at: datetime | None = None
    members_rank: int | None = Field(default=None, ge=1, le=5)
    replay_enabled: bool = True
    slow_mode_seconds: int = Field(default=0, ge=0, le=600)


def studio_out(s: LiveStream) -> dict:
    from sqlalchemy.orm import object_session

    out = service.out(s, None, viewers(s))
    replay = None
    db = object_session(s)
    if s.replay_video_id and db is not None:
        v = db.get(Video, s.replay_video_id)
        replay = {"id": v.public_id, "video_id": v.id, "status": v.status} if v is not None else None
    out.update(db_id=s.id, error=s.error, replay_video_id=s.replay_video_id, provider=s.provider,
               playback=service.playback(s), replay=replay,
               ingest=_ingest(s))
    return out


def _ingest(s: LiveStream) -> dict:
    if s.provider == "cloudflare":
        return {"protocol": "rtmps", "server": service.cloudflare.RTMPS, "browser": False}
    return {"protocol": "rtmp", "server": f"rtmp://{settings.LIVE_RTMP_HOST}:{s.ingest_port}/live",
            "browser": s.provider == "sandbox" and settings.SANDBOX_ENABLED}


def _own(ctx: StudioCtx, public_id: str) -> LiveStream:
    s = _stream(ctx.db, public_id)
    if s.tenant_id != ctx.tenant_id:
        raise err(404, "live_not_found")
    return s


def _plan_allows(ctx: StudioCtx) -> None:
    from app.video.commerce import quotas

    owner = quotas.owner_user_id(ctx.db, ctx.tenant_id)
    if owner and not (quotas.active_plan(ctx.db, owner, "creator").limits or {}).get("live", True):
        raise err(402, "live_plan_required")


@router.get("/studio/live")
def studio_streams(ctx: StudioCtx = Depends(studio("video.live"))):
    rows = ctx.db.execute(select(LiveStream).where(LiveStream.tenant_id == ctx.tenant_id)
                          .order_by(LiveStream.created_at.desc()).limit(50)).scalars().all()
    return [studio_out(s) for s in rows]


@router.post("/studio/live", status_code=201)
def create_stream(data: StreamIn, ctx: StudioCtx = Depends(studio("video.live", "full"))):
    _plan_allows(ctx)
    with platform_session() as db:
        s = service.create(db, channel=db.get(Channel, ctx.channel.id), title=data.title, description=data.description,
                           scheduled_at=data.scheduled_at, members_rank=data.members_rank,
                           replay_enabled=data.replay_enabled)
        s.slow_mode_seconds = data.slow_mode_seconds
        db.commit()
        return {**studio_out(s), "stream_key": service.key_of(s)}


@router.get("/studio/live/{public_id}")
def studio_stream(public_id: str, ctx: StudioCtx = Depends(studio("video.live"))):
    return studio_out(_own(ctx, public_id))


@router.get("/studio/live/{public_id}/key")
def stream_key(public_id: str, ctx: StudioCtx = Depends(studio("video.live", "full"))):
    s = _own(ctx, public_id)
    _plan_allows(ctx)
    return {"server": _ingest(s)["server"], "stream_key": service.key_of(s)}


@router.post("/studio/live/{public_id}/rotate-key")
def rotate(public_id: str, ctx: StudioCtx = Depends(studio("video.live", "full"))):
    s = _own(ctx, public_id)
    service.rotate_key(ctx.db, s)
    ctx.db.commit()
    return {"stream_key": service.key_of(s)}


class StreamPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=5000)
    slow_mode_seconds: int | None = Field(default=None, ge=0, le=600)
    replay_enabled: bool | None = None
    members_rank: int | None = Field(default=None, ge=1, le=5)
    scheduled_at: datetime | None = None


@router.patch("/studio/live/{public_id}")
def patch_stream(public_id: str, data: StreamPatch, ctx: StudioCtx = Depends(studio("video.live", "full"))):
    s = _own(ctx, public_id)
    for f in ("title", "description", "slow_mode_seconds", "replay_enabled"):
        v = getattr(data, f)
        if v is not None:
            setattr(s, f, v.strip() if isinstance(v, str) else v)
    if "members_rank" in data.model_fields_set:
        s.members_rank = data.members_rank
    if "scheduled_at" in data.model_fields_set:
        if s.status != "scheduled":
            raise err(409, "action_not_allowed")
        s.scheduled_at = data.scheduled_at
    ctx.db.commit()
    if data.slow_mode_seconds is not None:
        emit(s, {"type": "slow_mode", "seconds": s.slow_mode_seconds})
    return studio_out(s)


@router.post("/studio/live/{public_id}/end")
def end_stream(public_id: str, ctx: StudioCtx = Depends(studio("video.live", "full"))):
    s = _own(ctx, public_id)
    service.end(ctx.db, s)
    ctx.db.commit()
    emit(s, {"type": "ended"})
    return studio_out(s)


@router.get("/studio/live/{public_id}/ingest-ticket")
def ingest_ticket(public_id: str, ctx: StudioCtx = Depends(studio("video.live", "full"))):
    s = _own(ctx, public_id)
    if s.provider != "sandbox" or not settings.SANDBOX_ENABLED:
        raise err(404, "sandbox_only")
    exp = expiry(600)
    return {"ticket": f"{exp}.{sign('live-ingest', s.id, exp)}", "expires_at": exp}


@router.websocket("/ws/live/{public_id}/ingest")
async def browser_ingest(websocket: WebSocket, public_id: str, ticket: str = ""):
    from app.video.live.worker import outputs

    with platform_session() as db:
        s = db.execute(select(LiveStream).where(LiveStream.public_id == public_id)).scalars().first()
        exp, _, sig = ticket.partition(".")
        if (s is None or s.provider != "sandbox" or not settings.SANDBOX_ENABLED or s.status not in service.ACTIVE
                or not exp.isdigit() or not alive(int(exp)) or not valid(sig, "live-ingest", s.id, int(exp))):
            await websocket.close(code=4403)
            return
        sid = s.id
    await websocket.accept()
    directory = service.live_dir(sid)
    session = f"b{int(datetime.now().timestamp() * 1000)}"
    proc = subprocess.Popen([FFMPEG, "-nostdin", "-loglevel", "error", "-fflags", "+genpts", "-i", "pipe:0",
                             *outputs(directory, session)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    try:
        while True:
            chunk = await websocket.receive_bytes()
            await asyncio.to_thread(proc.stdin.write, chunk)
    except (WebSocketDisconnect, BrokenPipeError, RuntimeError):
        pass
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        await asyncio.to_thread(proc.wait, 20)


@router.get("/sandbox/live/{stream_id}/{exp}/{sig}/{name}")
def live_file(stream_id: int, exp: int, sig: str, name: str):
    if not settings.SANDBOX_ENABLED:
        raise err(404, "sandbox_only")
    if not alive(exp) or not valid(sig, "live", stream_id, exp):
        raise err(403, "upload_link_expired")
    if "/" in name or ".." in name or not (name == "index.m3u8" or (name.startswith("seg_") and name.endswith(".ts"))):
        raise err(404, "live_not_found")
    path = os.path.join(service.live_dir(stream_id), name)
    if not os.path.isfile(path):
        raise err(404, "live_not_found")
    headers = {"Access-Control-Allow-Origin": "*",
               "Cache-Control": "no-cache" if name.endswith(".m3u8") else "private, max-age=600"}
    return FileResponse(path, media_type="application/vnd.apple.mpegurl" if name.endswith(".m3u8") else "video/mp2t",
                        headers=headers)


@router.get("/admin/live")
def admin_streams(status: str | None = None, ctx: Ctx = Depends(platform("admin.moderation"))):
    q = select(LiveStream)
    if status:
        q = q.where(LiveStream.status == status)
    rows = ctx.db.execute(q.order_by(LiveStream.created_at.desc()).limit(100)).scalars().all()
    return [{**service.out(s, ctx.db.get(Channel, s.channel_id), viewers(s)), "tenant_id": s.tenant_id, "error": s.error}
            for s in rows]


class StopIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/admin/live/{public_id}/stop")
def admin_stop(public_id: str, data: StopIn, ctx: Ctx = Depends(platform("admin.moderation", "full"))):
    s = _stream(ctx.db, public_id)
    service.stop(ctx.db, s, data.reason)
    audit.record(ctx.db, action="live.stop", target_table="kv_media.live_streams", target_id=s.id, after={"reason": data.reason})
    ctx.db.commit()
    emit(s, {"type": "ended", "reason": "platform"})
    return {"ok": True}

