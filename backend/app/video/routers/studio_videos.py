from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.core.messages import err
from app.core.models.tenant import Tenant
from app.video.media import service as media
from app.video.models.ai import ClipSuggestion, Insight, Segment, Transcript
from app.video.models.media import Video
from app.video.models.social import Channel
from app.video.present import channel_card, iso, studio_video
from app.video.routers.deps import StudioCtx, studio
from app.video.routers.limits import upload_create
from app.video.services import images
from app.video.services.provisioning import open_channel
from app.video.services.text import is_valid_creator_handle
from app.video.social import counters

router = APIRouter(prefix="/api/video/studio", tags=["studio"])

VISIBILITY = ("public", "unlisted", "private")


class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    handle: str | None = None
    about: str = ""
    language: str = "en"
    invite: str | None = None


class ChannelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    about: str | None = None
    language: str | None = None


def channel_out(c: Channel) -> dict:
    card = channel_card(c)
    return {**card, "about": c.about, "language": c.language, "country": c.country, "video_count": c.video_count,
            "strike_count": c.strike_count, "is_suspended": c.is_suspended, "created_at": iso(c.created_at)}


@router.get("/channel")
def get_channel(ctx: StudioCtx = Depends(studio("video.dashboard", need_channel=False))):
    return {"channel": channel_out(ctx.channel) if ctx.channel else None}


@router.post("/channel", status_code=201)
def create_channel(data: ChannelIn, ctx: StudioCtx = Depends(studio("video.channels", "full", need_channel=False))):
    if ctx.channel is not None:
        raise err(409, "channel_exists")
    handle = (data.handle or "").strip().lower().lstrip("@") or None
    if handle:
        if not is_valid_creator_handle(handle):
            raise err(400, "handle_3_40_letters_numbers_hyphens")
        if ctx.db.execute(select(Channel.id).where(Channel.handle == handle)).first():
            raise err(409, "taken_try_another", handle=handle)
    from app.core.services import beta

    beta.gate_channel(ctx.db, email=ctx.user.email, invite=data.invite)
    tenant = ctx.db.get(Tenant, ctx.tenant_id)
    channel = open_channel(ctx.db, tenant, name=data.name.strip(), handle=handle, language=data.language)
    channel.about = data.about.strip()[:2000]
    ctx.db.commit()
    return channel_out(channel)


@router.patch("/channel")
def patch_channel(data: ChannelPatch, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    c = ctx.channel
    if data.name is not None:
        c.name = data.name.strip()
    if data.about is not None:
        c.about = data.about.strip()[:2000]
    if data.language is not None:
        c.language = data.language[:8]
    ctx.db.commit()
    return channel_out(c)


async def _image(file: UploadFile, side: int) -> str:
    data = await file.read()
    try:
        return images.save(data, max_side=side)
    except images.ImageError:
        raise err(400, "image_unreadable")


@router.post("/channel/avatar")
async def channel_avatar(file: UploadFile = File(...), ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    ctx.channel.avatar_key = await _image(file, 512)
    ctx.db.commit()
    return channel_out(ctx.channel)


@router.post("/channel/banner")
async def channel_banner(file: UploadFile = File(...), ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    ctx.channel.banner_key = await _image(file, 2048)
    ctx.db.commit()
    return channel_out(ctx.channel)


class VideoIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    language: str = "en"
    visibility: str = "public"
    publish_at: datetime | None = None
    rights_declared: bool = False
    ai_generated: bool = False
    made_for_kids: bool = False
    tags: list[str] = []
    filename: str = "video.mp4"
    size_bytes: int = 0


class VideoPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    language: str | None = None
    visibility: str | None = None
    publish_at: datetime | None = None
    tags: list[str] | None = None
    ai_generated: bool | None = None
    made_for_kids: bool | None = None


def own_video(ctx: StudioCtx, video_id: int) -> Video:
    v = ctx.db.get(Video, video_id)
    if v is None or v.is_deleted or v.tenant_id != ctx.tenant_id:
        raise err(404, "video_not_found")
    return v


@router.get("/videos")
def list_videos(response: Response, status: str | None = None, kind: str | None = None, q: str | None = None,
                limit: int = Query(30, le=100), offset: int = 0,
                ctx: StudioCtx = Depends(studio("video.uploads"))):
    query = select(Video).where(Video.tenant_id == ctx.tenant_id, Video.is_deleted.is_(False))
    if status:
        query = query.where(Video.status == status)
    if kind:
        query = query.where(Video.kind == kind)
    if q:
        query = query.where(or_(Video.title.ilike(f"%{q}%"), Video.description.ilike(f"%{q}%")))
    total = ctx.db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = ctx.db.execute(query.order_by(Video.created_at.desc(), Video.id.desc()).limit(limit).offset(offset)).scalars().all()
    pend = counters.pending("video", [v.id for v in rows])
    response.headers["X-Total-Count"] = str(total)
    ideas = dict(ctx.db.execute(select(ClipSuggestion.video_id, func.count(ClipSuggestion.id)).where(
        ClipSuggestion.video_id.in_([v.id for v in rows])).group_by(ClipSuggestion.video_id)).all()) if rows else {}
    out = []
    for v in rows:
        item = studio_video(v, pend.get(v.id))
        item["suggestion_count"] = ideas.get(v.id, 0)
        out.append(item)
    return out


@router.post("/videos", status_code=201, dependencies=[Depends(upload_create)])
def create_video(data: VideoIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    from app.config import settings

    if not data.rights_declared:
        raise err(400, "rights_declaration_needed")
    if data.size_bytes and data.size_bytes > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise err(413, "upload_too_large")
    if data.visibility not in VISIBILITY:
        raise err(400, "action_not_allowed")
    video = media.create_video(
        ctx.db, channel=ctx.channel, user_id=ctx.user.id, title=data.title, description=data.description,
        language=data.language, visibility=data.visibility, publish_at=data.publish_at,
        rights_declared=True, ai_generated=data.ai_generated, tags=[t.strip().lower()[:30] for t in data.tags if t.strip()][:12],
    )
    video.made_for_kids = data.made_for_kids
    ticket = media.upload_ticket(ctx.db, video, data.filename)
    ctx.db.commit()
    return {"video": studio_video(video), "upload": ticket}


@router.post("/videos/{video_id}/uploaded")
def mark_uploaded(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = own_video(ctx, video_id)
    if v.status == "uploading" and v.provider != "sandbox":
        v.status = "processing"
        ctx.db.commit()
    return studio_video(v)


@router.get("/videos/{video_id}")
def get_video(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads"))):
    v = own_video(ctx, video_id)
    insight = ctx.db.execute(select(Insight).where(Insight.video_id == v.id).order_by(Insight.id.desc())).scalars().first()
    suggestions = ctx.db.execute(select(func.count(ClipSuggestion.id)).where(ClipSuggestion.video_id == v.id)).scalar() or 0
    out = studio_video(v, counters.pending("video", [v.id]).get(v.id))
    out["insight"] = None if insight is None else {
        "summary": insight.summary, "key_points": insight.key_points, "chapters": insight.chapters,
        "tags": insight.tags, "title_ideas": insight.title_ideas, "hashtags": insight.hashtags, "model": insight.model,
    }
    out["suggestion_count"] = suggestions
    out["playback"] = media.playback(v)
    out["thumbnail_custom"] = bool(v.thumbnail_key)
    out["thumbnail_ai"] = v.thumbnail_ai
    out["thumbnail_ideas"] = [{"at_ms": i["at_ms"], "key": i["key"], "reason": i.get("reason", ""), "ai": bool(i.get("ai")),
                               "url": images.public_url(i["key"]), "chosen": i["key"] == v.thumbnail_key}
                              for i in (v.thumbnail_ideas or [])]
    from app.video.models.media import CaptionTrack
    from app.video.routers.watch import LANGS

    tracks = ctx.db.execute(select(CaptionTrack.language, CaptionTrack.source).where(CaptionTrack.video_id == v.id)).all()
    available = sorted({lang for lang, _ in tracks})
    out["captions"] = {"available": available,
                       "translatable": [lang for lang in LANGS if lang not in available] if available else [],
                       "sources": [{"language": lang, "source": src} for lang, src in sorted(tracks)]}
    return out


@router.patch("/videos/{video_id}")
def patch_video(video_id: int, data: VideoPatch, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = own_video(ctx, video_id)
    if data.title is not None:
        v.title = data.title.strip()
    if data.description is not None:
        v.description = data.description
    if data.language is not None:
        v.language = data.language[:8]
    if data.tags is not None:
        v.tags = [t.strip().lower()[:30] for t in data.tags if t.strip()][:12]
    if data.ai_generated is not None:
        v.ai_generated = data.ai_generated
    if data.made_for_kids is not None:
        v.made_for_kids = data.made_for_kids
    if any(x is not None for x in (data.title, data.description, data.tags, data.made_for_kids)):
        v.safety_labels = None
    if data.visibility is not None:
        if data.visibility not in VISIBILITY + ("scheduled",):
            raise err(400, "action_not_allowed")
        if data.visibility == "scheduled":
            if not data.publish_at:
                raise err(400, "action_not_allowed")
            v.publish_at = data.publish_at
        v.visibility = data.visibility
        if data.visibility != "scheduled":
            v.publish_at = None
            if v.status == "published" and not v.published_at:
                v.published_at = media.now()
    ctx.db.commit()
    return studio_video(v)


@router.delete("/videos/{video_id}", status_code=204)
def delete_video(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = own_video(ctx, video_id)
    v.is_deleted = True
    ctx.db.commit()
    from app.video.pipeline.housekeeping import delete_media

    delete_media.enqueue(v.id)
    return Response(status_code=204)


@router.post("/videos/{video_id}/thumbnail")
async def video_thumbnail(video_id: int, file: UploadFile = File(...),
                          ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = own_video(ctx, video_id)
    v.thumbnail_key = await _image(file, 1280)
    v.thumbnail_ai = False
    ctx.db.commit()
    return studio_video(v)


class PickIn(BaseModel):
    key: str = Field(max_length=300)


@router.post("/videos/{video_id}/thumbnail/pick")
def pick_thumbnail(video_id: int, data: PickIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = own_video(ctx, video_id)
    if data.key not in {i.get("key") for i in (v.thumbnail_ideas or [])}:
        raise err(404, "action_not_allowed")
    v.thumbnail_key = data.key
    v.thumbnail_ai = any(i.get("key") == data.key and i.get("ai") for i in (v.thumbnail_ideas or []))
    ctx.db.commit()
    return studio_video(v)


@router.delete("/videos/{video_id}/thumbnail")
def reset_thumbnail(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = own_video(ctx, video_id)
    v.thumbnail_key = None
    v.thumbnail_ai = False
    ctx.db.commit()
    return studio_video(v)


@router.get("/videos/{video_id}/transcript")
def get_transcript(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads"))):
    v = own_video(ctx, video_id)
    tr = ctx.db.execute(select(Transcript).where(Transcript.video_id == v.id, Transcript.is_current.is_(True))).scalars().first()
    if tr is None:
        return {"transcript": None, "segments": []}
    segs = ctx.db.execute(select(Segment).where(Segment.transcript_id == tr.id).order_by(Segment.idx)).scalars().all()
    return {"transcript": {"id": tr.id, "language": tr.language, "source": tr.source, "provider": tr.provider,
                           "version": tr.version, "edited": tr.edited},
            "segments": [{"idx": s.idx, "start_ms": s.start_ms, "end_ms": s.end_ms, "text": s.text} for s in segs]}


class SegmentEdit(BaseModel):
    idx: int
    text: str = Field(min_length=1, max_length=4000)


class TranscriptEdit(BaseModel):
    segments: list[SegmentEdit]


@router.put("/videos/{video_id}/transcript")
def edit_transcript(video_id: int, data: TranscriptEdit, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = own_video(ctx, video_id)
    tr = ctx.db.execute(select(Transcript).where(Transcript.video_id == v.id, Transcript.is_current.is_(True))).scalars().first()
    if tr is None:
        raise err(409, "video_not_ready")
    by_idx = {e.idx: e.text.strip() for e in data.segments}
    for s in ctx.db.execute(select(Segment).where(Segment.transcript_id == tr.id)).scalars().all():
        if s.idx in by_idx and by_idx[s.idx] != s.text:
            s.text = by_idx[s.idx]
            s.embedding = None
    tr.edited = True
    ctx.db.commit()
    from app.video.pipeline.housekeeping import reanalyse

    reanalyse.enqueue(v.id)
    return get_transcript(video_id, ctx)


@router.post("/videos/{video_id}/captions")
async def upload_captions(video_id: int, file: UploadFile = File(...), language: str = Form("en"),
                          ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    from app.ai.captions import parse
    from app.video.pipeline.jobs import process_captions

    v = own_video(ctx, video_id)
    raw = (await file.read()).decode("utf-8", "replace")
    cues = parse(raw)
    if not cues:
        raise err(400, "caption_file_unreadable")
    if v.source == "embed" and v.status == "uploading":
        v.status = "scanning"
        ctx.db.commit()
    process_captions.enqueue(v.id, [{"start_ms": c.start_ms, "end_ms": c.end_ms, "text": c.text} for c in cues],
                             language[:8], "creator")
    return {"cues": len(cues), "language": language}


@router.post("/videos/{video_id}/reprocess")
def reprocess(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    from app.video.pipeline.housekeeping import reanalyse

    v = own_video(ctx, video_id)
    if v.status not in ("published", "in_review"):
        raise err(409, "video_not_ready")
    reanalyse.enqueue(v.id)
    return {"queued": True}
