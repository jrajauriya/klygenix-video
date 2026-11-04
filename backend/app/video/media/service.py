from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.video.media.providers import provider
from app.video.models.commerce import ProviderEvent
from app.video.models.media import Video
from app.video.models.social import Channel
from app.video.services.text import public_id

logger = logging.getLogger(__name__)


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_public_id(db: Session) -> str:
    while True:
        pid = public_id()
        if not db.execute(select(Video.id).where(Video.public_id == pid)).first():
            return pid


def create_video(db: Session, *, channel: Channel, user_id: int, title: str, description: str = "",
                 language: str = "en", visibility: str = "public", publish_at: datetime | None = None,
                 rights_declared: bool = False, ai_generated: bool = False, tags: list | None = None,
                 source: str = "upload", source_clip_id: int | None = None) -> Video:
    video = Video(
        tenant_id=channel.tenant_id, channel_id=channel.id, uploader_user_id=user_id, public_id=new_public_id(db),
        title=title.strip()[:200], description=description or "", language=language or "en",
        visibility="scheduled" if publish_at else visibility, publish_at=publish_at, rights_declared=rights_declared,
        ai_generated=ai_generated, tags=tags or [], source=source, source_clip_id=source_clip_id,
        provider=provider().name, status="uploading",
    )
    db.add(video)
    db.flush()
    return video


def upload_ticket(db: Session, video: Video, filename: str = "video.mp4") -> dict:
    ticket = provider(video.provider).create_upload(video, filename)
    video.provider_video_id = ticket.provider_video_id
    db.flush()
    return {"protocol": ticket.protocol, "url": ticket.url, "method": ticket.method, "headers": ticket.headers,
            "provider_video_id": ticket.provider_video_id, "expires_at": ticket.expires_at}


def ingest_event(rail: str, body: bytes, headers: dict, query: dict) -> list[int]:
    try:
        prov = provider(rail)
    except Exception:
        raise PermissionError("provider")
    ok = prov.verify_webhook(body, headers, query)
    events = prov.parse_webhook(body) if ok else []
    if not ok:
        import hashlib

        db = SessionLocal()
        try:
            db.add(ProviderEvent(rail=f"media:{rail}", event_id=f"unverified:{hashlib.sha256(body).hexdigest()}",
                                 event_type="unverified", body=body.decode("utf-8", "replace"), signature_ok=False))
            db.commit()
        except IntegrityError:
            db.rollback()
        finally:
            db.close()
        raise PermissionError("signature")
    filed: list[int] = []
    for ev in events:
        db = SessionLocal()
        try:
            row = ProviderEvent(rail=f"media:{rail}", event_id=ev.event_id, event_type=ev.kind,
                                body=body.decode("utf-8", "replace"), signature_ok=True)
            db.add(row)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                continue
            filed.append(row.id)
        finally:
            db.close()
    from app.video.pipeline.jobs import process_media_event

    for event_row in filed:
        process_media_event.enqueue(event_row)
    return filed


def apply_encoded(db: Session, video: Video, *, duration_ms: int, width: int, height: int) -> None:
    video.duration_ms = duration_ms
    video.width = width or video.width
    video.height = height or video.height
    vertical = bool(width and height and height > width)
    video.kind = "reel" if vertical and duration_ms <= settings.REEL_MAX_SECONDS * 1000 else "long"
    video.status = "scanning"


def publish_if_ready(db: Session, video: Video) -> None:
    if video.status != "scanning":
        return
    if video.visibility == "scheduled" and video.publish_at and video.publish_at > now():
        video.status = "published"
        return
    video.status = "published"
    video.published_at = video.published_at or now()
    if video.visibility == "scheduled":
        video.visibility = "public"
    if video.uploader_user_id:
        from app.video.after_commit import later
        from app.video.services.push import notify_job

        later(db, notify_job, video.uploader_user_id, "published", "Your video is live", video.title,
              {"url": f"/watch/{video.public_id}"}, f"published:{video.id}")
    if video.visibility == "public":
        from app.video.after_commit import later as _later
        from app.video.services.inbox import new_video

        _later(db, new_video, video.id)


def thumb(video: Video) -> str | None:
    if video.source == "embed":
        from app.video.channels.embeds import embed_thumbnail

        return embed_thumbnail(video)
    if video.status not in ("published", "scanning", "in_review") or not video.provider_video_id:
        return None
    if video.thumbnail_key:
        from app.video.services.images import public_url

        return public_url(video.thumbnail_key)
    try:
        return provider(video.provider).thumbnail_url(video, settings.PLAYBACK_TTL_SECONDS)
    except Exception:
        return None


def playback(video: Video) -> dict | None:
    if video.source == "embed":
        from app.video.channels.embeds import embed_player

        return embed_player(video)
    if video.status != "published" or not video.provider_video_id:
        return None
    return provider(video.provider).playback(video, settings.PLAYBACK_TTL_SECONDS)


def preview_playback(video: Video) -> dict | None:
    if video.source == "embed" or video.status != "published" or not video.provider_video_id:
        return None
    return provider(video.provider).preview(video, 3600, max(0, video.preview_seconds))


def write_meta(video_id: int, data: dict) -> None:
    from app.video.media.paths import video_dir

    with open(os.path.join(video_dir(video_id), "meta.json"), "w") as fh:
        json.dump(data, fh)
