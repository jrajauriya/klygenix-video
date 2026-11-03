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
from app.video.studio import faces, reframe


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
                rf = clip.reframe or {}
                track = tuple(rf.get("track") or ()) if rf.get("mode") in ("manual", "track") else ()
                music_path = None
                mus = clip.music or {}
                if mus.get("track_id"):
                    from app.video.models.studio import MusicTrack

                    t = db.get(MusicTrack, int(mus["track_id"]))
                    if t is not None:
                        music_path = os.path.join(work, "music.m4a")
                        with open(music_path, "wb") as fh:
                            fh.write(backend().get(t.storage_key))
                spec = Spec(start_ms=clip.start_ms, end_ms=min(clip.end_ms, info.duration_ms), aspect=clip.aspect,
                            center_x=float(rf.get("center_x", 0.5)), track=track, caption_style=clip.caption_style,
                            watermark=clip.watermark, music_path=music_path,
                            music_volume=float(mus.get("volume", 0.25)), duck=bool(mus.get("duck", True)))
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


@job(queue_name="render", timeout=1800)
def track_clip(clip_id: int) -> None:
    work = work_dir(f"track{clip_id}")
    try:
        with platform_session() as db:
            clip = db.get(Clip, clip_id)
            if clip is None or (clip.reframe or {}).get("status") != "tracking":
                return
            video = db.get(Video, clip.source_video_id)
            try:
                src = provider(video.provider).fetch_source(video, os.path.join(work, "source"))
                pad = 1000
                samples = faces.detect(src, max(0, clip.start_ms - pad), clip.end_ms + pad)
                found = sum(1 for _, c in samples if c is not None)
                clip.reframe = {"mode": "track", "status": "ready", "detector": faces.detector().name,
                                "center_x": 0.5, "samples": len(samples), "found": found,
                                "track": reframe.track_from(samples)}
            except Exception as exc:
                clip.reframe = {"mode": "center", "center_x": 0.5, "status": "failed", "error": str(exc)[:300]}
            db.commit()
    finally:
        shutil.rmtree(work, ignore_errors=True)


@job(queue_name="render", timeout=3600)
def publish_target(target_id: int) -> None:
    from app.config import settings
    from app.video.media.signing import expiry, sign
    from app.video.models.studio import PublishTarget
    from app.video.studio.publishers import PublishError, publisher

    work = work_dir(f"target{target_id}")
    try:
        with platform_session() as db:
            t = db.get(PublishTarget, target_id)
            if t is None or t.status not in ("queued", "failed"):
                return
            clip = db.get(Clip, t.clip_id)
            t.status = "publishing"
            db.commit()
            try:
                if clip is None or not clip.output_key:
                    raise PublishError("Render the clip first.")
                path = os.path.join(work, "clip.mp4")
                with open(path, "wb") as fh:
                    fh.write(backend().get(clip.output_key))
                exp = expiry(3600)
                url = (f"{settings.API_PUBLIC_BASE_URL.rstrip('/')}/api/video/studio/clip-files/"
                       f"{clip.id}/{exp}/{sign('clip', clip.id, exp)}.mp4")
                out = publisher(t.platform).publish(tenant_id=t.tenant_id, path=path, title=clip.title,
                                                    caption=t.caption, public_url=url)
                t.status, t.external_id, t.external_url, t.error = "published", out.external_id, out.external_url, None
            except PublishError as exc:
                t.status, t.error = "failed", str(exc)[:500]
            except Exception as exc:
                t.status, t.error = "failed", f"{type(exc).__name__}: {exc}"[:500]
            db.commit()
    finally:
        shutil.rmtree(work, ignore_errors=True)
