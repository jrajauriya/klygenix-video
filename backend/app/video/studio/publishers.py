from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from app.config import settings

TIMEOUT = httpx.Timeout(600.0, connect=10.0)
UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos"
GRAPH = "https://graph.instagram.com/v21.0"


class PublishError(Exception):
    pass


@dataclass
class Published:
    external_id: str
    external_url: str | None


class SandboxPublisher:
    def __init__(self, platform: str) -> None:
        self.platform = platform

    def publish(self, *, tenant_id: int, path: str, title: str, caption: str, public_url: str | None) -> Published:
        return Published(f"sbx-{self.platform}-{int(time.time() * 1000)}", None)


class YouTubeShorts:
    platform = "youtube"

    def publish(self, *, tenant_id: int, path: str, title: str, caption: str, public_url: str | None) -> Published:
        token = _youtube_token(tenant_id)
        name = title if "#shorts" in title.lower() else f"{title[:90]} #Shorts"
        meta = {"snippet": {"title": name[:100], "description": caption[:4900], "categoryId": "22"},
                "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False}}
        start = httpx.post(UPLOAD, params={"uploadType": "resumable", "part": "snippet,status"}, json=meta,
                           headers={"Authorization": f"Bearer {token}", "X-Upload-Content-Type": "video/mp4"}, timeout=TIMEOUT)
        if start.status_code >= 400 or "location" not in start.headers:
            raise PublishError(f"YouTube refused the upload: {start.text[:200]}")
        with open(path, "rb") as fh:
            done = httpx.put(start.headers["location"], content=fh.read(), headers={"Content-Type": "video/mp4"}, timeout=TIMEOUT)
        if done.status_code >= 400:
            raise PublishError(f"YouTube upload failed: {done.text[:200]}")
        vid = done.json()["id"]
        return Published(vid, f"https://www.youtube.com/shorts/{vid}")


class InstagramReels:
    platform = "instagram"

    def publish(self, *, tenant_id: int, path: str, title: str, caption: str, public_url: str | None) -> Published:
        account, token = _instagram_account(tenant_id)
        if not public_url:
            raise PublishError("Instagram fetches the video from a public URL; none is available.")
        made = httpx.post(f"{GRAPH}/{account}/media", data={"media_type": "REELS", "video_url": public_url,
                                                           "caption": caption[:2200], "access_token": token}, timeout=TIMEOUT)
        if made.status_code >= 400:
            raise PublishError(f"Instagram refused the reel: {made.text[:200]}")
        container = made.json()["id"]
        for _ in range(60):
            st = httpx.get(f"{GRAPH}/{container}", params={"fields": "status_code", "access_token": token}, timeout=TIMEOUT).json()
            if st.get("status_code") == "FINISHED":
                break
            if st.get("status_code") == "ERROR":
                raise PublishError("Instagram could not process the reel.")
            time.sleep(5)
        pub = httpx.post(f"{GRAPH}/{account}/media_publish", data={"creation_id": container, "access_token": token},
                         timeout=TIMEOUT)
        if pub.status_code >= 400:
            raise PublishError(f"Instagram did not publish the reel: {pub.text[:200]}")
        return Published(pub.json()["id"], None)


def _youtube_token(tenant_id: int) -> str:
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.core.services import secrets as sealed
    from app.video.channels import youtube
    from app.video.models.social import ConnectedChannel
    from app.video.sessions import platform_session

    with platform_session() as db:
        cc = db.execute(select(ConnectedChannel).where(ConnectedChannel.tenant_id == tenant_id,
                                                       ConnectedChannel.platform == "youtube",
                                                       ConnectedChannel.status == "active")).scalars().first()
        if cc is None or not cc.refresh_token:
            raise PublishError("Connect your YouTube channel first.")
        if cc.expires_at and cc.expires_at > datetime.now(timezone.utc) and cc.access_token:
            return sealed.resolve(cc.access_token)
        tokens = youtube.refresh(sealed.resolve(cc.refresh_token))
        cc.access_token, cc.expires_at = sealed.seal(tokens.access_token), tokens.expires_at
        db.commit()
        return tokens.access_token


def _instagram_account(tenant_id: int) -> tuple[str, str]:
    from sqlalchemy import select

    from app.core.services import secrets as sealed
    from app.video.models.social import ConnectedChannel
    from app.video.sessions import platform_session

    with platform_session() as db:
        cc = db.execute(select(ConnectedChannel).where(ConnectedChannel.tenant_id == tenant_id,
                                                       ConnectedChannel.platform == "instagram",
                                                       ConnectedChannel.status == "active")).scalars().first()
        if cc is None or not cc.access_token:
            raise PublishError("Connect your Instagram professional account first.")
        return cc.external_channel_id, sealed.resolve(cc.access_token)


def publisher(platform: str):
    if settings.PUBLISH_PROVIDER == "sandbox":
        return SandboxPublisher(platform)
    if platform == "youtube":
        return YouTubeShorts()
    if platform == "instagram":
        return InstagramReels()
    raise PublishError(f"Unknown platform {platform}")
