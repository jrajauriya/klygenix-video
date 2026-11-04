from __future__ import annotations

import os

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import select

from app.config import settings
from app.core.messages import err
from app.video.media.paths import inside, video_dir
from app.video.media.signing import alive, valid
from app.video.models.media import Video
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video/sandbox", tags=["sandbox"])

TYPES = {".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t", ".jpg": "image/jpeg"}


def _on() -> None:
    if not settings.SANDBOX_ENABLED:
        raise err(404, "sandbox_only")


@router.put("/upload/{video_id}/{exp}/{sig}")
async def upload(video_id: int, exp: int, sig: str, request: Request):
    _on()
    if not alive(exp) or not valid(sig, "upload", video_id, exp):
        raise err(403, "upload_link_expired")
    with platform_session() as db:
        video = db.get(Video, video_id)
        if video is None or video.status != "uploading" or video.provider != "sandbox":
            raise err(409, "upload_link_expired")
    path = os.path.join(video_dir(video_id), "source")
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    with open(path, "wb") as fh:
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                fh.close()
                os.remove(path)
                raise err(413, "upload_too_large")
            fh.write(chunk)
    with platform_session() as db:
        video = db.get(Video, video_id)
        video.status = "processing"
        db.commit()
    from app.video.pipeline.jobs import sandbox_encode

    sandbox_encode.enqueue(video_id)
    return {"ok": True, "bytes": size}


@router.get("/hls/{video_id}/{exp}/{sig}/{path:path}")
def hls(video_id: int, exp: int, sig: str, path: str):
    _on()
    if not alive(exp) or not valid(sig, "hls", video_id, exp):
        raise err(403, "upload_link_expired")
    try:
        full = inside(os.path.join(video_dir(video_id), "hls"), path)
    except ValueError:
        raise err(404, "video_not_found")
    if not os.path.isfile(full):
        raise err(404, "video_not_found")
    ext = os.path.splitext(full)[1]
    return FileResponse(full, media_type=TYPES.get(ext, "application/octet-stream"),
                        headers={"Cache-Control": "private, max-age=3600", "Access-Control-Allow-Origin": "*"})


def _preview_playlist(text: str, seconds: int) -> tuple[str, int]:
    out, total, segs, take = [], 0.0, 0, True
    for line in text.splitlines():
        if line.startswith("#EXT-X-ENDLIST"):
            continue
        if line.startswith("#EXTINF:"):
            if total >= seconds:
                take = False
            else:
                total += float(line[8:].split(",")[0] or 0)
        if not take:
            continue
        if line and not line.startswith("#"):
            segs += 1
        out.append(line)
    out.append("#EXT-X-ENDLIST")
    return "\n".join(out) + "\n", segs


@router.get("/hls-preview/{video_id}/{seconds}/{exp}/{sig}/{path:path}")
def hls_preview(video_id: int, seconds: int, exp: int, sig: str, path: str):
    _on()
    if not alive(exp) or not valid(sig, "hlsp", video_id, seconds, exp):
        raise err(403, "upload_link_expired")
    try:
        full = inside(os.path.join(video_dir(video_id), "hls"), path)
    except ValueError:
        raise err(404, "video_not_found")
    if not os.path.isfile(full):
        raise err(404, "video_not_found")
    headers = {"Cache-Control": "private, max-age=600", "Access-Control-Allow-Origin": "*"}
    if full.endswith(".m3u8") and os.path.basename(full) != "master.m3u8":
        body, _ = _preview_playlist(open(full).read(), seconds)
        return Response(body, media_type=TYPES[".m3u8"], headers=headers)
    if full.endswith(".ts"):
        _, allowed = _preview_playlist(open(os.path.join(os.path.dirname(full), "index.m3u8")).read(), seconds)
        name = os.path.basename(full)
        if not name.startswith("seg_") or int(name[4:8]) >= allowed:
            raise err(403, "video_locked")
    ext = os.path.splitext(full)[1]
    return FileResponse(full, media_type=TYPES.get(ext, "application/octet-stream"), headers=headers)


@router.get("/thumb/{video_id}/{exp}/{sig}.jpg")
def thumb(video_id: int, exp: int, sig: str):
    _on()
    if not alive(exp) or not valid(sig, "thumb", video_id, exp):
        raise err(403, "upload_link_expired")
    full = os.path.join(video_dir(video_id), "thumb.jpg")
    if not os.path.isfile(full):
        raise err(404, "video_not_found")
    return FileResponse(full, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/download/{video_id}/{exp}/{sig}.mp4")
def download_file(video_id: int, exp: int, sig: str):
    _on()
    if not alive(exp) or not valid(sig, "dl", video_id, exp):
        raise err(403, "upload_link_expired")
    full = os.path.join(video_dir(video_id), "source")
    if not os.path.isfile(full):
        raise err(404, "video_not_found")
    return FileResponse(full, media_type="video/mp4", filename=f"{video_id}.mp4", headers={"Cache-Control": "private, no-store"})
