from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import Response as RawResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.config import settings
from app.core.messages import err
from app.video.commerce import quotas
from app.video.media import service as media
from app.video.media.signing import alive, expiry, sign, valid
from app.video.models.ai import ClipSuggestion
from app.video.models.media import Video
from app.video.models.studio import Clip
from app.video.present import iso
from app.video.routers.deps import StudioCtx, studio
from app.video.routers.studio_videos import own_video
from app.video.sessions import platform_session
from app.video.storage import backend

router = APIRouter(prefix="/api/video/studio", tags=["studio-clips"])

ASPECTS = ("9:16", "1:1", "16:9")
STYLES = ("none", "clean", "bold", "karaoke")


def clip_out(c: Clip) -> dict:
    out = {"id": c.id, "source_video_id": c.source_video_id, "suggestion_id": c.suggestion_id, "title": c.title,
           "start_ms": c.start_ms, "end_ms": c.end_ms, "duration_ms": c.end_ms - c.start_ms, "aspect": c.aspect,
           "reframe": c.reframe, "caption_style": c.caption_style, "watermark": c.watermark, "status": c.status,
           "error": c.error, "output_video_id": c.output_video_id, "created_at": iso(c.created_at),
           "updated_at": iso(c.updated_at), "download_url": None}
    if c.output_key and c.status in ("rendered", "published"):
        exp = expiry(3600)
        out["download_url"] = (f"{settings.API_PUBLIC_BASE_URL.rstrip('/')}/api/video/studio/clip-files/"
                               f"{c.id}/{exp}/{sign('clip', c.id, exp)}.mp4")
    return out


@router.get("/videos/{video_id}/suggestions")
def suggestions(video_id: int, ctx: StudioCtx = Depends(studio("video.clips"))):
    v = own_video(ctx, video_id)
    rows = ctx.db.execute(select(ClipSuggestion).where(ClipSuggestion.video_id == v.id)
                          .order_by(ClipSuggestion.score.desc())).scalars().all()
    return [{"id": s.id, "start_ms": s.start_ms, "end_ms": s.end_ms, "duration_ms": s.end_ms - s.start_ms,
             "score": round(s.score, 3), "title": s.title, "reason": s.reason, "hook": s.hook} for s in rows]


class ClipIn(BaseModel):
    source_video_id: int
    suggestion_id: int | None = None
    title: str = Field(min_length=1, max_length=160)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    aspect: str = "9:16"
    caption_style: str = "bold"
    center_x: float = Field(default=0.5, ge=0, le=1)


class ClipPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, gt=0)
    aspect: str | None = None
    caption_style: str | None = None
    center_x: float | None = Field(default=None, ge=0, le=1)


def _validate(v: Video, start: int, end: int, aspect: str, style: str) -> None:
    if end <= start or end > v.duration_ms + 500:
        raise err(400, "clip_range_invalid")
    if end - start > settings.REEL_MAX_SECONDS * 1000:
        raise err(400, "clip_too_long", seconds=settings.REEL_MAX_SECONDS)
    if aspect not in ASPECTS or style not in STYLES:
        raise err(400, "action_not_allowed")


def own_clip(ctx: StudioCtx, clip_id: int) -> Clip:
    c = ctx.db.get(Clip, clip_id)
    if c is None or c.tenant_id != ctx.tenant_id:
        raise err(404, "video_not_found")
    return c


@router.get("/clips")
def list_clips(response: Response, status: str | None = None, video_id: int | None = None,
               limit: int = Query(50, le=200), offset: int = 0, ctx: StudioCtx = Depends(studio("video.clips"))):
    q = select(Clip).where(Clip.tenant_id == ctx.tenant_id)
    if status:
        q = q.where(Clip.status == status)
    if video_id:
        q = q.where(Clip.source_video_id == video_id)
    total = ctx.db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
    response.headers["X-Total-Count"] = str(total)
    rows = ctx.db.execute(q.order_by(Clip.created_at.desc()).limit(limit).offset(offset)).scalars().all()
    return [clip_out(c) for c in rows]


@router.post("/clips", status_code=201)
def create_clip(data: ClipIn, ctx: StudioCtx = Depends(studio("video.clips", "full"))):
    v = own_video(ctx, data.source_video_id)
    if v.status not in ("published", "in_review") or v.source == "embed":
        raise err(409, "video_not_ready")
    _validate(v, data.start_ms, data.end_ms, data.aspect, data.caption_style)
    watermark = bool((quotas.active_plan(ctx.db, ctx.user.id, "creator").limits or {}).get("watermark", True))
    c = Clip(tenant_id=ctx.tenant_id, source_video_id=v.id, suggestion_id=data.suggestion_id, title=data.title.strip(),
             start_ms=data.start_ms, end_ms=data.end_ms, aspect=data.aspect, caption_style=data.caption_style,
             reframe={"mode": "manual" if data.center_x != 0.5 else "center", "center_x": data.center_x},
             watermark=watermark, created_by=ctx.user.id)
    ctx.db.add(c)
    ctx.db.commit()
    return clip_out(c)


@router.get("/clips/{clip_id}")
def get_clip(clip_id: int, ctx: StudioCtx = Depends(studio("video.clips"))):
    return clip_out(own_clip(ctx, clip_id))


@router.patch("/clips/{clip_id}")
def patch_clip(clip_id: int, data: ClipPatch, ctx: StudioCtx = Depends(studio("video.clips", "full"))):
    c = own_clip(ctx, clip_id)
    if c.status in ("queued", "rendering", "published"):
        raise err(409, "action_not_allowed")
    v = own_video(ctx, c.source_video_id)
    start = data.start_ms if data.start_ms is not None else c.start_ms
    end = data.end_ms if data.end_ms is not None else c.end_ms
    aspect = data.aspect or c.aspect
    style = data.caption_style or c.caption_style
    _validate(v, start, end, aspect, style)
    c.start_ms, c.end_ms, c.aspect, c.caption_style = start, end, aspect, style
    if data.title is not None:
        c.title = data.title.strip()
    if data.center_x is not None:
        c.reframe = {"mode": "manual" if data.center_x != 0.5 else "center", "center_x": data.center_x}
    if c.status in ("rendered", "failed"):
        c.status = "draft"
        c.output_key = None
    ctx.db.commit()
    return clip_out(c)


@router.delete("/clips/{clip_id}", status_code=204)
def delete_clip(clip_id: int, ctx: StudioCtx = Depends(studio("video.clips", "full"))):
    c = own_clip(ctx, clip_id)
    if c.status in ("queued", "rendering"):
        raise err(409, "action_not_allowed")
    if c.output_key:
        backend().delete(c.output_key)
    ctx.db.delete(c)
    ctx.db.commit()
    return Response(status_code=204)


@router.post("/clips/{clip_id}/render")
def render_clip(clip_id: int, ctx: StudioCtx = Depends(studio("video.clips", "full"))):
    from app.video.studio.jobs import render_clip as job

    c = own_clip(ctx, clip_id)
    if c.status in ("queued", "rendering", "published"):
        raise err(409, "action_not_allowed")
    owner = quotas.owner_user_id(ctx.db, ctx.tenant_id) or ctx.user.id
    try:
        per = quotas.reserve(ctx.db, ctx.tenant_id, owner, "renders", 1)
    except quotas.QuotaExceeded as exc:
        ctx.db.rollback()
        raise quotas.refuse(exc)
    c.watermark = bool((quotas.active_plan(ctx.db, owner, "creator").limits or {}).get("watermark", True))
    c.status = "queued"
    ctx.db.commit()
    job.enqueue(c.id, per)
    return clip_out(c)


class PublishIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    description: str = ""
    visibility: str = "public"


@router.post("/clips/{clip_id}/publish")
def publish(clip_id: int, data: PublishIn, ctx: StudioCtx = Depends(studio("video.clips", "full"))):
    from app.video.studio.jobs import publish_clip

    c = own_clip(ctx, clip_id)
    if c.status != "rendered":
        raise err(409, "video_not_ready")
    if data.visibility not in ("public", "unlisted", "private"):
        raise err(400, "action_not_allowed")
    src = own_video(ctx, c.source_video_id)
    video = media.create_video(ctx.db, channel=ctx.channel, user_id=ctx.user.id, title=(data.title or c.title),
                               description=data.description or f"Clip from {src.title}", language=src.language,
                               visibility=data.visibility, rights_declared=True, ai_generated=src.ai_generated,
                               tags=src.tags, source="clip", source_clip_id=c.id)
    ctx.db.commit()
    publish_clip.enqueue(c.id, video.id)
    return {"clip": clip_out(c), "video_id": video.id, "public_id": video.public_id}


@router.get("/clip-files/{clip_id}/{exp}/{sig}.mp4")
def clip_file(clip_id: int, exp: int, sig: str):
    if not alive(exp) or not valid(sig, "clip", clip_id, exp):
        raise err(403, "upload_link_expired")
    with platform_session() as db:
        c = db.get(Clip, clip_id)
        key = c.output_key if c else None
    if not key:
        raise err(404, "video_not_found")
    data = backend().get(key)
    return RawResponse(data, media_type="video/mp4",
                       headers={"Content-Disposition": f'attachment; filename="clip-{clip_id}.mp4"',
                                "Cache-Control": "private, max-age=600"})
