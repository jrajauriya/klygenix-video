from __future__ import annotations

import json
import os
import shutil
import secrets

from app.config import settings
from app.video.media.paths import video_dir
from app.video.media.providers.base import MediaEvent, UploadTicket
from app.video.media.signing import expiry, sign
from app.video.rails.sandbox import sign as hook_sign


class SandboxProvider:
    name = "sandbox"

    def _base(self) -> str:
        return settings.API_PUBLIC_BASE_URL.rstrip("/") + "/api/video/sandbox"

    def create_upload(self, video, filename: str) -> UploadTicket:
        exp = expiry(6 * 3600)
        sig = sign("upload", video.id, exp)
        return UploadTicket(
            protocol="put", method="PUT", url=f"{self._base()}/upload/{video.id}/{exp}/{sig}",
            headers={"Content-Type": "application/octet-stream"}, provider_video_id=f"sbx-{video.id}",
            expires_at=exp,
        )

    def event_body(self, kind: str, provider_video_id: str, **fields) -> bytes:
        payload = {"id": f"sbxv_{secrets.token_hex(8)}", "event": kind, "video": provider_video_id, **fields}
        return json.dumps(payload, separators=(",", ":")).encode()

    def signature(self, body: bytes) -> str:
        return hook_sign(body)

    def verify_webhook(self, body: bytes, headers: dict, query: dict) -> bool:
        sig = headers.get("x-sandbox-signature") or ""
        return bool(sig) and secrets.compare_digest(hook_sign(body), sig)

    def parse_webhook(self, body: bytes) -> list[MediaEvent]:
        data = json.loads(body)
        return [MediaEvent(
            event_id=data["id"], provider_video_id=data["video"], kind=data["event"],
            duration_ms=int(data.get("duration_ms") or 0), width=int(data.get("width") or 0),
            height=int(data.get("height") or 0), detail=data.get("detail") or "",
        )]

    def describe(self, provider_video_id: str) -> MediaEvent:
        vid = int(provider_video_id.split("-", 1)[1])
        meta = os.path.join(video_dir(vid), "meta.json")
        data = json.load(open(meta)) if os.path.exists(meta) else {}
        return MediaEvent(event_id="", provider_video_id=provider_video_id, kind="describe",
                          duration_ms=int(data.get("duration_ms") or 0), width=int(data.get("width") or 0),
                          height=int(data.get("height") or 0))

    def playback(self, video, ttl: int) -> dict:
        exp = expiry(ttl)
        sig = sign("hls", video.id, exp)
        return {"type": "hls", "url": f"{self._base()}/hls/{video.id}/{exp}/{sig}/master.m3u8", "expires_at": exp}

    def download_url(self, video, ttl: int) -> str:
        exp = expiry(ttl)
        return f"{self._base()}/download/{video.id}/{exp}/{sign('dl', video.id, exp)}.mp4"

    def preview(self, video, ttl: int, seconds: int) -> dict | None:
        if seconds <= 0:
            return None
        exp = expiry(ttl)
        sig = sign("hlsp", video.id, seconds, exp)
        return {"type": "hls", "url": f"{self._base()}/hls-preview/{video.id}/{seconds}/{exp}/{sig}/master.m3u8",
                "expires_at": exp, "preview_seconds": seconds}

    def thumbnail_url(self, video, ttl: int) -> str | None:
        if not os.path.exists(os.path.join(video_dir(video.id), "thumb.jpg")):
            return None
        exp = expiry(ttl)
        return f"{self._base()}/thumb/{video.id}/{exp}/{sign('thumb', video.id, exp)}.jpg"

    def source_path(self, video) -> str:
        return os.path.join(video_dir(video.id), "source")

    def fetch_source(self, video, dst: str) -> str:
        shutil.copyfile(self.source_path(video), dst)
        return dst

    def ingest_file(self, video, path: str) -> str:
        shutil.copyfile(path, self.source_path(video))
        return f"sbx-{video.id}"

    def ingest_url(self, video, url: str) -> str:
        import httpx

        dst = self.source_path(video)
        with httpx.stream("GET", url, timeout=httpx.Timeout(600.0, connect=10.0), follow_redirects=True) as resp:
            if resp.status_code >= 400:
                raise RuntimeError(f"the recording could not be fetched: {resp.status_code}")
            with open(dst, "wb") as fh:
                for chunk in resp.iter_bytes(1 << 20):
                    fh.write(chunk)
        return f"sbx-{video.id}"

    def delete(self, video) -> None:
        shutil.rmtree(video_dir(video.id), ignore_errors=True)
