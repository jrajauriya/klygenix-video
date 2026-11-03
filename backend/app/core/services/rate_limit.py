"""Per-key rate limiting, on the counter shape `channels/quota.py` already uses.

**With one deliberate difference: this fails open.** A send quota fails closed because the
harm it prevents is chasing a customer for money too often, and a Redis outage that stops
sending costs nothing. A rate limiter that fails closed takes an integrator's production
down over a blip in ours, which is a much larger harm than letting a few extra requests
through for the minute Redis is away. Different failure, different default.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import HTTPException, Request, status

from app.core.redis_client import get_redis
from app.core.messages import err, refused

logger = logging.getLogger(__name__)

PER_MINUTE = 120
WINDOW_SECONDS = 60
WINDOW_TTL = 2 * WINDOW_SECONDS


def _key(tenant_id: int, key_id: int, now: datetime) -> str:
    return f"ratelimit:apikey:{tenant_id}:{key_id}:{int(now.timestamp()) // WINDOW_SECONDS}"


def claim(request: Request, *, tenant_id: int, key_id: int) -> None:
    """Count one request, refuse the one past the cap, and say when to come back."""
    now = datetime.now(timezone.utc)
    window_start = (int(now.timestamp()) // WINDOW_SECONDS) * WINDOW_SECONDS
    reset_in = window_start + WINDOW_SECONDS - int(now.timestamp())

    try:
        redis = get_redis()
        used = redis.incr(_key(tenant_id, key_id, now))
        if used == 1:
            redis.expire(_key(tenant_id, key_id, now), WINDOW_TTL)
    except Exception:
        logger.warning("rate limit unavailable; allowing", extra={"tenant_id": tenant_id})
        return

    request.state.rate_limit = (PER_MINUTE, max(0, PER_MINUTE - used), reset_in)

    if used > PER_MINUTE:
        raise err(status.HTTP_429_TOO_MANY_REQUESTS, "requests_minute_cap_one_key", headers={
                "Retry-After": str(reset_in),
                "X-RateLimit-Limit": str(PER_MINUTE),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(reset_in),
            }, PER_MINUTE=PER_MINUTE)


def set_limit_for_test(per_minute: int) -> None:
    global PER_MINUTE
    PER_MINUTE = per_minute


def allow(scope: str, limit: int, window_seconds: int = 3600) -> bool:
    try:
        redis = get_redis()
        key = f"ratelimit:{scope}:{int(datetime.now(timezone.utc).timestamp()) // window_seconds}"
        used = redis.incr(key)
        if used == 1:
            redis.expire(key, window_seconds * 2)
    except Exception:
        logger.warning("rate limit unavailable; allowing", extra={"scope": scope})
        return True
    return used <= limit


def client_ip(request: Request) -> str:
    import ipaddress

    peer = request.client.host if request.client else ""
    try:
        trusted = ipaddress.ip_address(peer).is_private or ipaddress.ip_address(peer).is_loopback
    except ValueError:
        trusted = False
    if trusted:
        forwarded = request.headers.get("x-real-ip") or (request.headers.get("x-forwarded-for") or "").split(",")[0]
        forwarded = forwarded.strip()
        if forwarded:
            return forwarded[:45]
    return peer[:45] or "?"


def _exempt(ip: str | None) -> bool:
    from app.config import settings

    if not ip or not settings.SANDBOX_ENABLED:
        return False
    return ip in {x.strip() for x in settings.RATE_LIMIT_EXEMPT_IPS.split(",") if x.strip()}


def limit(scope: str, per: int, window_seconds: int, *, message: str, ip: str | None = None) -> None:
    from app.config import settings

    if not settings.RATE_LIMITS_ENABLED or per <= 0 or _exempt(ip):
        return
    now = int(datetime.now(timezone.utc).timestamp())
    window = now // window_seconds
    retry = (window + 1) * window_seconds - now
    try:
        redis = get_redis()
        key = f"ratelimit:{scope}:{window}"
        used = redis.incr(key)
        if used == 1:
            redis.expire(key, window_seconds * 2)
    except Exception:
        logger.warning("rate limit unavailable; allowing", extra={"scope": scope})
        return
    if used > per:
        raise refused(status.HTTP_429_TOO_MANY_REQUESTS, message, headers={"Retry-After": str(max(1, retry))})


def per_ip(request: Request, name: str, per: int, window_seconds: int, message: str) -> None:
    ip = client_ip(request)
    limit(f"{name}:ip:{ip}", per, window_seconds, message=message, ip=ip)
