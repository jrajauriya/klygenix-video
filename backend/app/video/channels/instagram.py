from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.config import settings

AUTH = "https://www.instagram.com/oauth/authorize"
TOKEN = "https://api.instagram.com/oauth/access_token"
GRAPH = "https://graph.instagram.com"
SCOPES = "instagram_business_basic,instagram_business_content_publish"
TIMEOUT = httpx.Timeout(20.0, connect=5.0)


class InstagramError(Exception):
    pass


@dataclass
class Account:
    user_id: str
    username: str
    access_token: str
    expires_at: datetime


def sandbox() -> bool:
    return settings.INSTAGRAM_PROVIDER == "sandbox" or not (settings.INSTAGRAM_APP_ID and settings.INSTAGRAM_APP_SECRET)


def redirect_uri() -> str:
    return f"{settings.API_PUBLIC_BASE_URL.rstrip('/')}/api/video/channels/instagram/callback"


def auth_url(state: str) -> str:
    if sandbox():
        return f"{redirect_uri()}?" + urlencode({"code": "sandbox", "state": state})
    return AUTH + "?" + urlencode({"client_id": settings.INSTAGRAM_APP_ID, "redirect_uri": redirect_uri(),
                                   "response_type": "code", "scope": SCOPES, "state": state})


def exchange(code: str, tenant_id: int) -> Account:
    if sandbox():
        return Account(f"ig-sandbox-{tenant_id}", f"sandbox_creator_{tenant_id}", "sandbox-ig-token",
                       datetime.now(timezone.utc) + timedelta(days=60))
    r = httpx.post(TOKEN, data={"client_id": settings.INSTAGRAM_APP_ID, "client_secret": settings.INSTAGRAM_APP_SECRET,
                                "grant_type": "authorization_code", "redirect_uri": redirect_uri(), "code": code},
                   timeout=TIMEOUT)
    if r.status_code >= 400:
        raise InstagramError(f"Instagram refused the code: {r.status_code}")
    short = r.json()
    r = httpx.get(f"{GRAPH}/access_token", params={"grant_type": "ig_exchange_token", "client_secret": settings.INSTAGRAM_APP_SECRET,
                                                   "access_token": short["access_token"]}, timeout=TIMEOUT)
    if r.status_code >= 400:
        raise InstagramError(f"Instagram refused the long-lived token: {r.status_code}")
    long = r.json()
    me = httpx.get(f"{GRAPH}/v21.0/me", params={"fields": "user_id,username", "access_token": long["access_token"]},
                   timeout=TIMEOUT).json()
    return Account(str(me.get("user_id") or short.get("user_id")), me.get("username", ""), long["access_token"],
                   datetime.now(timezone.utc) + timedelta(seconds=int(long.get("expires_in", 5_184_000))))


def refresh(token: str) -> tuple[str, datetime]:
    if sandbox():
        return token, datetime.now(timezone.utc) + timedelta(days=60)
    r = httpx.get(f"{GRAPH}/refresh_access_token", params={"grant_type": "ig_refresh_token", "access_token": token},
                  timeout=TIMEOUT)
    if r.status_code >= 400:
        raise InstagramError(f"Instagram refused the refresh: {r.status_code}")
    body = r.json()
    return body["access_token"], datetime.now(timezone.utc) + timedelta(seconds=int(body.get("expires_in", 5_184_000)))


def refresh_due(db, within_days: int = 10) -> dict:
    from sqlalchemy import select

    from app.core.services import secrets as sealed
    from app.video.models.social import ConnectedChannel

    now = datetime.now(timezone.utc)
    out = {"refreshed": 0, "expired": 0, "failed": 0}
    for cc in db.execute(select(ConnectedChannel).where(ConnectedChannel.platform == "instagram",
                                                        ConnectedChannel.status == "active",
                                                        ConnectedChannel.expires_at < now + timedelta(days=within_days))
                         ).scalars().all():
        if cc.expires_at <= now:
            cc.status = "expired"
            out["expired"] += 1
            continue
        try:
            token, expires = refresh(sealed.resolve(cc.access_token))
        except (InstagramError, httpx.HTTPError):
            out["failed"] += 1
            continue
        cc.access_token, cc.expires_at = sealed.seal(token), expires
        out["refreshed"] += 1
    db.flush()
    return out
