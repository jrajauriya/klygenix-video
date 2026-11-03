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
    from app.ai import embed as embedder
    from app.video.pipeline.jobs import analyse, current_cues
    from app.video.models.ai import Insight

    with platform_session() as db:
        video = db.get(Video, video_id)
        if video is None or video.status not in ("published", "in_review"):
            return
        cues = current_cues(db, video_id)
        db.execute(Insight.__table__.delete().where(Insight.video_id == video_id))
        analyse(db, video, cues)
        video.ai_status = "ready"
        db.commit()
