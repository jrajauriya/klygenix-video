"""Lesson video playback (§06, §22). Signed and short-lived when a provider is configured.

Bunny Stream's embed token is SHA256(token_key + video_id + expires) — documented behaviour;
the player refuses an expired or unsigned URL, and the library locks playback to our domains.
Without a provider, a lesson's reference is an embeddable URL (YouTube unlisted, Vimeo,
Loom or a plain MP4), which is fine in development and honest about being unprotected.
"""

from __future__ import annotations

import hashlib
import re
import time

from app.config import settings

YOUTUBE = re.compile(r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([\w-]{6,})")
VIMEO = re.compile(r"vimeo\.com/(?:video/)?(\d+)")
LOOM = re.compile(r"loom\.com/(?:share|embed)/(\w+)")


def playback(ref: str | None, *, ttl: int = 3 * 3600) -> dict | None:
    if not ref:
        return None
    if settings.VIDEO_PROVIDER == "bunny" and settings.VIDEO_LIBRARY_ID and not ref.startswith("http"):
        expires = int(time.time()) + ttl
        token = hashlib.sha256(f"{settings.VIDEO_TOKEN_KEY}{ref}{expires}".encode()).hexdigest()
        return {"type": "embed", "protected": True,
                "url": f"https://iframe.mediadelivery.net/embed/{settings.VIDEO_LIBRARY_ID}/{ref}?token={token}&expires={expires}"}
    if m := YOUTUBE.search(ref):
        return {"type": "embed", "protected": False, "url": f"https://www.youtube-nocookie.com/embed/{m.group(1)}"}
    if m := VIMEO.search(ref):
        return {"type": "embed", "protected": False, "url": f"https://player.vimeo.com/video/{m.group(1)}"}
    if m := LOOM.search(ref):
        return {"type": "embed", "protected": False, "url": f"https://www.loom.com/embed/{m.group(1)}"}
    return {"type": "file", "protected": False, "url": ref}
