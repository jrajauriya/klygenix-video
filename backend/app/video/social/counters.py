from __future__ import annotations

import logging

from redis import RedisError
from sqlalchemy import update

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

PREFIX = "kv:cnt"
VIDEO_FIELDS = ("view_count", "like_count", "comment_count", "danmaku_count", "watch_ms", "completions")
CHANNEL_FIELDS = ("follower_count", "video_count")


def incr(kind: str, obj_id: int, field: str, n: int = 1) -> None:
    try:
        r = get_redis()
        r.hincrby(f"{PREFIX}:{kind}:{obj_id}", field, n)
        r.sadd(f"{PREFIX}:dirty", f"{kind}:{obj_id}")
    except RedisError:
        logger.warning("counter not recorded", extra={"kind": kind, "id": obj_id, "field": field})


def pending(kind: str, ids: list[int]) -> dict[int, dict[str, int]]:
    if not ids:
        return {}
    try:
        r = get_redis()
        pipe = r.pipeline()
        for i in ids:
            pipe.hgetall(f"{PREFIX}:{kind}:{i}")
        out = {}
        for i, data in zip(ids, pipe.execute()):
            if data:
                out[i] = {(k.decode() if isinstance(k, bytes) else k): int(v) for k, v in data.items()}
        return out
    except RedisError:
        return {}


def flush(db) -> int:
    from app.video.models.media import Video
    from app.video.models.social import Channel

    try:
        r = get_redis()
        members = r.smembers(f"{PREFIX}:dirty")
    except RedisError:
        return 0
    done = 0
    for raw in members:
        member = raw.decode() if isinstance(raw, bytes) else raw
        kind, _, obj = member.partition(":")
        key = f"{PREFIX}:{member}"
        pipe = r.pipeline()
        pipe.hgetall(key)
        pipe.delete(key)
        pipe.srem(f"{PREFIX}:dirty", member)
        data, _, _ = pipe.execute()
        if not data:
            continue
        values = {(k.decode() if isinstance(k, bytes) else k): int(v) for k, v in data.items()}
        model, allowed = (Video, VIDEO_FIELDS) if kind == "video" else (Channel, CHANNEL_FIELDS)
        changes = {f: getattr(model, f) + n for f, n in values.items() if f in allowed and n}
        if changes:
            db.execute(update(model).where(model.id == int(obj)).values(**changes))
            if kind == "video":
                daily(db, int(obj), values)
            done += 1
    db.commit()
    return done


def daily(db, video_id: int, values: dict) -> None:
    from sqlalchemy import text

    views, watch, done, likes = (values.get("view_count", 0), values.get("watch_ms", 0),
                                 values.get("completions", 0), values.get("like_count", 0))
    if not (views or watch or done or likes):
        return
    db.execute(text(
        "INSERT INTO kv_social.view_daily (tenant_id, video_id, day, views, watch_ms, completions, likes, retention) "
        "SELECT tenant_id, id, (now() AT TIME ZONE 'Asia/Kolkata')::date, :v, :w, :c, :l, '[]'::jsonb FROM kv_media.videos WHERE id = :id "
        "ON CONFLICT (video_id, day) DO UPDATE SET views = view_daily.views + EXCLUDED.views, "
        "watch_ms = view_daily.watch_ms + EXCLUDED.watch_ms, completions = view_daily.completions + EXCLUDED.completions, "
        "likes = view_daily.likes + EXCLUDED.likes"), {"v": views, "w": watch, "c": done, "l": likes, "id": video_id})
