from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.messages import err
from app.video.commerce import quotas
from app.video.media.paths import work_dir
from app.video.models.ai import Insight, RepurposePack
from app.video.models.media import Video
from app.video.models.studio import Clip, PublishTarget
from app.video.present import iso
from app.video.routers.deps import StudioCtx, studio
from app.video.services import images
from app.video.studio import creator_ai

router = APIRouter(prefix="/api/video/studio", tags=["studio-ai"])


def _video(ctx: StudioCtx, video_id: int) -> Video:
    v = ctx.db.get(Video, video_id)
    if v is None or v.is_deleted or v.tenant_id != ctx.tenant_id:
        raise err(404, "video_not_found")
    return v


@router.post("/videos/{video_id}/thumbnails/ai")
def ai_thumbnails(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = _video(ctx, video_id)
    owner = quotas.owner_user_id(ctx.db, ctx.tenant_id) or ctx.user.id
    try:
        per = quotas.reserve(ctx.db, ctx.tenant_id, owner, "ai_images", len(creator_ai.STYLES))
    except quotas.QuotaExceeded as exc:
        ctx.db.rollback()
        raise quotas.refuse(exc)
    try:
        made = creator_ai.thumbnails(ctx.db, v, work_dir(f"aithumb{v.id}"))
    except Exception:
        ctx.db.rollback()
        quotas.release(ctx.db, ctx.tenant_id, owner, "ai_images", len(creator_ai.STYLES), per)
        ctx.db.commit()
        raise
    quotas.commit(ctx.db, ctx.tenant_id, owner, "ai_images", len(creator_ai.STYLES), per)
    ctx.db.commit()
    return {"ideas": [{"key": i["key"], "reason": i["reason"], "ai": True, "url": images.public_url(i["key"])} for i in made],
            "usage": quotas.usage(ctx.db, owner, "ai_images")}


class ChaptersIn(BaseModel):
    chapters: list[dict] = Field(max_length=50)


def _chapters_out(db, v: Video) -> dict:
    rows = db.execute(select(Insight).where(Insight.video_id == v.id).order_by(Insight.id.desc()).limit(10)).scalars().all()
    cur = rows[0] if rows else None
    return {"chapters": cur.chapters if cur else [], "version": cur.version if cur else 0,
            "history": [{"version": r.version, "by": "creator" if r.model.startswith("creator-edit") else "ai",
                         "count": len(r.chapters or []), "created_at": iso(r.created_at)} for r in rows]}


@router.get("/videos/{video_id}/chapters")
def get_chapters(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads"))):
    return _chapters_out(ctx.db, _video(ctx, video_id))


@router.put("/videos/{video_id}/chapters")
def put_chapters(video_id: int, data: ChaptersIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = _video(ctx, video_id)
    creator_ai.chapters(ctx.db, v, data.chapters, ctx.user.id)
    ctx.db.commit()
    return _chapters_out(ctx.db, v)


class RepurposeIn(BaseModel):
    language: str = "en"


def _pack_out(p: RepurposePack) -> dict:
    return {"id": p.id, "language": p.language, "model": p.model, "created_at": iso(p.created_at), **p.content}


@router.post("/videos/{video_id}/repurpose", status_code=201)
def make_pack(video_id: int, data: RepurposeIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = _video(ctx, video_id)
    p = creator_ai.repurpose(ctx.db, v, ctx.tenant_id, data.language if data.language in ("en", "hi") else "en")
    ctx.db.commit()
    return _pack_out(p)


@router.get("/videos/{video_id}/repurpose")
def latest_pack(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads"))):
    v = _video(ctx, video_id)
    p = ctx.db.execute(select(RepurposePack).where(RepurposePack.video_id == v.id).order_by(RepurposePack.id.desc())).scalars().first()
    return {"pack": _pack_out(p) if p else None}


@router.get("/repurpose/{pack_id}.md")
def pack_markdown(pack_id: int, ctx: StudioCtx = Depends(studio("video.uploads"))):
    p = ctx.db.get(RepurposePack, pack_id)
    if p is None or p.tenant_id != ctx.tenant_id:
        raise err(404, "video_not_found")
    v = ctx.db.get(Video, p.video_id)
    return Response(creator_ai.markdown(p, v.title if v else ""), media_type="text/markdown",
                    headers={"Content-Disposition": f'attachment; filename="repurpose-{p.id}.md"'})


@router.get("/calendar")
def calendar(start: datetime | None = Query(None, alias="from"), end: datetime | None = Query(None, alias="to"),
             ctx: StudioCtx = Depends(studio("video.uploads"))):
    now = datetime.now(timezone.utc)
    start = start or now - timedelta(days=7)
    end = end or now + timedelta(days=35)
    items = []
    for v in ctx.db.execute(select(Video).where(Video.tenant_id == ctx.tenant_id, Video.is_deleted.is_(False),
                                                ((Video.publish_at >= start) & (Video.publish_at < end))
                                                | ((Video.published_at >= start) & (Video.published_at < end)))).scalars():
        at = v.publish_at if v.visibility == "scheduled" else (v.published_at or v.publish_at)
        items.append({"type": "video", "id": v.id, "public_id": v.public_id, "title": v.title, "kind": v.kind, "at": iso(at),
                      "target": "play", "status": "scheduled" if v.visibility == "scheduled" else v.status})
    for t, c in ctx.db.execute(select(PublishTarget, Clip).join(Clip, Clip.id == PublishTarget.clip_id)
                               .where(PublishTarget.tenant_id == ctx.tenant_id,
                                      ((PublishTarget.scheduled_at >= start) & (PublishTarget.scheduled_at < end))
                                      | ((PublishTarget.updated_at >= start) & (PublishTarget.updated_at < end)))).all():
        items.append({"type": "clip", "id": t.id, "clip_id": c.id, "title": c.title, "at": iso(t.scheduled_at or t.updated_at),
                      "target": t.platform, "status": t.status, "error": t.error})
    items.sort(key=lambda x: x["at"] or "")
    return {"from": iso(start), "to": iso(end), "items": items}


class ReschedIn(BaseModel):
    scheduled_at: datetime | None = None
    cancel: bool = False


@router.patch("/calendar/targets/{target_id}")
def reschedule(target_id: int, data: ReschedIn, ctx: StudioCtx = Depends(studio("video.clips", "full"))):
    t = ctx.db.get(PublishTarget, target_id)
    if t is None or t.tenant_id != ctx.tenant_id:
        raise err(404, "action_not_allowed")
    if t.status != "scheduled":
        raise err(409, "action_not_allowed")
    if data.cancel:
        t.status = "cancelled"
    elif data.scheduled_at and data.scheduled_at > datetime.now(timezone.utc):
        t.scheduled_at = data.scheduled_at
    else:
        raise err(400, "schedule_in_past")
    ctx.db.commit()
    return {"id": t.id, "status": t.status, "scheduled_at": iso(t.scheduled_at)}
