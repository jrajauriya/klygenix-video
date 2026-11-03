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


@sweep
def creator_money() -> None:
    from datetime import timedelta

    from app.video.commerce import payouts, splits, statements

    splits.release_due()
    with platform_session() as db:
        payouts.refresh_waiting(db)
        db.commit()
    now = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    if now.day <= 5:
        last = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
        with platform_session() as db:
            statements.issue_month(db, last)
            db.commit()


@sweep
def membership_reminders() -> None:
    from datetime import timedelta

    from app.video.models.commerce import Subscription
    from app.video.models.payouts import MembershipTier
    from app.video.models.social import Channel
    from app.video.services.push import notify

    now = datetime.now(timezone.utc)
    with platform_session() as db:
        for sub in db.execute(select(Subscription).where(Subscription.audience == "member", Subscription.status == "active",
                                                         Subscription.current_period_end <= now + timedelta(days=3),
                                                         Subscription.current_period_end > now)).scalars().all():
            tier = db.get(MembershipTier, int(sub.plan_key.split(":")[1]))
            ch = db.get(Channel, tier.channel_id) if tier else None
            if ch is None:
                continue
            verb = "ends" if sub.cancel_at_period_end else "needs renewing"
            notify(db, sub.user_id, "membership", f"Your {tier.name} membership {verb} soon",
                   f"{ch.name} · {sub.current_period_end.date().isoformat()}", {"url": f"/@{ch.handle}"},
                   f"member:{sub.id}:{sub.current_period_end.date().isoformat()}")
        db.commit()


@sweep
def retention() -> None:
    from app.core.redis_client import get_redis
    from app.video import retention as policy

    try:
        if not get_redis().set("kv:sweep:retention", 1, nx=True, ex=6 * 3600):
            return
    except Exception:
        return
    with platform_session() as db:
        policy.run(db)
        db.commit()
