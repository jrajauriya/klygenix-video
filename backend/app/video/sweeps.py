from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.video.jobs.sweeps import sweep
from app.video.sessions import platform_session


@sweep
def flush_counters() -> None:
    from app.video.social import counters

    with platform_session() as db:
        counters.flush(db)


@sweep
def publish_scheduled() -> None:
    from app.video.models.media import Video

    now = datetime.now(timezone.utc)
    with platform_session() as db:
        for v in db.execute(select(Video).where(Video.visibility == "scheduled", Video.status == "published",
                                                Video.publish_at <= now)).scalars().all():
            v.visibility = "public"
            v.published_at = v.publish_at or now
        db.commit()


@sweep
def lapse_subscriptions() -> None:
    from app.video.commerce.service import lapse_due

    with platform_session() as db:
        lapse_due(db)
        db.commit()


@sweep
def channel_video_counts() -> None:
    from sqlalchemy import func, update

    from app.video.models.media import Video
    from app.video.models.social import Channel

    with platform_session() as db:
        counts = dict(db.execute(select(Video.channel_id, func.count(Video.id)).where(
            Video.status == "published", Video.visibility == "public", Video.is_deleted.is_(False)).group_by(Video.channel_id)).all())
        for cid, n in counts.items():
            db.execute(update(Channel).where(Channel.id == cid, Channel.video_count != n).values(video_count=n))
        db.commit()
