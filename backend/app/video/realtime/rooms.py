from __future__ import annotations

import json
import logging

from redis import RedisError

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)


def channel(video_id: int) -> str:
    return f"kv:room:{video_id}"


def publish(video_id: int, event: dict) -> None:
    try:
        get_redis().publish(channel(video_id), json.dumps(event, separators=(",", ":")))
    except RedisError:
        logger.warning("room publish failed", extra={"video": video_id})
