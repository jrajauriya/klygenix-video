from __future__ import annotations

import base64
import hashlib
import json
import time
from urllib.parse import quote

import httpx

from app.config import settings
from app.video.media.providers.base import MediaEvent, UploadTicket

TIMEOUT = httpx.Timeout(30.0, connect=10.0)
STATUS = {3: "encoded", 4: "encoded", 5: "failed", 6: "failed"}


class BunnyError(Exception):
    pass


class BunnyProvider:
    name = "bunny"

    def __init__(self) -> None:
        if not (settings.BUNNY_LIBRARY_ID and settings.BUNNY_API_KEY and settings.BUNNY_CDN_HOST):
            raise BunnyError("Bunny Stream is not configured.")
        self.lib = settings.BUNNY_LIBRARY_ID
        self.key = settings.BUNNY_API_KEY
        self.cdn = settings.BUNNY_CDN_HOST.rstrip("/")

    def _api(self, method: str, path: str, **kw) -> dict:
        from app.core.breaker import guard

        with guard("bunny", self.lib):
            resp = httpx.request(method, f"{settings.BUNNY_API_BASE}/library/{self.lib}{path}",
                                 headers={"AccessKey": self.key, "accept": "application/json"}, timeout=TIMEOUT, **kw)
        if resp.status_code >= 400:
            raise BunnyError(f"Bunny refused: {resp.status_code} {resp.text[:200]}")
        return resp.json() if resp.content else {}

    def create_upload(self, video, filename: str) -> UploadTicket:
        guid = self._api("POST", "/videos", json={"title": video.title[:200]})["guid"]
        exp = int(time.time()) + 6 * 3600
        signature = hashlib.sha256(f"{self.lib}{self.key}{exp}{guid}".encode()).hexdigest()
        return UploadTicket(
            protocol="tus", method="POST", url="https://video.bunnycdn.com/tusupload",
            headers={"AuthorizationSignature": signature, "AuthorizationExpire": str(exp), "VideoId": guid,
                     "LibraryId": str(self.lib)},
            provider_video_id=guid, expires_at=exp,
        )

    def verify_webhook(self, body: bytes, headers: dict, query: dict) -> bool:
        secret = settings.BUNNY_WEBHOOK_SECRET
        return bool(secret) and hashlib.sha256((query.get("secret") or "").encode()).digest() == hashlib.sha256(secret.encode()).digest()

    def parse_webhook(self, body: bytes) -> list[MediaEvent]:
        data = json.loads(body)
        status = int(data.get("Status", -1))
        kind = STATUS.get(status)
        if kind is None:
            return []
        guid = data.get("VideoGuid", "")
        if kind == "encoded":
            info = self.describe(guid)
            return [MediaEvent(event_id=f"{guid}:{status}", provider_video_id=guid, kind=kind,
                               duration_ms=info.duration_ms, width=info.width, height=info.height)]
        return [MediaEvent(event_id=f"{guid}:{status}", provider_video_id=guid, kind=kind)]

    def describe(self, provider_video_id: str) -> MediaEvent:
        data = self._api("GET", f"/videos/{provider_video_id}")
        return MediaEvent(event_id="", provider_video_id=provider_video_id, kind="describe",
                          duration_ms=int(float(data.get("length") or 0) * 1000), width=int(data.get("width") or 0),
                          height=int(data.get("height") or 0))

    def _signed(self, path: str, ttl: int, token_path: str) -> str:
        exp = int(time.time()) + ttl
        raw = hashlib.sha256(f"{settings.BUNNY_TOKEN_KEY}{token_path}{exp}token_path={token_path}".encode()).digest()
        token = base64.urlsafe_b64encode(raw).decode().rstrip("=")
        return f"https://{self.cdn}/bcdn_token={token}&expires={exp}&token_path={quote(token_path, safe='')}{path}"

    def preview(self, video, ttl: int, seconds: int) -> dict | None:
        return None

    def playback(self, video, ttl: int) -> dict:
        guid = video.provider_video_id
        if not settings.BUNNY_TOKEN_KEY:
            return {"type": "hls", "url": f"https://{self.cdn}/{guid}/playlist.m3u8", "expires_at": 0}
        return {"type": "hls", "url": self._signed(f"/{guid}/playlist.m3u8", ttl, f"/{guid}/"),
                "expires_at": int(time.time()) + ttl}

    def thumbnail_url(self, video, ttl: int) -> str | None:
        guid = video.provider_video_id
        if not settings.BUNNY_TOKEN_KEY:
            return f"https://{self.cdn}/{guid}/thumbnail.jpg"
        return self._signed(f"/{guid}/thumbnail.jpg", ttl, f"/{guid}/")

    def fetch_source(self, video, dst: str) -> str:
        guid = video.provider_video_id
        url = self._signed(f"/{guid}/play_720p.mp4", 3600, f"/{guid}/") if settings.BUNNY_TOKEN_KEY else f"https://{self.cdn}/{guid}/play_720p.mp4"
        with httpx.stream("GET", url, timeout=httpx.Timeout(600.0, connect=10.0)) as resp:
            if resp.status_code >= 400:
                raise BunnyError("The MP4 fallback is not available; enable it in the Bunny library.")
            with open(dst, "wb") as fh:
                for chunk in resp.iter_bytes(1 << 20):
                    fh.write(chunk)
        return dst

    def ingest_file(self, video, path: str) -> str:
        guid = self._api("POST", "/videos", json={"title": video.title[:200]})["guid"]
        with open(path, "rb") as fh:
            self._api("PUT", f"/videos/{guid}", content=fh.read())
        return guid

    def ingest_url(self, video, url: str) -> str:
        made = self._api("POST", "/videos/fetch", json={"url": url, "title": video.title[:200]})
        guid = made.get("id") or made.get("guid")
        if not guid:
            raise BunnyError("Bunny accepted the fetch but returned no video id.")
        return guid

    def delete(self, video) -> None:
        if video.provider_video_id:
            self._api("DELETE", f"/videos/{video.provider_video_id}")
