from __future__ import annotations

from app.video.jobs import job
from app.video.media.providers import provider
from app.video.models.media import Video
from app.video.sessions import platform_session


@job
def delete_media(video_id: int) -> None:
    with platform_session() as db:
        video = db.get(Video, video_id)
        if video is None or not video.is_deleted or video.source == "embed":
            return
        try:
            provider(video.provider).delete(video)
        except Exception:
            pass


@job(queue_name="ai", timeout=1800)
def reanalyse(video_id: int) -> None:
    import os
    import shutil

    from app.ai import embed as embedder
    from app.ai import stt
    from app.video.pipeline.jobs import _record, analyse, current_cues, store_transcript, work_dir
    from app.video.models.ai import Insight

    with platform_session() as db:
        video = db.get(Video, video_id)
        if video is None or video.status not in ("published", "in_review"):
            return
        cues = current_cues(db, video_id)
        if not cues and video.source != "embed":
            work = work_dir(f"r{video_id}")
            try:
                src = os.path.join(work, "source")
                provider(video.provider).fetch_source(video, src)
                result = stt.transcribe(src, work, video.language)
                if result.cues:
                    store_transcript(db, video, result.cues, result.language or video.language, "stt", result.provider)
                    _record(db, video, "transcribe", "done", provider=result.provider)
                    cues = result.cues
            except Exception as exc:
                _record(db, video, "transcribe", "failed", error=str(exc)[:500])
            finally:
                shutil.rmtree(work, ignore_errors=True)
            db.commit()
        db.execute(Insight.__table__.delete().where(Insight.video_id == video_id))
        analyse(db, video, cues)
        video.ai_status = "ready"
        db.commit()
