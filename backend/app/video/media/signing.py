from __future__ import annotations

import hashlib
import hmac
import time

from app.config import settings


def sign(*parts: object) -> str:
    msg = ":".join(str(p) for p in parts).encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:32]


def valid(sig: str, *parts: object) -> bool:
    return hmac.compare_digest(sign(*parts), sig or "")


def expiry(ttl: int) -> int:
    return int(time.time()) + ttl


def alive(exp: int) -> bool:
    return int(exp) >= int(time.time())
