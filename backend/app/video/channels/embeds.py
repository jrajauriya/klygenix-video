from __future__ import annotations

import re

YOUTUBE = re.compile(r"(?:youtube\.com/(?:watch\?v=|shorts/|embed/)|youtu\.be/)([\w-]{11})")
BILIBILI = re.compile(r"bilibili\.com/video/(BV[\w]{10})")


def parse_url(url: str) -> tuple[str, str] | None:
    if m := YOUTUBE.search(url or ""):
        return "youtube", m.group(1)
    if m := BILIBILI.search(url or ""):
        return "bilibili", m.group(1)
    return None


def canonical_url(platform: str, external_id: str) -> str:
    if platform == "youtube":
        return f"https://www.youtube.com/watch?v={external_id}"
    return f"https://www.bilibili.com/video/{external_id}"


def embed_player(video) -> dict | None:
    if video.status != "published":
        return None
    if video.embed_platform == "youtube":
        return {"type": "youtube", "video_id": video.embed_external_id,
                "url": f"https://www.youtube-nocookie.com/embed/{video.embed_external_id}?enablejsapi=1&rel=0",
                "source_url": canonical_url("youtube", video.embed_external_id), "credit": "YouTube",
                "overlay_allowed": False}
    return {"type": "bilibili", "video_id": video.embed_external_id,
            "url": f"https://player.bilibili.com/player.html?bvid={video.embed_external_id}&autoplay=0",
            "source_url": canonical_url("bilibili", video.embed_external_id), "credit": "Bilibili",
            "overlay_allowed": False}


def embed_thumbnail(video) -> str | None:
    if video.embed_platform == "youtube":
        return f"https://i.ytimg.com/vi/{video.embed_external_id}/hqdefault.jpg"
    return None
