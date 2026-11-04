from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.core.redis_client import get_redis
from app.video.models.ai import RecoImpression, RecoModel
from app.video.models.media import Video
from app.video.models.social import Follow, Profile, WatchProgress
from app.video.reco import model as mdl

LOG_KEY = "kv:reco:imp"
_active: tuple[float, dict | None] = (0.0, None)


def now() -> datetime:
    return datetime.now(timezone.utc)


def active(db: Session) -> dict | None:
    import time

    global _active
    at, m = _active
    if time.monotonic() - at < 30:
        return m
    row = db.execute(select(RecoModel).where(RecoModel.status == "active").order_by(RecoModel.id.desc())).scalars().first()
    m = None if row is None else {"id": row.id, "version": row.version, "weights": row.weights, "bias": row.bias,
                                  "mean": row.mean, "std": row.std, "features": row.features}
    _active = (time.monotonic(), m)
    return m


def forget() -> None:
    global _active
    _active = (0.0, None)


def arm(db: Session, user_id: int | None) -> str:
    if user_id is None or settings.RECO_MODEL != "on" or active(db) is None:
        return "heuristic"
    return "model" if (user_id * 2654435761) % 100 < settings.RECO_AB_PERCENT else "heuristic"


def features(db: Session, user_id: int, videos: list[Video], lang: str | None, at: datetime | None = None) -> np.ndarray:
    from app.video.social import reco

    at = at or now()
    ids = [v.id for v in videos]
    sims = reco.similarities(db, reco.taste(db, user_id), ids)
    by_channel = dict(db.execute(select(Video.channel_id, func.count(WatchProgress.id))
                                 .join(Video, Video.id == WatchProgress.video_id)
                                 .where(WatchProgress.user_id == user_id).group_by(Video.channel_id)).all())
    followed = set(db.execute(select(Follow.channel_id).where(Follow.user_id == user_id)).scalars().all())
    seen = set(db.execute(select(WatchProgress.video_id).where(WatchProgress.user_id == user_id,
                                                               WatchProgress.completed.is_(True))).scalars().all())
    rows = []
    for v in videos:
        hours = max(0.0, (at - (v.published_at or v.created_at)).total_seconds() / 3600)
        rows.append([sims.get(v.id, 0.0), math.log1p(by_channel.get(v.channel_id, 0)), float(v.channel_id in followed),
                     math.log1p(v.view_count), math.exp(-hours / 336), v.like_count / (v.view_count + 5),
                     float(bool(lang) and v.language == lang), float(v.kind == "reel"), math.log1p(v.duration_ms / 60000),
                     float(v.id in seen)])
    return np.array(rows, dtype=float) if rows else np.zeros((0, len(mdl.FEATURES)))


def scores(db: Session, user_id: int, videos: list[Video], lang: str | None) -> dict[int, float] | None:
    m = active(db)
    if m is None or not videos:
        return None
    s = mdl.score(m, features(db, user_id, videos, lang))
    return {v.id: float(x) for v, x in zip(videos, s)}


def log(user_id: int, video_ids: list[int], offset: int, surface: str, arm_name: str) -> None:
    if not video_ids or settings.RECO_LOG_SAMPLE <= 0:
        return
    import random

    if random.random() > settings.RECO_LOG_SAMPLE:
        return
    t = now().isoformat()
    try:
        get_redis().rpush(LOG_KEY, *[json.dumps({"u": user_id, "v": vid, "p": offset + i, "s": surface, "a": arm_name, "t": t})
                                     for i, vid in enumerate(video_ids[:20])])
    except Exception:
        pass


def flush(db: Session, batch: int = 5000) -> int:
    r = get_redis()
    pipe = r.pipeline()
    pipe.lrange(LOG_KEY, 0, batch - 1)
    pipe.ltrim(LOG_KEY, batch, -1)
    items, _ = pipe.execute()
    rows = []
    for raw in items:
        d = json.loads(raw)
        rows.append(RecoImpression(user_id=d["u"], video_id=d["v"], position=d["p"], surface=d["s"][:8], arm=d["a"][:10],
                                   shown_at=datetime.fromisoformat(d["t"])))
    db.add_all(rows)
    db.flush()
    return len(rows)


def label(db: Session, window: timedelta = timedelta(hours=24)) -> int:
    cutoff = now() - window
    rows = db.execute(select(RecoImpression).where(RecoImpression.labelled.is_(False)).limit(20000)).scalars().all()
    if not rows:
        return 0
    users = {r.user_id for r in rows}
    watched = defaultdict(list)
    for uid, vid, at in db.execute(select(WatchProgress.user_id, WatchProgress.video_id, WatchProgress.updated_at)
                                   .where(WatchProgress.user_id.in_(users))).all():
        watched[(uid, vid)].append(at)
    n = 0
    for r in rows:
        hit = [a for a in watched.get((r.user_id, r.video_id), []) if r.shown_at <= a <= r.shown_at + window]
        if hit:
            r.clicked_at, r.labelled = min(hit), True
            n += 1
        elif r.shown_at < cutoff:
            r.labelled = True
    db.flush()
    return n


def dataset(db: Session, days: int = 30) -> tuple:
    from app.video.models.social import Channel
    from app.video.social.feed import _score

    rows = db.execute(select(RecoImpression).where(RecoImpression.labelled.is_(True),
                                                   RecoImpression.shown_at >= now() - timedelta(days=days))
                      .order_by(RecoImpression.shown_at)).scalars().all()
    if not rows:
        return None
    vids = {v.id: v for v in db.execute(select(Video).where(Video.id.in_({r.video_id for r in rows}))).scalars()}
    langs = dict(db.execute(select(Profile.user_id, Profile.language).where(Profile.user_id.in_({r.user_id for r in rows}))).all())
    by_user = defaultdict(list)
    for r in rows:
        if r.video_id in vids:
            by_user[r.user_id].append(r)
    X, y, groups, times, base = [], [], [], [], []
    for uid, items in by_user.items():
        followed = set(db.execute(select(Follow.channel_id).where(Follow.user_id == uid)).scalars().all())
        f = features(db, uid, [vids[r.video_id] for r in items], langs.get(uid))
        for r, row in zip(items, f):
            v = vids[r.video_id]
            X.append(row)
            y.append(1.0 if r.clicked_at else 0.0)
            groups.append(hash((uid, r.shown_at.date())) % (10 ** 9))
            times.append(r.shown_at.timestamp())
            base.append(_score(v, {}, followed, langs.get(uid), v.kind == "reel"))
    return np.array(X), np.array(y), np.array(groups), np.array(times), np.array(base)


def train(db: Session, *, auto_promote: bool = True) -> RecoModel | None:
    data = dataset(db)
    if data is None or len(data[1]) < settings.RECO_MIN_ROWS or data[1].sum() < 5:
        return None
    X, y, g, t, b = data
    final, metrics = mdl.evaluate(X, y, g, t, b)
    version = now().strftime("%Y%m%d-%H%M%S")
    row = RecoModel(version=version, status="candidate", features=mdl.FEATURES, weights=final["weights"], bias=final["bias"],
                    mean=final["mean"], std=final["std"], metrics=metrics)
    db.add(row)
    db.flush()
    if auto_promote and metrics["n_test"] >= settings.RECO_MIN_TEST_ROWS and metrics["ndcg10"] > metrics["ndcg10_baseline"] + 0.01:
        promote(db, row, None, "Beat the heuristic offline")
    return row


def promote(db: Session, row: RecoModel, actor: int | None, note: str | None = None) -> None:
    db.execute(update(RecoModel).where(RecoModel.status == "active", RecoModel.id != row.id).values(status="retired"))
    row.status, row.promoted_at, row.promoted_by, row.note = "active", now(), actor, note
    db.flush()
    forget()


def ctr(db: Session, hours: int = 24) -> dict:
    since = now() - timedelta(hours=hours)
    out = {}
    for a, n, c in db.execute(select(RecoImpression.arm, func.count(RecoImpression.id), func.count(RecoImpression.clicked_at))
                              .where(RecoImpression.shown_at >= since).group_by(RecoImpression.arm)).all():
        out[a] = {"shown": int(n), "clicked": int(c), "ctr_bps": int(c) * 10000 // int(n) if n else 0}
    return out
