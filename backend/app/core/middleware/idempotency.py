"""Idempotency keys on money-moving writes."""

from __future__ import annotations

import json
import time
from typing import Any

import redis
from fastapi import Depends, Header, HTTPException, Request, status

from app.core.models.user import User
from app.core.middleware.auth import get_current_user
from app.core.redis_client import get_redis
from app.core.messages import err

# Outlasts any client's retry schedule without making a key permanent.
TTL_SECONDS = 24 * 60 * 60
IN_FLIGHT = "__in_flight__"
WAIT_SECONDS = 5.0
POLL_SECONDS = 0.1


def require_idempotency_key(
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
) -> str:
    """Refuse the request outright if the header is missing."""
    if len(idempotency_key) < 8 or len(idempotency_key) > 255:
        raise err(status.HTTP_400_BAD_REQUEST, "idempotency_key_must_between_8_255")
    return idempotency_key


class Idempotency:
    """Claim, replay or record one key. Scoped to a tenant and a route."""

    def __init__(self, key: str, scope: str) -> None:
        self.key = f"idem:{scope}:{key}"
        self._claimed = False

    def replay(self) -> Any | None:
        """The stored response, or None if this is the first time we have seen the key."""
        try:
            r = get_redis()
            # Claim it. NX makes this atomic: exactly one caller wins.
            if r.set(self.key, IN_FLIGHT, nx=True, ex=TTL_SECONDS):
                self._claimed = True
                return None

            deadline = time.monotonic() + WAIT_SECONDS
            while time.monotonic() < deadline:
                stored = r.get(self.key)
                if stored is None:
                    # The holder failed and released it; take it ourselves.
                    if r.set(self.key, IN_FLIGHT, nx=True, ex=TTL_SECONDS):
                        self._claimed = True
                        return None
                elif stored != IN_FLIGHT:
                    return json.loads(stored)
                time.sleep(POLL_SECONDS)

            raise err(status.HTTP_409_CONFLICT, "identical_request_still_being_processed_retry")
        except redis.RedisError:
            # Redis down: fail closed on a money write rather than risk a double.
            raise err(status.HTTP_503_SERVICE_UNAVAILABLE, "cannot_guarantee_request_runs_only_once") from None

    def record(self, response: Any) -> None:
        """Store the response so a retry replays it."""
        if not self._claimed:
            return
        try:
            get_redis().set(self.key, json.dumps(response, default=str), ex=TTL_SECONDS)
        except (redis.RedisError, TypeError):
            # A response we cannot serialise must not hold the key hostage.
            self.release()

    def release(self) -> None:
        """Drop the claim so a retry can proceed. Call this when the work failed."""
        if not self._claimed:
            return
        try:
            get_redis().delete(self.key)
        except redis.RedisError:
            pass


def idempotency(
    request: Request,
    key: str = Depends(require_idempotency_key),
    user: User = Depends(get_current_user),
) -> Idempotency:
    """Per-tenant, per-route scope: two tenants may reuse a key without colliding."""
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    return Idempotency(key, scope=f"{user.tenant_id}:{request.method}:{path}")
