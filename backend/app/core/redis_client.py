"""The Redis connection, in one place."""

from __future__ import annotations

import logging
from functools import lru_cache

import redis

from app.config import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_redis() -> redis.Redis:
    """The shared client. decode_responses so callers deal in str, never bytes."""
    return redis.Redis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
        health_check_interval=30,
    )


def redis_available() -> bool:
    """A cheap probe, for the health endpoint and for tests that skip without it."""
    try:
        return bool(get_redis().ping())
    except redis.RedisError as exc:
        logger.warning("redis unavailable: %s", exc)
        return False
