from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.core.services import secrets as sealed
from app.video.media.paths import media_root
from app.video.media.signing import expiry, sign
from app.video.models.media import LiveStream
from app.video.models.social import Channel

ACTIVE = ("scheduled", "live")


def now() -> datetime:
    return datetime.now(timezone.utc)


def ports() -> list[int]:
    lo, _, hi = settings.LIVE_RTMP_PORTS.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def live_dir(stream_id: int) -> str:
    path = os.path.join(media_root(), "live", str(stream_id))
    os.makedirs(path, exist_ok=True)
    return path


def _key() -> tuple[str, str, str]:
    raw = secrets.token_urlsafe(18)
    return raw, sealed.seal(raw), hashlib.sha256(raw.encode()).hexdigest()


def key_of(s: LiveStream) -> str:
    return sealed.resolve(s.stream_key)


def _free_port(db: Session) -> int:
    used = set(db.execute(select(LiveStream.ingest_port).where(LiveStream.status.in_(ACTIVE),
                                                                LiveStream.ingest_port.is_not(None))).scalars().all())
    for p in ports():
        if p not in used:
            return p
    raise err(409, "live_ports_busy")


def public_id(db: Session) -> str:
    while True:
        pid = "L" + secrets.token_urlsafe(8).replace("-", "x").replace("_", "y")[:10]
        if not db.execute(select(LiveStream.id).where(LiveStream.public_id == pid)).first():
            return pid


def create(db: Session, *, channel: Channel, title: str, description: str = "", scheduled_at: datetime | None = None,
           members_rank: int | None = None, replay_enabled: bool = True) -> LiveStream:
    if channel.is_suspended:
        raise err(403, "channel_cannot_take_money")
    if settings.LIVE_PROVIDER == "sandbox" and not settings.SANDBOX_ENABLED:
        raise err(409, "live_unavailable")
    if db.execute(select(LiveStream.id).where(LiveStream.channel_id == channel.id, LiveStream.status.in_(ACTIVE))).first():
        raise err(409, "live_already_open")
    raw, sealed_key, digest = _key()
    s = LiveStream(tenant_id=channel.tenant_id, channel_id=channel.id, public_id=public_id(db), title=title.strip()[:160],
                   description=description or "", status="scheduled", provider=settings.LIVE_PROVIDER,
                   ingest_port=_free_port(db) if settings.LIVE_PROVIDER == "sandbox" else None, stream_key=sealed_key,
                   stream_key_hash=digest, scheduled_at=scheduled_at, members_rank=members_rank,
                   replay_enabled=replay_enabled)
    db.add(s)
    db.flush()
    return s


def rotate_key(db: Session, s: LiveStream) -> None:
    if s.status == "live":
        raise err(409, "action_not_allowed")
    _, s.stream_key, s.stream_key_hash = _key()
    db.flush()


def ingest(s: LiveStream) -> dict:
    return {"protocol": "rtmp", "server": f"rtmp://{settings.LIVE_RTMP_HOST}:{s.ingest_port}/live",
            "stream_key": key_of(s), "browser": settings.LIVE_PROVIDER == "sandbox"}


def playback(s: LiveStream) -> dict | None:
    if s.status != "live" or s.provider != "sandbox":
        return None
    exp = expiry(4 * 3600) // 600 * 600
    base = settings.API_PUBLIC_BASE_URL.rstrip("/")
    return {"type": "hls", "live": True, "expires_at": exp,
            "url": f"{base}/api/video/sandbox/live/{s.id}/{exp}/{sign('live', s.id, exp)}/index.m3u8"}


def allowed(db: Session, user, s: LiveStream) -> bool:
    if not s.members_rank:
        return True
    if user is None:
        return False
    if user.tenant_id == s.tenant_id:
        return True
    from app.video.commerce.access import _rank

    return _rank(db, user.id, s.channel_id) >= s.members_rank


def end(db: Session, s: LiveStream) -> None:
    if s.status in ("ended", "failed"):
        return
    s.status = "ended"
    s.ended_at = now()
    try:
        from app.core.redis_client import get_redis

        s.peak_viewers = max(s.peak_viewers, int(get_redis().get(f"kv:live:{s.id}:peak") or 0))
    except Exception:
        pass
    db.flush()


def out(s: LiveStream, channel: Channel | None = None, viewers: int = 0) -> dict:
    from app.video.present import channel_card, iso

    return {"id": s.public_id, "title": s.title, "description": s.description, "status": s.status,
            "scheduled_at": iso(s.scheduled_at), "started_at": iso(s.started_at), "ended_at": iso(s.ended_at),
            "members_rank": s.members_rank, "slow_mode_seconds": s.slow_mode_seconds, "viewers": viewers,
            "peak_viewers": s.peak_viewers, "replay_enabled": s.replay_enabled,
            "channel": channel_card(channel) if channel is not None else None}
