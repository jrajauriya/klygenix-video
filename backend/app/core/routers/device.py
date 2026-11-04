from __future__ import annotations

import hashlib
import json
import secrets
import time

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.core.middleware.auth import get_current_user
from app.core.models.user import User
from app.core.redis_client import get_redis
from app.core.schemas.auth import TokenResponse
from app.core.services.rate_limit import per_ip
from app.database import get_db

router = APIRouter(prefix="/api/auth/device", tags=["device-login"])
ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789"
TTL = 600
INTERVAL = 5


def _key(device_code: str) -> str:
    return "kv:device:" + hashlib.sha256(device_code.encode()).hexdigest()


def _norm(user_code: str) -> str:
    return user_code.strip().upper().replace("-", "").replace(" ", "")


class StartIn(BaseModel):
    client: str = Field(default="tv", max_length=20)
    name: str = Field(default="", max_length=60)


@router.post("/start")
def start(data: StartIn, request: Request):
    per_ip(request, "device-start", 30, 600, "Too many sign-in codes from here. Wait a few minutes.")
    r = get_redis()
    device_code = secrets.token_urlsafe(30)
    for _ in range(10):
        raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
        if r.set(f"kv:device:user:{raw}", _key(device_code), nx=True, ex=TTL):
            break
    else:
        raise err(503, "action_not_allowed")
    ua = (request.headers.get("user-agent") or "")[:200]
    name = data.name.strip() or _guess(ua, data.client)
    r.setex(_key(device_code), TTL, json.dumps({"user_code": raw, "status": "pending", "client": data.client[:20],
                                                "name": name[:60], "created": int(time.time()), "polled": 0}))
    code = f"{raw[:4]}-{raw[4:]}"
    base = settings.WEB_BASE_URL.rstrip("/")
    return {"device_code": device_code, "user_code": code, "verification_uri": f"{base}/activate",
            "verification_uri_complete": f"{base}/activate?code={code}", "expires_in": TTL, "interval": INTERVAL}


def _guess(ua: str, client: str) -> str:
    u = ua.lower()
    for key, label in (("tizen", "Samsung TV"), ("web0s", "LG TV"), ("webos", "LG TV"), ("aft", "Fire TV"), ("bravia", "Sony TV"),
                       ("android tv", "Android TV"), ("googletv", "Google TV"), ("crkey", "Chromecast"), ("appletv", "Apple TV"),
                       ("smarttv", "Smart TV"), ("macintosh", "Mac browser"), ("windows", "Windows browser"),
                       ("android", "Android device"), ("iphone", "iPhone")):
        if key in u:
            return label
    return "TV" if client == "tv" else client.title() or "Device"


def _by_user_code(user_code: str) -> tuple[str, dict]:
    r = get_redis()
    key = r.get(f"kv:device:user:{_norm(user_code)}")
    if not key:
        raise err(404, "device_code_invalid")
    key = key.decode() if isinstance(key, bytes) else key
    raw = r.get(key)
    if not raw:
        raise err(404, "device_code_invalid")
    return key, json.loads(raw)


class CodeIn(BaseModel):
    user_code: str = Field(min_length=8, max_length=12)


@router.get("/{user_code}")
def describe(user_code: str, user: User = Depends(get_current_user)):
    _, d = _by_user_code(user_code)
    from datetime import datetime, timezone

    return {"user_code": f"{d['user_code'][:4]}-{d['user_code'][4:]}", "client": d["client"], "status": d["status"],
            "name": d.get("name") or "TV", "requested_at": datetime.fromtimestamp(d["created"], timezone.utc).isoformat(),
            "expires_in": max(0, TTL - (int(time.time()) - d["created"]))}


def _decide(user_code: str, user: User, status: str) -> dict:
    r = get_redis()
    key, d = _by_user_code(user_code)
    if d["status"] != "pending":
        raise err(409, "device_code_used")
    d.update(status=status, user_id=user.id)
    ttl = r.ttl(key)
    r.setex(key, max(int(ttl), 30), json.dumps(d))
    return {"status": status}


@router.post("/approve")
def approve(data: CodeIn, user: User = Depends(get_current_user)):
    return _decide(data.user_code, user, "approved")


@router.post("/deny")
def deny(data: CodeIn, user: User = Depends(get_current_user)):
    return _decide(data.user_code, user, "denied")


class PollIn(BaseModel):
    device_code: str = Field(min_length=20, max_length=80)


@router.post("/poll", response_model=TokenResponse)
def poll(data: PollIn, request: Request, db: Session = Depends(get_db)):
    from app.core.routers.auth import _issue

    r = get_redis()
    key = _key(data.device_code)
    raw = r.get(key)
    if not raw:
        return JSONResponse({"error": "expired_token"}, status_code=400)
    d = json.loads(raw)
    now = int(time.time())
    if d["status"] == "pending":
        slow = now - d.get("polled", 0) < INTERVAL - 1
        d["polled"] = now
        r.setex(key, max(int(r.ttl(key)), 1), json.dumps(d))
        return JSONResponse({"error": "slow_down" if slow else "authorization_pending"}, status_code=400)
    r.delete(key, f"kv:device:user:{d['user_code']}")
    if d["status"] == "denied":
        return JSONResponse({"error": "access_denied"}, status_code=400)
    user = db.get(User, d["user_id"])
    if user is None or not user.is_active:
        return JSONResponse({"error": "access_denied"}, status_code=400)
    return _issue(db, user, request)
