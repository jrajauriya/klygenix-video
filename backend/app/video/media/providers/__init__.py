from __future__ import annotations

from app.config import settings


def provider(name: str | None = None):
    chosen = name or settings.VIDEO_PROVIDER
    if chosen == "bunny":
        from app.video.media.providers.bunny import BunnyProvider

        return BunnyProvider()
    from app.video.media.providers.sandbox import SandboxProvider

    return SandboxProvider()
