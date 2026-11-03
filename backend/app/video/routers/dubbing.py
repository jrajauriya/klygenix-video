from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import Response as RawResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.config import settings
from app.core.messages import err
from app.video.media.dubbing import LABEL, dub_video, key_for
from app.video.media.signing import alive, expiry, sign, valid
from app.video.models.media import DubTrack, Video
from app.video.present import iso
from app.video.routers.deps import StudioCtx, studio
from app.video.routers.watch import LANGS
from app.video.sessions import platform_session
from app.video.storage import backend

router = APIRouter(prefix="/api/video", tags=["dubbing"])
NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu"}


def dub_out(d: DubTrack) -> dict:
    return {"language": d.language, "name": NAMES.get(d.language, d.language), "status": d.status, "voice": d.voice,
            "model": d.model, "error": d.error, "label": LABEL, "updated_at": iso(d.updated_at)}


def public_dubs(db, v: Video) -> list[dict]:
    if not v.dubbing_allowed:
        return []
    rows = db.execute(select(DubTrack).where(DubTrack.video_id == v.id, DubTrack.status == "ready")
                      .order_by(DubTrack.language)).scalars().all()
    exp = expiry(settings.PLAYBACK_TTL_SECONDS)
    base = settings.API_PUBLIC_BASE_URL.rstrip("/")
    return [{"language": d.language, "name": NAMES.get(d.language, d.language), "label": LABEL,
             "url": f"{base}/api/video/dubs/{v.id}/{d.language}/{exp}/{sign('dub', v.id, d.language, exp)}.m4a"} for d in rows]


def _own(ctx: StudioCtx, video_id: int) -> Video:
    v = ctx.db.get(Video, video_id)
    if v is None or v.tenant_id != ctx.tenant_id or v.is_deleted:
        raise err(404, "video_not_found")
    return v


class ConsentIn(BaseModel):
    allowed: bool


@router.put("/studio/videos/{video_id}/dubbing")
def consent(video_id: int, data: ConsentIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = _own(ctx, video_id)
    if data.allowed and v.source == "embed":
        raise err(400, "action_not_allowed")
    v.dubbing_allowed = data.allowed
    ctx.db.commit()
    return {"id": v.id, "dubbing_allowed": v.dubbing_allowed}


class DubIn(BaseModel):
    language: str


@router.get("/studio/videos/{video_id}/dubs")
def list_dubs(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads"))):
    v = _own(ctx, video_id)
    dubs = [dub_out(d) for d in ctx.db.execute(select(DubTrack).where(DubTrack.video_id == v.id)
                                               .order_by(DubTrack.language)).scalars()]
    have = {d["language"] for d in dubs}
    return {"dubbing_allowed": v.dubbing_allowed, "dubs": dubs,
            "languages": [{"code": c, "name": NAMES[c]} for c in LANGS if c != v.language and c not in have]}


@router.post("/studio/videos/{video_id}/dubs", status_code=202)
def request_dub(video_id: int, data: DubIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = _own(ctx, video_id)
    if not v.dubbing_allowed:
        raise err(409, "dubbing_needs_consent")
    if v.source == "embed" or v.ai_status != "ready" or v.status != "published":
        raise err(409, "ai_not_available_for_video")
    if data.language not in LANGS or data.language == v.language:
        raise err(400, "action_not_allowed")
    d = ctx.db.execute(select(DubTrack).where(DubTrack.video_id == v.id, DubTrack.language == data.language)).scalars().first()
    if d is not None and d.status == "queued":
        raise err(409, "action_not_allowed")
    if d is None:
        d = DubTrack(tenant_id=ctx.tenant_id, video_id=v.id, language=data.language)
        ctx.db.add(d)
    d.status, d.error = "queued", None
    ctx.db.commit()
    dub_video.enqueue(d.id)
    ctx.db.refresh(d)
    return dub_out(d)


@router.delete("/studio/videos/{video_id}/dubs/{language}", status_code=204)
def delete_dub(video_id: int, language: str, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = _own(ctx, video_id)
    d = ctx.db.execute(select(DubTrack).where(DubTrack.video_id == v.id, DubTrack.language == language)).scalars().first()
    if d is None:
        raise err(404, "action_not_allowed")
    backend().delete(key_for(v.id, language))
    ctx.db.delete(d)
    ctx.db.commit()
    return Response(status_code=204)


@router.get("/dubs/{video_id}/{language}/{exp}/{sig}.m4a")
def dub_file(video_id: int, language: str, exp: int, sig: str, request: Request):
    if not alive(exp) or not valid(sig, "dub", video_id, language, exp):
        raise err(403, "upload_link_expired")
    with platform_session() as db:
        v = db.get(Video, video_id)
        d = db.execute(select(DubTrack).where(DubTrack.video_id == video_id, DubTrack.language == language,
                                              DubTrack.status == "ready")).scalars().first()
        if v is None or d is None or not v.dubbing_allowed or v.is_deleted:
            raise err(404, "video_not_found")
    data = backend().get(key_for(video_id, language))
    headers = {"Cache-Control": "private, max-age=3600", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes"}
    rng = request.headers.get("range", "")
    if rng.startswith("bytes="):
        first, _, last = rng[6:].split(",")[0].partition("-")
        try:
            size = len(data)
            start = int(first) if first else max(0, size - int(last))
            end = min(int(last), size - 1) if first and last else size - 1
        except ValueError:
            start, end = 0, -1
        if not 0 <= start <= end:
            return RawResponse(status_code=416, headers={"Content-Range": f"bytes */{len(data)}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{len(data)}"
        return RawResponse(data[start:end + 1], status_code=206, media_type="audio/mp4", headers=headers)
    return RawResponse(data, media_type="audio/mp4", headers=headers)
