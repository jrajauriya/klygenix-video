from __future__ import annotations

import glob
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.video.models.ai import AskMessage, TextTranslation
from app.video.models.community import LiveMessage, QuizAttempt
from app.video.models.media import LiveStream, Video
from app.video.models.social import PushMessage

POLICY = {
    "ask_messages_days": 365,
    "quiz_attempts_days": 365,
    "push_messages_days": 90,
    "live_messages_days": 90,
    "translations_days": 180,
    "deleted_media_days": 30,
    "live_segments_hours": 24,
    "unstarted_live_hours": 24,
    "reco_impressions_days": 90,
    "mail_outbox_days": 180,
}


def run(db: Session, now: datetime | None = None) -> dict:
    from app.video.live.service import live_dir
    from app.video.media.providers import provider

    now = now or datetime.now(timezone.utc)
    out: dict[str, int] = {}

    def older(days: int) -> datetime:
        return now - timedelta(days=days)

    out["ask_messages"] = db.execute(delete(AskMessage).where(AskMessage.created_at < older(POLICY["ask_messages_days"]))).rowcount
    out["quiz_attempts"] = db.execute(delete(QuizAttempt).where(QuizAttempt.created_at < older(POLICY["quiz_attempts_days"]))).rowcount
    out["push_messages"] = db.execute(delete(PushMessage).where(PushMessage.created_at < older(POLICY["push_messages_days"]))).rowcount
    out["translations"] = db.execute(delete(TextTranslation).where(TextTranslation.created_at < older(POLICY["translations_days"]))).rowcount
    from app.core.models.beta import MailOutbox
    from app.video.models.ai import RecoImpression

    out["reco_impressions"] = db.execute(delete(RecoImpression).where(RecoImpression.shown_at < older(POLICY["reco_impressions_days"]))).rowcount
    out["mail_outbox"] = db.execute(delete(MailOutbox).where(MailOutbox.created_at < older(POLICY["mail_outbox_days"]))).rowcount
    old_streams = select(LiveStream.id).where(LiveStream.status.in_(("ended", "failed")),
                                              LiveStream.ended_at < older(POLICY["live_messages_days"]))
    out["live_messages"] = db.execute(delete(LiveMessage).where(LiveMessage.stream_id.in_(old_streams))).rowcount
    purged = 0
    for v in db.execute(select(Video).where(Video.is_deleted.is_(True), Video.provider_video_id.is_not(None),
                                            Video.updated_at < older(POLICY["deleted_media_days"]))).scalars().all():
        try:
            provider(v.provider).delete(v)
        except Exception:
            continue
        v.provider_video_id = None
        purged += 1
    out["deleted_media"] = purged
    cleared = 0
    for s in db.execute(select(LiveStream).where(LiveStream.status.in_(("ended", "failed")),
                                                 LiveStream.ended_at < now - timedelta(hours=POLICY["live_segments_hours"]))).scalars():
        directory = live_dir(s.id)
        files = glob.glob(os.path.join(directory, "seg_*.ts")) + glob.glob(os.path.join(directory, "record_*.ts"))
        if s.replay_video_id or not s.replay_enabled:
            files += glob.glob(os.path.join(directory, "replay.mp4"))
        for f in files:
            try:
                os.remove(f)
                cleared += 1
            except OSError:
                pass
    out["live_files"] = cleared
    stale = now - timedelta(hours=POLICY["unstarted_live_hours"])
    closed = 0
    for s in db.execute(select(LiveStream).where(LiveStream.status == "scheduled", LiveStream.started_at.is_(None),
                                                 func.coalesce(LiveStream.scheduled_at, LiveStream.created_at) < stale)).scalars():
        s.status, s.ended_at, s.error = "failed", now, "Never went live"
        closed += 1
    out["unstarted_live"] = closed
    db.flush()
    return out
