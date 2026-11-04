from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class UploadTicket:
    protocol: str
    url: str
    method: str = "PUT"
    headers: dict = field(default_factory=dict)
    provider_video_id: str = ""
    expires_at: int = 0


@dataclass(frozen=True, slots=True)
class MediaEvent:
    event_id: str
    provider_video_id: str
    kind: str
    duration_ms: int = 0
    width: int = 0
    height: int = 0
    detail: str = ""


class VideoProvider(Protocol):
    name: str

    def create_upload(self, video, filename: str) -> UploadTicket: ...

    def verify_webhook(self, body: bytes, headers: dict, query: dict) -> bool: ...

    def parse_webhook(self, body: bytes) -> list[MediaEvent]: ...

    def describe(self, provider_video_id: str) -> MediaEvent: ...

    def playback(self, video, ttl: int) -> dict: ...

    def preview(self, video, ttl: int, seconds: int) -> dict | None: ...

    def thumbnail_url(self, video, ttl: int) -> str | None: ...

    def fetch_source(self, video, dst: str) -> str: ...

    def ingest_file(self, video, path: str) -> str: ...

    def ingest_url(self, video, url: str) -> str: ...

    def delete(self, video) -> None: ...
