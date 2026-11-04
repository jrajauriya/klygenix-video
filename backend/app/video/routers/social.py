from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Query, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.messages import err
from app.video.models.media import Video
from app.video.models.social import Channel, Comment, Danmaku, Follow, Like, Profile, WatchProgress
from app.video.present import iso
from app.video.realtime.rooms import channel as room_channel
from app.video.realtime.rooms import publish
from app.video.routers import limits
from app.video.routers.deps import Ctx, Viewer, optional_viewer, signed_in
from app.video.routers.watch import readable
from app.video.sessions import platform_session
from app.video.social import counters, feed
from app.video.social.filter import clean, has_link

router = APIRouter(prefix="/api/video", tags=["social"])

MODES = ("scroll", "top", "bottom")
COLOR = r"^#[0-9A-Fa-f]{6}$"


def _channel(db, handle: str) -> Channel:
    c = db.execute(select(Channel).where(Channel.handle == handle.lower().lstrip("@"))).scalars().first()
    if c is None or c.is_suspended:
        raise err(404, "channel_not_found")
    return c


def _video_for(ctx: Ctx, public_id: str) -> Video:
    return readable(Viewer(db=ctx.db, user=ctx.user), public_id)


def _display_name(ctx: Ctx) -> str:
    p = ctx.db.get(Profile, ctx.user.id)
    return (p.display_name if p else ctx.user.name)[:80]


@router.post("/channels/{handle}/follow")
def follow(handle: str, ctx: Ctx = Depends(signed_in)):
    c = _channel(ctx.db, handle)
    if c.tenant_id == ctx.tenant_id:
        raise err(400, "action_not_allowed")
    try:
        ctx.db.add(Follow(tenant_id=ctx.tenant_id, user_id=ctx.user.id, channel_id=c.id))
        ctx.db.commit()
        counters.incr("channel", c.id, "follower_count", 1)
    except IntegrityError:
        ctx.db.rollback()
    return {"following": True}


@router.delete("/channels/{handle}/follow")
def unfollow(handle: str, ctx: Ctx = Depends(signed_in)):
    c = _channel(ctx.db, handle)
    row = ctx.db.execute(select(Follow).where(Follow.user_id == ctx.user.id, Follow.channel_id == c.id)).scalars().first()
    if row is not None:
        ctx.db.delete(row)
        ctx.db.commit()
        counters.incr("channel", c.id, "follower_count", -1)
    return {"following": False}


@router.get("/me/following")
def my_following(ctx: Ctx = Depends(signed_in)):
    from app.video.present import channel_card

    ids = ctx.db.execute(select(Follow.channel_id).where(Follow.user_id == ctx.user.id)).scalars().all()
    rows = ctx.db.execute(select(Channel).where(Channel.id.in_(ids))).scalars().all() if ids else []
    return [channel_card(c) for c in rows]


@router.post("/videos/{public_id}/like")
def like(public_id: str, ctx: Ctx = Depends(signed_in)):
    v = _video_for(ctx, public_id)
    try:
        ctx.db.add(Like(tenant_id=ctx.tenant_id, user_id=ctx.user.id, video_id=v.id))
        ctx.db.commit()
        counters.incr("video", v.id, "like_count", 1)
    except IntegrityError:
        ctx.db.rollback()
    return {"liked": True}


@router.delete("/videos/{public_id}/like")
def unlike(public_id: str, ctx: Ctx = Depends(signed_in)):
    v = _video_for(ctx, public_id)
    row = ctx.db.execute(select(Like).where(Like.user_id == ctx.user.id, Like.video_id == v.id)).scalars().first()
    if row is not None:
        ctx.db.delete(row)
        ctx.db.commit()
        counters.incr("video", v.id, "like_count", -1)
    return {"liked": False}


def comment_out(c: Comment, replies: int = 0, mine: bool = False, author_channel: Channel | None = None,
                is_creator: bool = False) -> dict:
    from app.video.services.images import public_url

    return {"id": c.id, "body": c.body if c.status == "visible" else "", "author": c.author_name,
            "parent_id": c.parent_id, "status": c.status, "created_at": iso(c.created_at), "replies": replies,
            "mine": mine, "is_creator": is_creator, "paid_minor": c.paid_minor,
            "author_channel": None if author_channel is None or author_channel.is_suspended else {
                "handle": author_channel.handle, "name": author_channel.name, "avatar": public_url(author_channel.avatar_key)}}


def author_channels(db, rows: list[Comment]) -> dict[int, Channel]:
    from app.core.models.user import User

    uids = {r.user_id for r in rows}
    if not uids:
        return {}
    pairs = db.execute(select(User.id, Channel).join(Channel, Channel.tenant_id == User.tenant_id).where(User.id.in_(uids))).all()
    return {uid: ch for uid, ch in pairs}


@router.get("/videos/{public_id}/comments")
def list_comments(public_id: str, response: Response, parent_id: int | None = None, limit: int = Query(30, le=100),
                  offset: int = 0, viewer: Viewer = Depends(optional_viewer)):
    v = readable(viewer, public_id)
    q = select(Comment).where(Comment.video_id == v.id, Comment.status == "visible")
    q = q.where(Comment.parent_id == parent_id) if parent_id else q.where(Comment.parent_id.is_(None))
    total = viewer.db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
    rows = viewer.db.execute(q.order_by(Comment.created_at.desc(), Comment.id.desc()).limit(limit).offset(offset)).scalars().all()
    reply_counts = dict(viewer.db.execute(select(Comment.parent_id, func.count(Comment.id)).where(
        Comment.parent_id.in_([r.id for r in rows]), Comment.status == "visible").group_by(Comment.parent_id)).all()) if rows else {}
    uid = viewer.user.id if viewer.user else None
    response.headers["X-Total-Count"] = str(total)
    chans = author_channels(viewer.db, rows)
    return [comment_out(r, reply_counts.get(r.id, 0), r.user_id == uid, chans.get(r.user_id),
                        chans.get(r.user_id) is not None and chans[r.user_id].id == v.channel_id) for r in rows]


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_id: int | None = None


@router.post("/videos/{public_id}/comments", status_code=201)
def post_comment(public_id: str, data: CommentIn, request: Request, ctx: Ctx = Depends(signed_in)):
    limits.comment(request, ctx.user.id)
    v = _video_for(ctx, public_id)
    ok, text = clean(data.body)
    if not text:
        raise err(400, "comment_empty")
    if not ok:
        raise err(400, "danmaku_blocked_words")
    if data.parent_id:
        parent = ctx.db.get(Comment, data.parent_id)
        if parent is None or parent.video_id != v.id:
            raise err(404, "video_not_found")
    c = Comment(tenant_id=ctx.tenant_id, video_id=v.id, user_id=ctx.user.id, author_name=_display_name(ctx),
                parent_id=data.parent_id, body=text, status="hidden" if has_link(text) else "visible")
    ctx.db.add(c)
    if data.parent_id and c.status == "visible" and parent.user_id != ctx.user.id:
        from app.video.services import inbox
        from app.video.sessions import platform_session

        with platform_session() as pdb:
            inbox.add(pdb, parent.user_id, "reply", f"{_display_name(ctx)} replied to your comment", text[:200],
                      f"/watch/{v.public_id}")
            pdb.commit()
    ctx.db.commit()
    if c.status == "visible":
        counters.incr("video", v.id, "comment_count", 1)
    chans = author_channels(ctx.db, [c])
    return comment_out(c, 0, True, chans.get(c.user_id), chans.get(c.user_id) is not None and chans[c.user_id].id == v.channel_id)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: int, ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        c = db.get(Comment, comment_id)
        if c is None:
            raise err(404, "video_not_found")
        v = db.get(Video, c.video_id)
        if c.user_id != ctx.user.id and (v is None or v.tenant_id != ctx.tenant_id):
            raise err(403, "action_not_allowed")
        if c.status == "visible":
            counters.incr("video", c.video_id, "comment_count", -1)
        c.status = "deleted"
        db.commit()
    return Response(status_code=204)


def danmaku_out(d: Danmaku, mine: bool = False) -> dict:
    return {"id": d.id, "t_ms": d.t_ms, "text": d.text, "mode": d.mode, "color": d.color, "mine": mine,
            "boost_tier": d.boost_tier, "pin_ms": d.pin_ms, "paid_minor": d.paid_minor}


@router.get("/videos/{public_id}/danmaku")
def list_danmaku(public_id: str, response: Response, from_ms: int = 0, to_ms: int = 60_000,
                 viewer: Viewer = Depends(optional_viewer)):
    v = readable(viewer, public_id)
    to_ms = min(to_ms, from_ms + 120_000)
    rows = viewer.db.execute(select(Danmaku).where(Danmaku.video_id == v.id, Danmaku.status == "visible",
                                                   Danmaku.t_ms >= from_ms, Danmaku.t_ms < to_ms)
                             .order_by(Danmaku.t_ms).limit(1500)).scalars().all()
    uid = viewer.user.id if viewer.user else None
    response.headers["Cache-Control"] = "private, max-age=15" if uid else "public, max-age=30"
    return [danmaku_out(d, d.user_id == uid) for d in rows]


class DanmakuIn(BaseModel):
    t_ms: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=200)
    mode: str = "scroll"
    color: str = Field(default="#FFFFFF", pattern=COLOR)


@router.post("/videos/{public_id}/danmaku", status_code=201)
def post_danmaku(public_id: str, data: DanmakuIn, request: Request, ctx: Ctx = Depends(signed_in)):
    limits.danmaku(request, ctx.user.id)
    v = _video_for(ctx, public_id)
    ok, text = clean(data.text)
    if len(text) > 60:
        raise err(400, "danmaku_too_long")
    if not ok or has_link(text):
        raise err(400, "danmaku_blocked_words")
    if data.mode not in MODES:
        raise err(400, "action_not_allowed")
    d = Danmaku(tenant_id=ctx.tenant_id, video_id=v.id, user_id=ctx.user.id, t_ms=min(data.t_ms, max(v.duration_ms, 0)),
                text=text, mode=data.mode, color=data.color.upper())
    ctx.db.add(d)
    ctx.db.commit()
    counters.incr("video", v.id, "danmaku_count", 1)
    publish(v.id, {"type": "danmaku", "item": danmaku_out(d)})
    return danmaku_out(d, True)


@router.delete("/danmaku/{danmaku_id}", status_code=204)
def delete_danmaku(danmaku_id: int, ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        d = db.get(Danmaku, danmaku_id)
        if d is None:
            raise err(404, "video_not_found")
        v = db.get(Video, d.video_id)
        if d.user_id != ctx.user.id and (v is None or v.tenant_id != ctx.tenant_id):
            raise err(403, "action_not_allowed")
        if d.paid_minor and d.checkout_id and d.status == "visible" and d.user_id != ctx.user.id:
            from app.video.commerce import refunds
            from app.video.models.commerce import Payment

            pay = db.execute(select(Payment).where(Payment.checkout_id == d.checkout_id)).scalars().first()
            if pay is not None and refunds.refunded(db, pay.id) < pay.amount_minor:
                refunds.refund(db, payment_id=pay.id, amount_minor=None, reason="Boost removed by the creator",
                               actor_user_id=ctx.user.id, idempotency_key=f"boost-removed-{d.id}")
        d.status = "deleted"
        db.commit()
        publish(d.video_id, {"type": "danmaku_removed", "id": d.id})
    return Response(status_code=204)


class ProgressIn(BaseModel):
    position_ms: int = Field(ge=0)
    watched_ms: int = Field(default=0, ge=0, le=600_000)
    started: bool = False
    completed: bool = False
    src: str | None = Field(default=None, max_length=20)
    ref: str | None = Field(default=None, max_length=300)


@router.post("/videos/{public_id}/progress")
def progress(public_id: str, data: ProgressIn, request: Request, viewer: Viewer = Depends(optional_viewer)):
    from app.core.services.rate_limit import per_ip

    per_ip(request, "progress", 240, 60, "Too many requests from here. Wait a minute and try again.")
    v = readable(viewer, public_id)
    if data.started:
        counters.incr("video", v.id, "view_count", 1)
        counters.source(v.id, data.src, data.ref)
    if data.watched_ms:
        counters.incr("video", v.id, "watch_ms", data.watched_ms)
        counters.watched(v.id, v.duration_ms, data.position_ms, data.watched_ms)
    if data.completed:
        counters.incr("video", v.id, "completions", 1)
    if viewer.user is not None:
        db = viewer.db
        wp = db.execute(select(WatchProgress).where(WatchProgress.user_id == viewer.user.id,
                                                    WatchProgress.video_id == v.id)).scalars().first()
        if wp is None:
            wp = WatchProgress(tenant_id=viewer.user.tenant_id, user_id=viewer.user.id, video_id=v.id)
            db.add(wp)
        wp.position_ms = min(data.position_ms, v.duration_ms or data.position_ms)
        if data.completed and not wp.completed:
            from app.video.social import reco

            reco.forget(viewer.user.id)
        wp.completed = data.completed or wp.completed
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"ok": True}


def _cards(db, videos: list[Video], user_id: int | None = None) -> list[dict]:
    from app.video.social.cards import cards

    return cards(db, videos, user_id)


def _lang(viewer: Viewer) -> str | None:
    if viewer.user is None:
        return None
    return ((viewer.user.settings or {}).get("language")) or None


def _cached(key: str, response: Response, build):
    from app.core.redis_client import get_redis

    try:
        r = get_redis()
        hit = r.get(key)
        if hit:
            total, body = json.loads(hit)
            response.headers["X-Total-Count"] = str(total)
            return body
    except Exception:
        r = None
    total, body = build()
    response.headers["X-Total-Count"] = str(total)
    if r is not None:
        try:
            r.setex(key, FEED_CACHE_SECONDS, json.dumps([total, body]))
        except Exception:
            pass
    return body


FEED_CACHE_SECONDS = 15


@router.get("/feed/home")
def home(response: Response, limit: int = Query(24, le=60), offset: int = 0, viewer: Viewer = Depends(optional_viewer)):
    def build():
        rows = feed.ranked(viewer.db, user_id=viewer.user.id if viewer.user else None, lang=_lang(viewer), kind="long")
        if viewer.user is not None:
            from app.video.reco import service as reco_model

            reco_model.log(viewer.user.id, [r.id for r in rows[offset:offset + limit]], offset, "home",
                           reco_model.arm(viewer.db, viewer.user.id))
        return len(rows), _cards(viewer.db, rows[offset:offset + limit], viewer.user.id if viewer.user else None)

    if viewer.user is None:
        return _cached(f"kv:feed:home:{limit}:{offset}", response, build)
    total, body = build()
    response.headers["X-Total-Count"] = str(total)
    return body


@router.get("/feed/reels")
def reels(response: Response, limit: int = Query(10, le=30), offset: int = 0, viewer: Viewer = Depends(optional_viewer)):
    from app.video.media.service import playback, preview_playback

    def build():
        rows = feed.ranked(viewer.db, user_id=viewer.user.id if viewer.user else None, lang=_lang(viewer), kind="reel")
        page = rows[offset:offset + limit]
        if viewer.user is not None:
            from app.video.reco import service as reco_model

            reco_model.log(viewer.user.id, [r.id for r in page], offset, "reels", reco_model.arm(viewer.db, viewer.user.id))
        cards = _cards(viewer.db, page, viewer.user.id if viewer.user else None)
        locked: set[int] = set()
        if any(v.access != "free" for v in page):
            from app.video.commerce import access
            from app.video.sessions import platform_session

            with platform_session() as pdb:
                locked = access.locked_ids(pdb, viewer.user, page)
        for card, v in zip(cards, page):
            card["locked"] = v.id in locked
            card["playback"] = preview_playback(v) if v.id in locked else playback(v)
        return len(rows), cards

    if viewer.user is None:
        return _cached(f"kv:feed:reels:{limit}:{offset}", response, build)
    total, body = build()
    response.headers["X-Total-Count"] = str(total)
    return body


@router.get("/feed/following")
def following_feed(response: Response, limit: int = Query(24, le=60), offset: int = 0, ctx: Ctx = Depends(signed_in)):
    rows = feed.ranked(ctx.db, user_id=ctx.user.id, lang=None, kind=None, following_only=True)
    rows.sort(key=lambda v: v.published_at or v.created_at, reverse=True)
    response.headers["X-Total-Count"] = str(len(rows))
    return _cards(ctx.db, rows[offset:offset + limit], ctx.user.id)


@router.get("/me/history")
def history(response: Response, limit: int = Query(30, le=100), offset: int = 0, ctx: Ctx = Depends(signed_in)):
    base = select(WatchProgress).where(WatchProgress.user_id == ctx.user.id)
    response.headers["X-Total-Count"] = str(ctx.db.execute(select(func.count()).select_from(base.subquery())).scalar() or 0)
    rows = ctx.db.execute(base.order_by(WatchProgress.updated_at.desc(), WatchProgress.id.desc())
                          .limit(limit).offset(offset)).scalars().all()
    videos = {v.id: v for v in ctx.db.execute(select(Video).where(Video.id.in_([r.video_id for r in rows]),
                                                                   Video.is_deleted.is_(False))).scalars().all()} if rows else {}
    ordered = [videos[r.video_id] for r in rows if r.video_id in videos]
    cards = _cards(ctx.db, ordered, ctx.user.id)
    pos = {r.video_id: r for r in rows}
    for card, v in zip(cards, ordered):
        card["position_ms"] = pos[v.id].position_ms
        card["completed"] = pos[v.id].completed
        card["watched_at"] = iso(pos[v.id].updated_at)
    return cards


@router.delete("/me/history/{public_id}", status_code=204)
def forget_one(public_id: str, ctx: Ctx = Depends(signed_in)):
    from sqlalchemy import delete

    vid = ctx.db.execute(select(Video.id).where(Video.public_id == public_id)).scalar()
    if vid is not None:
        ctx.db.execute(delete(WatchProgress).where(WatchProgress.user_id == ctx.user.id, WatchProgress.video_id == vid))
        ctx.db.commit()
    return Response(status_code=204)


@router.delete("/me/history", status_code=204)
def forget_all(ctx: Ctx = Depends(signed_in)):
    from sqlalchemy import delete

    ctx.db.execute(delete(WatchProgress).where(WatchProgress.user_id == ctx.user.id))
    ctx.db.commit()
    return Response(status_code=204)


@router.get("/videos/{public_id}/related")
def related(public_id: str, limit: int = Query(12, le=30), viewer: Viewer = Depends(optional_viewer)):
    from sqlalchemy.dialects.postgresql import array as pg_array

    v = readable(viewer, public_id)
    base = select(Video).where(Video.id != v.id, Video.status == "published", Video.visibility == "public",
                               Video.is_deleted.is_(False), Video.kind == v.kind)
    picked: list[Video] = []
    seen = {v.id}
    tags = [t for t in (v.tags or []) if t][:8]
    queries = [base.where(Video.channel_id == v.channel_id).order_by(Video.published_at.desc()).limit(limit // 2 or 1)]
    if tags:
        queries.append(base.where(Video.tags.has_any(pg_array(tags))).order_by(Video.view_count.desc()).limit(limit))
    queries.append(base.where(Video.language == v.language).order_by(Video.view_count.desc(), Video.published_at.desc()).limit(limit))
    queries.append(base.order_by(Video.published_at.desc()).limit(limit))
    for q in queries:
        for row in viewer.db.execute(q).scalars().all():
            if row.id not in seen and len(picked) < limit:
                seen.add(row.id)
                picked.append(row)
    return _cards(viewer.db, picked, viewer.user.id if viewer.user else None)


def _room_video(public_id: str) -> int | None:
    from sqlalchemy import text

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        db.info["platform"] = True
        db.execute(text("SELECT set_config('app.platform', 'on', true)"))
        v = db.execute(select(Video).where(Video.public_id == public_id, Video.status == "published",
                                           Video.is_deleted.is_(False))).scalars().first()
        return v.id if v is not None and v.visibility in ("public", "unlisted") else None
    finally:
        db.close()


@router.websocket("/ws/videos/{public_id}")
async def room(websocket: WebSocket, public_id: str):
    from app.video.realtime.hub import hub, relay

    video_id = await asyncio.to_thread(_room_video, public_id)
    if video_id is None:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    client = await hub.client()
    q = await hub.subscribe(room_channel(video_id))
    watchers_key = f"kv:watchers:{video_id}"
    await client.incr(watchers_key)
    await client.expire(watchers_key, 3600)
    task = asyncio.create_task(relay(websocket, q))
    try:
        watchers = int(await client.get(watchers_key) or 1)
        await websocket.send_text(json.dumps({"type": "hello", "watchers": watchers}))
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text(json.dumps({"type": "pong", "watchers": int(await client.get(watchers_key) or 1)}))
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        await client.decr(watchers_key)
        await hub.unsubscribe(room_channel(video_id), q)
