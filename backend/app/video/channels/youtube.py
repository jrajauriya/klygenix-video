from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.config import settings

AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
SCOPES = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl"
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))), "tests", "fixtures", "media")


class YouTubeError(Exception):
    pass


@dataclass
class Tokens:
    access_token: str
    refresh_token: str | None
    expires_at: datetime


@dataclass
class RemoteVideo:
    external_id: str
    title: str
    description: str
    duration_ms: int
    published_at: str | None


ISO = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def iso_ms(value: str) -> int:
    m = ISO.match(value or "")
    if not m:
        return 0
    h, mnt, s = (int(x or 0) for x in m.groups())
    return ((h * 60 + mnt) * 60 + s) * 1000


def sandbox() -> bool:
    return settings.YOUTUBE_PROVIDER == "sandbox" or not (settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def auth_url(state: str) -> str:
    if sandbox():
        return f"{settings.API_PUBLIC_BASE_URL.rstrip('/')}/api/video/channels/youtube/callback?" + urlencode(
            {"code": "sandbox", "state": state})
    return AUTH + "?" + urlencode({"client_id": settings.GOOGLE_CLIENT_ID, "redirect_uri": settings.YOUTUBE_OAUTH_REDIRECT,
                                   "response_type": "code", "scope": SCOPES, "access_type": "offline",
                                   "prompt": "consent", "include_granted_scopes": "true", "state": state})


def exchange(code: str) -> Tokens:
    if sandbox():
        return Tokens("sandbox-access", "sandbox-refresh", datetime.now(timezone.utc) + timedelta(hours=1))
    r = httpx.post(TOKEN, data={"code": code, "client_id": settings.GOOGLE_CLIENT_ID,
                                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                                "redirect_uri": settings.YOUTUBE_OAUTH_REDIRECT, "grant_type": "authorization_code"},
                   timeout=TIMEOUT)
    if r.status_code >= 400:
        raise YouTubeError(f"Google refused the sign-in: {r.text[:200]}")
    body = r.json()
    return Tokens(body["access_token"], body.get("refresh_token"),
                  datetime.now(timezone.utc) + timedelta(seconds=int(body.get("expires_in", 3600))))


def refresh(refresh_token: str) -> Tokens:
    if sandbox():
        return Tokens("sandbox-access", refresh_token, datetime.now(timezone.utc) + timedelta(hours=1))
    r = httpx.post(TOKEN, data={"refresh_token": refresh_token, "client_id": settings.GOOGLE_CLIENT_ID,
                                "client_secret": settings.GOOGLE_CLIENT_SECRET, "grant_type": "refresh_token"},
                   timeout=TIMEOUT)
    if r.status_code >= 400:
        raise YouTubeError("The YouTube connection has expired; connect it again.")
    body = r.json()
    return Tokens(body["access_token"], refresh_token,
                  datetime.now(timezone.utc) + timedelta(seconds=int(body.get("expires_in", 3600))))


def _get(path: str, token: str, **params) -> dict:
    r = httpx.get(f"{settings.YOUTUBE_API_BASE}{path}", params=params, headers={"Authorization": f"Bearer {token}"},
                  timeout=TIMEOUT)
    if r.status_code >= 400:
        raise YouTubeError(f"YouTube refused: {r.status_code} {r.text[:200]}")
    return r.json()


SANDBOX_CHANNEL = ("UCkvSandboxChannel00001", "Sandbox YouTube channel")
SANDBOX_VIDEOS = [
    ("kvSandbox01", "azure-apim-auth", "Azure API Management authentication (YouTube copy)"),
    ("kvSandbox02", "dal-tadka", "Dal tadka at home (YouTube copy)"),
    ("kvSandbox03", "reel-three-tips", "Three tips to speak with confidence (YouTube copy)"),
]


def my_channel(token: str) -> tuple[str, str]:
    if sandbox():
        return SANDBOX_CHANNEL
    items = _get("/channels", token, part="snippet", mine="true").get("items") or []
    if not items:
        raise YouTubeError("This Google account has no YouTube channel.")
    return items[0]["id"], items[0]["snippet"]["title"]


def my_videos(token: str, limit: int = 50) -> list[RemoteVideo]:
    if sandbox():
        out = []
        for vid, fixture, title in SANDBOX_VIDEOS:
            import json

            meta = os.path.join(FIXTURES, f"{fixture}.json")
            dur = int(json.load(open(meta))["duration_s"] * 1000) if os.path.exists(meta) else 60_000
            out.append(RemoteVideo(vid, title, "Imported from the sandbox YouTube channel.", dur, None))
        return out
    ch = _get("/channels", token, part="contentDetails", mine="true").get("items") or []
    if not ch:
        return []
    uploads = ch[0]["contentDetails"]["relatedPlaylists"]["uploads"]
    items = _get("/playlistItems", token, part="contentDetails", playlistId=uploads, maxResults=min(limit, 50)).get("items") or []
    ids = [i["contentDetails"]["videoId"] for i in items]
    if not ids:
        return []
    vids = _get("/videos", token, part="snippet,contentDetails,status", id=",".join(ids)).get("items") or []
    out = []
    for v in vids:
        if (v.get("status") or {}).get("embeddable") is False:
            continue
        sn = v["snippet"]
        out.append(RemoteVideo(v["id"], sn.get("title", "")[:200], sn.get("description", ""),
                               iso_ms(v["contentDetails"].get("duration", "")), sn.get("publishedAt")))
    return out


def captions(token: str, external_id: str) -> tuple[str, str] | None:
    if sandbox():
        fixture = next((f for vid, f, _ in SANDBOX_VIDEOS if vid == external_id), None)
        path = os.path.join(FIXTURES, f"{fixture}.vtt") if fixture else ""
        return ("en", open(path).read()) if path and os.path.exists(path) else None
    tracks = _get("/captions", token, part="snippet", videoId=external_id).get("items") or []
    if not tracks:
        return None
    tracks.sort(key=lambda t: (t["snippet"].get("trackKind") == "asr", t["snippet"].get("isDraft", False)))
    track = tracks[0]
    r = httpx.get(f"{settings.YOUTUBE_API_BASE}/captions/{track['id']}", params={"tfmt": "vtt"},
                  headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT)
    if r.status_code >= 400:
        return None
    return (track["snippet"].get("language") or "en")[:8], r.text
