from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import Response as RawResponse
from sqlalchemy import select

from app.core.messages import err
from app.video.media import service as media
from app.video.models.ai import Insight
from app.video.models.media import CaptionTrack, Video
from app.video.models.social import Channel, Follow, Like, WatchProgress
from app.video.present import channel_card, iso, video_card
from app.video.routers.deps import Viewer, optional_viewer
from app.video.services import images
from app.video.social import counters

router = APIRouter(prefix="/api/video", tags=["watch"])

LANGS = ("en", "hi", "mr", "bn", "ta", "te")


def readable(viewer: Viewer, public_id: str) -> Video:
    v = viewer.db.execute(select(Video).where(Video.public_id == public_id, Video.is_deleted.is_(False))).scalars().first()
    if v is None:
        raise err(404, "video_not_found")
    owner = viewer.user is not None and viewer.user.tenant_id == v.tenant_id
    if not owner and (v.status != "published" or v.visibility not in ("public", "unlisted")):
        raise err(404, "video_not_found")
    return v


def insight_for(db, video: Video, lang: str | None) -> Insight | None:
    rows = db.execute(select(Insight).where(Insight.video_id == video.id).order_by(Insight.id.desc())).scalars().all()
    if not rows:
        return None
    return next((r for r in rows if r.language == lang), rows[0])


@router.get("/videos/{public_id}")
def video_detail(public_id: str, lang: str | None = None, viewer: Viewer = Depends(optional_viewer)):
    v = readable(viewer, public_id)
    db = viewer.db
    channel = db.get(Channel, v.channel_id)
    pend = counters.pending("video", [v.id]).get(v.id, {})
    out = video_card(v, channel, pend)
    insight = insight_for(db, v, lang)
    langs = sorted({t.language for t in db.execute(select(CaptionTrack).where(CaptionTrack.video_id == v.id)).scalars().all()})
    out.update({
        "description": v.description, "tags": v.tags, "status": v.status, "visibility": v.visibility,
        "comments": v.comment_count + pend.get("comment_count", 0),
        "danmaku_count": v.danmaku_count + pend.get("danmaku_count", 0),
        "playback": media.playback(v), "ai_status": v.ai_status,
        "captions": {"available": langs, "translatable": [l for l in LANGS if l not in langs] if langs else []},
        "insight": None if insight is None else {
            "language": insight.language, "summary": insight.summary, "key_points": insight.key_points,
            "chapters": insight.chapters, "tags": insight.tags, "model": insight.model,
        },
        "embed": None if v.source != "embed" else {"platform": v.embed_platform, "url": v.embed_url,
                                                   "owner_verified": v.embed_owner_verified},
        "liked": False, "following": False, "resume_ms": 0, "is_owner": False,
    })
    if viewer.user is not None:
        uid = viewer.user.id
        out["liked"] = bool(db.execute(select(Like.id).where(Like.user_id == uid, Like.video_id == v.id)).first())
        out["following"] = bool(db.execute(select(Follow.id).where(Follow.user_id == uid, Follow.channel_id == v.channel_id)).first())
        wp = db.execute(select(WatchProgress).where(WatchProgress.user_id == uid, WatchProgress.video_id == v.id)).scalars().first()
        out["resume_ms"] = 0 if wp is None or wp.completed else wp.position_ms
        out["is_owner"] = viewer.user.tenant_id == v.tenant_id
    return out


@router.get("/channels/{handle}")
def channel_detail(handle: str, viewer: Viewer = Depends(optional_viewer)):
    c = viewer.db.execute(select(Channel).where(Channel.handle == handle.lower().lstrip("@"))).scalars().first()
    if c is None or c.is_suspended:
        raise err(404, "channel_not_found")
    out = channel_card(c)
    out.update({"about": c.about, "created_at": iso(c.created_at), "following": False})
    if viewer.user is not None:
        out["following"] = bool(viewer.db.execute(select(Follow.id).where(
            Follow.user_id == viewer.user.id, Follow.channel_id == c.id)).first())
    return out


@router.get("/channels/{handle}/videos")
def channel_videos(handle: str, response: Response, kind: str | None = None, limit: int = Query(24, le=60),
                   offset: int = 0, viewer: Viewer = Depends(optional_viewer)):
    from sqlalchemy import func

    c = viewer.db.execute(select(Channel).where(Channel.handle == handle.lower().lstrip("@"))).scalars().first()
    if c is None or c.is_suspended:
        raise err(404, "channel_not_found")
    q = select(Video).where(Video.channel_id == c.id, Video.status == "published", Video.visibility == "public",
                            Video.is_deleted.is_(False))
    if kind:
        q = q.where(Video.kind == kind)
    total = viewer.db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
    rows = viewer.db.execute(q.order_by(Video.published_at.desc(), Video.id.desc()).limit(limit).offset(offset)).scalars().all()
    pend = counters.pending("video", [v.id for v in rows])
    response.headers["X-Total-Count"] = str(total)
    return [video_card(v, c, pend.get(v.id)) for v in rows]


@router.get("/images/{name}")
def image(name: str):
    try:
        data = images.load(name)
    except Exception:
        raise err(404, "video_not_found")
    return RawResponse(data, media_type="image/webp", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/render", include_in_schema=False)
def render(path: str = "/"):
    import html
    import re
    from pathlib import Path

    from fastapi.responses import HTMLResponse

    from app.config import settings
    from app.video.sessions import platform_session

    index = Path(settings.WEB_INDEX_PATH)
    if not index.is_absolute():
        index = Path.cwd() / index
    try:
        page = index.read_text()
    except OSError:
        raise err(404, "video_not_found")
    title, desc, image, kind = settings.BRAND_NAME, "Watch, ask and clip. Videos and reels with AI summaries.", None, "website"
    with platform_session() as db:
        m = re.match(r"^/(?:watch|reels)/([A-Za-z0-9]{11})", path or "")
        h = re.match(r"^/@([a-z0-9-]{3,40})", path or "")
        if m:
            v = db.execute(select(Video).where(Video.public_id == m.group(1), Video.status == "published",
                                               Video.visibility.in_(("public", "unlisted")), Video.is_deleted.is_(False))).scalars().first()
            if v is not None:
                title, desc, image, kind = f"{v.title} · {settings.BRAND_NAME}", (v.description or v.title)[:200], media.thumb(v), "video.other"
        elif h:
            c = db.execute(select(Channel).where(Channel.handle == h.group(1))).scalars().first()
            if c is not None and not c.is_suspended:
                title, desc, image, kind = f"{c.name} (@{c.handle}) · {settings.BRAND_NAME}", (c.about or c.name)[:200], images.public_url(c.avatar_key), "profile"
    url = f"{settings.WEB_BASE_URL.rstrip('/')}{path}"
    tags = [f"<title>{html.escape(title)}</title>",
            f'<meta name="description" content="{html.escape(desc)}" />',
            f'<meta property="og:title" content="{html.escape(title)}" />',
            f'<meta property="og:description" content="{html.escape(desc)}" />',
            f'<meta property="og:type" content="{kind}" />',
            f'<meta property="og:url" content="{html.escape(url)}" />',
            f'<meta property="og:site_name" content="{html.escape(settings.BRAND_NAME)}" />',
            '<meta name="twitter:card" content="summary_large_image" />',
            f'<link rel="canonical" href="{html.escape(url)}" />']
    if image:
        tags.append(f'<meta property="og:image" content="{html.escape(image)}" />')
    page = re.sub(r"<title>.*?</title>", "", page, flags=re.S)
    page = re.sub(r'<meta name="description"[^>]*>', "", page)
    page = page.replace("</head>", "    " + "\n    ".join(tags) + "\n  </head>", 1)
    return HTMLResponse(page, headers={"Cache-Control": "public, max-age=60"})
