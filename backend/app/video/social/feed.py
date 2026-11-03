from __future__ import annotations

import math
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.video.models.media import Video
from app.video.models.social import Channel, Follow
from app.video.social import counters

CANDIDATES = 400
RECO_WEIGHT = 3.0


def now() -> datetime:
    return datetime.now(timezone.utc)


def _score(v: Video, pend: dict, followed: set[int], lang: str | None, reels: bool) -> float:
    views = v.view_count + pend.get("view_count", 0)
    likes = v.like_count + pend.get("like_count", 0)
    completions = v.completions + pend.get("completions", 0)
    comments = v.comment_count + pend.get("comment_count", 0)
    completion_rate = completions / views if views else 0.5
    hours = max(0.0, (now() - (v.published_at or v.created_at)).total_seconds() / 3600)
    engagement = 10 + likes * 3 + comments * 2 + math.log1p(views) * 4 + completions * (3 if reels else 1)
    quality = 1 + (completion_rate * (2.0 if reels else 0.8))
    boost = (2.0 if v.channel_id in followed else 1.0) * (1.25 if lang and v.language == lang else 1.0)
    return engagement * quality * boost / ((hours + 2) ** 1.15)


def ranked(db: Session, *, user_id: int | None, lang: str | None, kind: str | None, following_only: bool = False,
           exclude: set[int] | None = None) -> list[Video]:
    followed: set[int] = set()
    if user_id is not None:
        followed = set(db.execute(select(Follow.channel_id).where(Follow.user_id == user_id)).scalars().all())
    q = select(Video).join(Channel, Channel.id == Video.channel_id).where(
        Video.status == "published", Video.visibility == "public", Video.is_deleted.is_(False),
        Channel.is_suspended.is_(False))
    if kind:
        q = q.where(Video.kind == kind)
    if following_only:
        if not followed:
            return []
        q = q.where(Video.channel_id.in_(followed))
    rows = db.execute(q.order_by(Video.published_at.desc()).limit(CANDIDATES)).scalars().all()
    if exclude:
        rows = [r for r in rows if r.id not in exclude]
    pend = counters.pending("video", [r.id for r in rows])
    affinity: dict[int, float] = {}
    seen: set[int] = set()
    if user_id is not None and not following_only:
        from app.video.social import reco

        affinity, seen = reco.affinity(db, user_id, [r.id for r in rows])

    def score(v: Video) -> float:
        s = _score(v, pend.get(v.id, {}), followed, lang, kind == "reel")
        s *= 1 + RECO_WEIGHT * max(0.0, affinity.get(v.id, 0.0))
        return s * (0.35 if v.id in seen else 1.0)

    scored = sorted(rows, key=lambda v: -score(v))
    out, per_channel, held = [], {}, []
    for v in scored:
        n = per_channel.get(v.channel_id, 0)
        if n >= 2 and len(out) < 20:
            held.append(v)
            continue
        per_channel[v.channel_id] = n + 1
        out.append(v)
    return out + held
