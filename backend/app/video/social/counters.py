from __future__ import annotations

import logging

from redis import RedisError
from sqlalchemy import update

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

PREFIX = "kv:cnt"
VIDEO_FIELDS = ("view_count", "like_count", "comment_count", "danmaku_count", "watch_ms", "completions")
CHANNEL_FIELDS = ("follower_count", "video_count")
BUCKETS = 50
SOURCES = ("home", "reels", "search", "channel", "related", "playlist", "share", "external", "follow", "direct")


def watched(video_id: int, duration_ms: int, position_ms: int, watched_ms: int) -> None:
    if duration_ms <= 0 or watched_ms <= 0:
        return
    end = min(position_ms, duration_ms)
    start = max(0, end - watched_ms)
    first = min(BUCKETS - 1, start * BUCKETS // duration_ms)
    last = min(BUCKETS - 1, max(first, (end - 1) * BUCKETS // duration_ms))
    try:
        r = get_redis()
        pipe = r.pipeline()
        for b in range(first, last + 1):
            pipe.hincrby(f"{PREFIX}:video:{video_id}", f"r{b:02d}", 1)
        pipe.sadd(f"{PREFIX}:dirty", f"video:{video_id}")
        pipe.execute()
    except RedisError:
        logger.warning("retention not recorded", extra={"id": video_id})


def source(video_id: int, src: str | None, ref: str | None) -> None:
    key = src if src in SOURCES else "direct"
    fields = [f"s:{key}"]
    host = (ref or "").lower().strip()
    if key == "external" and host:
        host = host.split("//")[-1].split("/")[0].removeprefix("www.")[:60]
        if host:
            fields.append(f"x:{host}")
    for f in fields:
        incr("video", video_id, f, 1)


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
        pipe = r.pipeline(transaction=False)
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
            done += 1
        if kind == "video":
            daily(db, int(obj), values)
    db.commit()
    return done


def daily(db, video_id: int, values: dict) -> None:
    from sqlalchemy import text

    views, watch, done, likes = (values.get("view_count", 0), values.get("watch_ms", 0),
                                 values.get("completions", 0), values.get("like_count", 0))
    ret = {int(k[1:]): n for k, n in values.items() if k.startswith("r") and k[1:].isdigit()}
    src = {k[2:] if k.startswith("s:") else k: n for k, n in values.items() if k.startswith(("s:", "x:"))}
    if not (views or watch or done or likes or ret or src):
        return
    db.execute(text(
        "INSERT INTO kv_social.view_daily (tenant_id, video_id, day, views, watch_ms, completions, likes, retention) "
        "SELECT tenant_id, id, (now() AT TIME ZONE 'Asia/Kolkata')::date, :v, :w, :c, :l, '[]'::jsonb FROM kv_media.videos WHERE id = :id "
        "ON CONFLICT (video_id, day) DO UPDATE SET views = view_daily.views + EXCLUDED.views, "
        "watch_ms = view_daily.watch_ms + EXCLUDED.watch_ms, completions = view_daily.completions + EXCLUDED.completions, "
        "likes = view_daily.likes + EXCLUDED.likes"), {"v": views, "w": watch, "c": done, "l": likes, "id": video_id})
    if ret or src:
        import json

        row = db.execute(text("SELECT id, retention, sources FROM kv_social.view_daily WHERE video_id = :id "
                              "AND day = (now() AT TIME ZONE 'Asia/Kolkata')::date FOR UPDATE"), {"id": video_id}).first()
        if row is None:
            return
        curve = list(row.retention or [])
        curve += [0] * (BUCKETS - len(curve))
        for b, n in ret.items():
            if 0 <= b < BUCKETS:
                curve[b] += n
        merged = dict(row.sources or {})
        for k, n in src.items():
            merged[k] = merged.get(k, 0) + n
        db.execute(text("UPDATE kv_social.view_daily SET retention = CAST(:r AS jsonb), sources = CAST(:s AS jsonb) WHERE id = :id"),
                   {"r": json.dumps(curve), "s": json.dumps(merged), "id": row.id})
