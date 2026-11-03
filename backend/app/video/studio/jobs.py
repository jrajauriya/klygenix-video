from __future__ import annotations

import os
import shutil

from app.video.commerce import quotas
from app.video.jobs import job
from app.video.media import ffmpeg
from app.video.media.paths import work_dir
from app.video.media.providers import provider
from app.video.models.media import Video
from app.video.models.studio import Clip
from app.video.sessions import platform_session
from app.video.storage import backend
from app.video.studio.render import Spec, render


@job(queue_name="render", timeout=3600)
def render_clip(clip_id: int, per: str | None = None) -> None:
    from app.video.pipeline.jobs import current_cues

    work = work_dir(f"clip{clip_id}")
    try:
        with platform_session() as db:
            clip = db.get(Clip, clip_id)
            if clip is None or clip.status not in ("queued", "rendering"):
                return
            video = db.get(Video, clip.source_video_id)
            clip.status = "rendering"
            db.commit()
            owner = quotas.owner_user_id(db, clip.tenant_id)
            try:
                src = provider(video.provider).fetch_source(video, os.path.join(work, "source"))
                info = ffmpeg.probe(src)
                cues = current_cues(db, video.id)
                spec = Spec(start_ms=clip.start_ms, end_ms=min(clip.end_ms, info.duration_ms), aspect=clip.aspect,
                            center_x=float((clip.reframe or {}).get("center_x", 0.5)), caption_style=clip.caption_style,
                            watermark=clip.watermark)
                out = os.path.join(work, "out.mp4")
                render(src, out, work, info, cues, spec)
                key = f"clips/t{clip.tenant_id}/{clip.id}.mp4"
                with open(out, "rb") as fh:
                    backend().put(key, fh.read(), "video/mp4")
                clip.output_key = key
                clip.status = "rendered"
                clip.error = None
                if per and owner:
                    quotas.commit(db, clip.tenant_id, owner, "renders", 1, per)
            except Exception as exc:
                clip.status = "failed"
                clip.error = str(exc)[:500]
                if per and owner:
                    quotas.release(db, clip.tenant_id, owner, "renders", 1, per)
            db.commit()
    finally:
        shutil.rmtree(work, ignore_errors=True)


@job(queue_name="render", timeout=1800)
def publish_clip(clip_id: int, video_id: int) -> None:
    work = work_dir(f"pub{clip_id}")
    try:
        with platform_session() as db:
            clip = db.get(Clip, clip_id)
            video = db.get(Video, video_id)
            if clip is None or video is None or not clip.output_key:
                return
            path = os.path.join(work, "clip.mp4")
            with open(path, "wb") as fh:
                fh.write(backend().get(clip.output_key))
            prov = provider(video.provider)
            video.provider_video_id = prov.ingest_file(video, path)
            video.status = "processing"
            clip.status = "published"
            clip.output_video_id = video.id
            db.commit()
            if prov.name == "sandbox":
                from app.video.pipeline.jobs import sandbox_encode

                sandbox_encode.enqueue(video.id)
    finally:
        shutil.rmtree(work, ignore_errors=True)
