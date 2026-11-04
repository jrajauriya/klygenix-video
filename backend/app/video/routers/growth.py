from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.messages import err
from app.core.redis_client import get_redis
from app.video.media.signing import expiry, sign, valid
from app.video.models.media import Video
from app.video.models.social import Channel, Follow, Notification
from app.video.present import iso
from app.video.routers.deps import Ctx, signed_in
from app.video.services import inbox
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video", tags=["growth"])
LICENSE_DAYS = 30
LINK_TTL = 6 * 3600


def _can_download(db, user, v: Video | None) -> str | None:
    from app.video.ads.service import premium
    from app.video.commerce import access
    from app.video.commerce.support import hosted

    if not hosted(v) or v.visibility not in ("public", "unlisted"):
        return "not_downloadable"
    if not premium(db, user):
        return "premium_needed"
    if v.access != "free" and not access.allowed(db, user, v):
        return "locked"
    return None


def _license(user_id: int, video_id: int, exp: int) -> str:
    return f"{video_id}.{exp}.{sign('dlic', user_id, video_id, exp)}"


@router.post("/videos/{public_id}/download")
def download(public_id: str, ctx: Ctx = Depends(signed_in)):
    from app.video.media.providers import provider

    with platform_session() as db:
        v = db.execute(select(Video).where(Video.public_id == public_id, Video.is_deleted.is_(False))).scalars().first()
        why = _can_download(db, ctx.user, v)
        if why == "premium_needed":
            raise err(402, "download_premium_only")
        if why:
            raise err(403, "download_not_allowed")
        exp = expiry(LICENSE_DAYS * 86400)
        return {"id": v.public_id, "title": v.title, "duration_ms": v.duration_ms, "quality": "720p",
                "url": provider(v.provider).download_url(v, LINK_TTL), "url_expires_at": expiry(LINK_TTL),
                "license": _license(ctx.user.id, v.id, exp), "license_expires_at": exp}


class LicensesIn(BaseModel):
    licenses: list[str] = Field(max_length=500)


@router.post("/me/downloads/check")
def check_downloads(data: LicensesIn, ctx: Ctx = Depends(signed_in)):
    out = {}
    with platform_session() as db:
        for lic in data.licenses:
            try:
                vid, exp, sig = lic.split(".", 2)
                vid, exp = int(vid), int(exp)
            except ValueError:
                out[lic] = "invalid"
                continue
            if not valid(sig, "dlic", ctx.user.id, vid, exp):
                out[lic] = "invalid"
            elif exp < int(datetime.now(timezone.utc).timestamp()):
                out[lic] = "expired"
            else:
                why = _can_download(db, ctx.user, db.get(Video, vid))
                out[lic] = "ok" if why is None else ("premium_ended" if why == "premium_needed" else "removed")
    return {"licenses": out, "keep": [k for k, v in out.items() if v == "ok"]}


def _note(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "url": n.url, "image": n.image,
            "app": n.app, "read": n.read_at is not None, "created_at": iso(n.created_at)}


@router.get("/me/inbox")
def my_inbox(response: Response, unread: bool = False, limit: int = Query(30, le=100), offset: int = 0,
             app: str | None = Query(None, pattern="^(web|studio|mobile)$"), ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        q = inbox.scoped(select(Notification).where(Notification.user_id == ctx.user.id), app)
        if unread:
            q = q.where(Notification.read_at.is_(None))
        rows = db.execute(q.order_by(Notification.id.desc()).limit(limit).offset(offset)).scalars().all()
        count = inbox.unread(db, ctx.user.id, app)
        response.headers["X-Unread-Count"] = str(count)
        return {"unread": count, "items": [_note(n) for n in rows]}


@router.get("/me/inbox/count")
def inbox_count(app: str | None = Query(None, pattern="^(web|studio|mobile)$"), ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        return {"unread": inbox.unread(db, ctx.user.id, app)}


class ReadIn(BaseModel):
    ids: list[int] | None = Field(default=None, max_length=500)
    app: str | None = Field(default=None, pattern="^(web|studio|mobile)$")


@router.post("/me/inbox/read")
def read_inbox(data: ReadIn, ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        n = inbox.mark_read(db, ctx.user.id, data.ids, data.app)
        db.commit()
        return {"marked": n, "unread": inbox.unread(db, ctx.user.id, data.app)}


class DigestIn(BaseModel):
    frequency: str


@router.get("/me/digest")
def get_digest(ctx: Ctx = Depends(signed_in)):
    return {"frequency": inbox.frequency(ctx.user)}


@router.put("/me/digest")
def put_digest(data: DigestIn, ctx: Ctx = Depends(signed_in)):
    if data.frequency not in ("off", "daily", "weekly"):
        raise err(400, "action_not_allowed")
    ctx.user.settings = {**(ctx.user.settings or {}), "digest": data.frequency}
    ctx.db.commit()
    return {"frequency": data.frequency}


@router.get("/feed/subscriptions")
def subscriptions(response: Response, limit: int = Query(24, le=60), offset: int = 0, mark_seen: bool = True,
                  ctx: Ctx = Depends(signed_in)):
    from app.video.social.cards import cards

    key = f"kv:subs:seen:{ctx.user.id}"
    r = get_redis()
    last = r.get(key)
    since = datetime.fromtimestamp(int(last), timezone.utc) if last else datetime.now(timezone.utc) - timedelta(days=7)
    chans = ctx.db.execute(select(Follow.channel_id).where(Follow.user_id == ctx.user.id)).scalars().all()
    if not chans:
        response.headers["X-Total-Count"] = "0"
        return {"new_count": 0, "since": iso(since), "channels": 0, "items": []}
    base = select(Video).join(Channel, Channel.id == Video.channel_id).where(
        Video.channel_id.in_(chans), Video.status == "published", Video.visibility == "public", Video.is_deleted.is_(False),
        Channel.is_suspended.is_(False))
    rows = ctx.db.execute(base.order_by(Video.published_at.desc(), Video.id.desc()).limit(limit).offset(offset)).scalars().all()
    new_count = sum(1 for v in ctx.db.execute(base.where(Video.published_at > since)).scalars().all())
    out = cards(ctx.db, rows, ctx.user.id)
    for c, v in zip(out, rows):
        c["new"] = bool(v.published_at and v.published_at > since)
    if mark_seen and offset == 0:
        r.set(key, int(datetime.now(timezone.utc).timestamp()))
    response.headers["X-Total-Count"] = str(len(out))
    return {"new_count": new_count, "since": iso(since), "channels": len(chans), "items": out}
