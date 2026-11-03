
from __future__ import annotations

import logging
from contextlib import contextmanager

import redis

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

FAILURES = 5
WINDOW = 300
COOLDOWN = 60


class BreakerOpen(ConnectionError):

    def __init__(self, name: str, key: str, retry_after: int) -> None:
        self.name = name
        self.key = key
        self.retry_after = retry_after
        super().__init__(
            f"{name} ({key}) has been failing, so calls to it are paused for about "
            f"{retry_after}s rather than each waiting out a timeout."
        )


def _keys(name: str, key: str) -> tuple[str, str, str]:
    base = f"breaker:{name}:{key}"
    return f"{base}:fails", f"{base}:open", f"{base}:tripped"


def check(name: str, key: str) -> None:
    _, opened, _ = _keys(name, key)
    try:
        client = get_redis()
        if client.exists(opened):
            ttl = client.ttl(opened)
            raise BreakerOpen(name, key, ttl if ttl and ttl > 0 else COOLDOWN)
    except redis.RedisError as exc:
        logger.warning("breaker %s:%s unguarded, redis unavailable: %s", name, key, exc)


def failed(
    name: str, key: str, *, threshold: int = FAILURES, window: int = WINDOW,
    cooldown: int = COOLDOWN,
) -> bool:
    fails, opened, tripped = _keys(name, key)
    try:
        client = get_redis()
        probing = bool(client.exists(tripped))
        count = client.incr(fails)
        if count == 1:
            client.expire(fails, window)
        if probing or count >= threshold:
            client.set(opened, "1", ex=cooldown)
            client.set(tripped, "1", ex=cooldown + window)
            client.delete(fails)
            logger.warning("breaker %s:%s opened after %s failures", name, key, count)
            return True
    except redis.RedisError as exc:
        logger.warning("breaker %s:%s could not count a failure: %s", name, key, exc)
    return False


def succeeded(name: str, key: str) -> None:
    fails, opened, tripped = _keys(name, key)
    try:
        get_redis().delete(fails, opened, tripped)
    except redis.RedisError as exc:
        logger.warning("breaker %s:%s could not reset: %s", name, key, exc)


def is_open(name: str, key: str) -> bool:
    try:
        check(name, key)
    except BreakerOpen:
        return True
    return False


@contextmanager
def guard(name: str, key: str, *, answers: tuple[type[BaseException], ...] = ()):
    check(name, key)
    try:
        yield
    except BreakerOpen:
        raise
    except answers:
        succeeded(name, key)
        raise
    except Exception:
        failed(name, key)
        raise
    else:
        succeeded(name, key)
