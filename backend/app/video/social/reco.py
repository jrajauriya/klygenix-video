from __future__ import annotations

import json
import math

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.ai import embed as embedder
from app.core.redis_client import get_redis
from app.video.models.ai import Segment, VideoVector
from app.video.models.media import Video
from app.video.models.social import WatchProgress

HISTORY = 50
TASTE_TTL = 600
AFFINITY_TTL = 120
WEIGHT = 3.0


def _norm(vec: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / n for x in vec]


def refresh_vector(db: Session, video: Video) -> bool:
    segs = [s.embedding for s in db.execute(select(Segment).where(Segment.video_id == video.id,
                                                                  Segment.embedding.is_not(None))).scalars()]
    head = embedder.embed([" ".join([video.title, video.description or "", " ".join(video.tags or [])])])[0]
    if segs:
        dim = len(head)
        body = [sum(float(s[i]) for s in segs) / len(segs) for i in range(dim)]
        vec = _norm([0.6 * a + 0.4 * b for a, b in zip(_norm(body), head)])
    else:
        vec = _norm(list(head))
    row = db.get(VideoVector, video.id)
    if row is None:
        db.add(VideoVector(video_id=video.id, embedding=vec, model=embedder.provider_name()))
    else:
        row.embedding, row.model = vec, embedder.provider_name()
    db.flush()
    return True


def taste(db: Session, user_id: int) -> list[float] | None:
    key = f"kv:taste:{user_id}"
    try:
        cached = get_redis().get(key)
        if cached:
            data = json.loads(cached)
            return data or None
    except Exception:
        cached = None
    rows = db.execute(select(WatchProgress, Video.duration_ms).join(Video, Video.id == WatchProgress.video_id)
                      .where(WatchProgress.user_id == user_id).order_by(WatchProgress.updated_at.desc()).limit(HISTORY)).all()
    weights = {}
    for wp, duration in rows:
        w = 1.0 if wp.completed else max(0.2, min(1.0, wp.position_ms / duration)) if duration else 0.2
        weights[wp.video_id] = w
    vec = None
    if weights:
        vecs = db.execute(select(VideoVector.video_id, VideoVector.embedding).where(VideoVector.video_id.in_(weights))).all()
        if vecs:
            dim = len(vecs[0][1])
            acc = [0.0] * dim
            for vid, emb in vecs:
                w = weights[vid]
                for i in range(dim):
                    acc[i] += w * float(emb[i])
            vec = _norm(acc)
    try:
        get_redis().setex(key, TASTE_TTL, json.dumps(vec or []))
    except Exception:
        pass
    return vec


def forget(user_id: int) -> None:
    try:
        get_redis().delete(f"kv:taste:{user_id}", f"kv:aff:{user_id}")
    except Exception:
        pass


def affinity(db: Session, user_id: int, ids: list[int]) -> tuple[dict[int, float], set[int]]:
    key = f"kv:aff:{user_id}"
    try:
        cached = get_redis().get(key)
        if cached:
            data = json.loads(cached)
            return {int(k): v for k, v in data["a"].items()}, set(data["s"])
    except Exception:
        pass
    sims = similarities(db, taste(db, user_id), ids)
    seen = watched_ids(db, user_id)
    try:
        get_redis().setex(key, AFFINITY_TTL, json.dumps({"a": sims, "s": sorted(seen)}))
    except Exception:
        pass
    return sims, seen


def similarities(db: Session, vec: list[float] | None, ids: list[int]) -> dict[int, float]:
    if not vec or not ids:
        return {}
    rows = db.execute(text("SELECT video_id, 1 - (embedding <=> CAST(:q AS vector)) FROM kv_ai.video_vectors "
                           "WHERE video_id = ANY(:ids)"), {"q": "[" + ",".join(f"{x:.6f}" for x in vec) + "]", "ids": ids}).all()
    return {int(v): float(s) for v, s in rows}


def watched_ids(db: Session, user_id: int) -> set[int]:
    return set(db.execute(select(WatchProgress.video_id).where(WatchProgress.user_id == user_id,
                                                               WatchProgress.completed.is_(True))).scalars().all())
