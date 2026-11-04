from __future__ import annotations

import hashlib
import json
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.database import SessionLocal
from app.video.jobs import job
from app.video.live import cloudflare, service
from app.video.models.commerce import ProviderEvent
from app.video.models.media import LiveStream
from app.video.sessions import platform_session

RAIL = "cloudflare-live"


def record(body: bytes, kind: str, verified: bool) -> int | None:
    try:
        data = json.loads(body) if verified else {}
    except ValueError:
        data, verified = {}, False
    if verified and kind == "notify":
        d = data.get("data") or {}
        event_id = f"{d.get('input_id')}:{d.get('event_type')}:{d.get('updated_at') or data.get('ts')}"
        event_type = d.get("event_type") or "unknown"
    elif verified:
        event_id = f"video:{data.get('uid')}:{(data.get('status') or {}).get('state')}"
        event_type = f"video.{(data.get('status') or {}).get('state') or 'unknown'}"
    else:
        event_id, event_type = f"unverified:{hashlib.sha256(body).hexdigest()}", "unverified"
    db = SessionLocal()
    try:
        ev = ProviderEvent(rail=RAIL, event_id=event_id[:200], event_type=event_type[:60],
                           body=body.decode("utf-8", "replace"), signature_ok=verified)
        db.add(ev)
        db.commit()
        return ev.id if verified else None
    except IntegrityError:
        db.rollback()
        return None
    finally:
        db.close()


def _stream(db, input_id: str | None) -> LiveStream | None:
    if not input_id:
        return None
    return db.execute(select(LiveStream).where(LiveStream.provider == "cloudflare",
                                               LiveStream.provider_ref == input_id)).scalars().first()


@job
def process_event(event_id: int) -> None:
    events: list[tuple[LiveStream, dict]] = []
    with platform_session() as db:
        ev = db.get(ProviderEvent, event_id)
        if ev is None or ev.processed_at is not None or not ev.signature_ok:
            return
        data = json.loads(ev.body)
        if ev.event_type.startswith("video."):
            s = _stream(db, data.get("liveInput"))
            if s is not None and s.replay_enabled and data.get("readyToStream") and not s.replay_ref:
                s.replay_ref = data.get("uid")
        else:
            d = data.get("data") or {}
            s = _stream(db, d.get("input_id"))
            kind = d.get("event_type")
            if s is not None and kind == "live_input.connected" and s.status in service.ACTIVE:
                if s.status != "live":
                    s.status, s.started_at = "live", service.now()
                    from app.video.after_commit import later
                    from app.video.services.push import notify_followers_live

                    later(db, notify_followers_live, s.id)
                    events.append((s, {"type": "live"}))
                s.last_seen_at = None
            elif s is not None and kind in ("live_input.disconnected", "live_input.errored") and s.status == "live":
                s.last_seen_at = service.now()
        ev.processed_at = service.now()
        ev.attempts += 1
        db.commit()
        _emit(events)


def _emit(events: list[tuple[LiveStream, dict]]) -> None:
    if events:
        from app.video.routers.live import emit

        for s, event in events:
            emit(s, event)


def sweep() -> None:
    events: list[tuple[LiveStream, dict]] = []
    with platform_session() as db:
        cutoff = service.now() - timedelta(seconds=settings.LIVE_IDLE_END_SECONDS)
        for s in db.execute(select(LiveStream).where(LiveStream.provider == "cloudflare", LiveStream.status == "live",
                                                     LiveStream.last_seen_at.is_not(None),
                                                     LiveStream.last_seen_at < cutoff)).scalars().all():
            service.end(db, s)
            events.append((s, {"type": "ended", "reason": "idle"}))
        db.commit()
        _emit(events)
        pending = db.execute(select(LiveStream.id).where(LiveStream.provider == "cloudflare",
                                                         LiveStream.status.in_(("ended", "failed")),
                                                         LiveStream.replay_ref.is_not(None),
                                                         LiveStream.replay_video_id.is_(None),
                                                         LiveStream.error.is_(None))).scalars().all()
    for sid in pending:
        import_replay(sid)


def import_replay(stream_id: int) -> str:
    from app.video.commerce import quotas
    from app.video.media import service as media
    from app.video.media.providers import provider
    from app.video.models.social import Channel

    with platform_session() as db:
        s = db.get(LiveStream, stream_id)
        if s is None or s.replay_video_id or not s.replay_ref or not s.replay_enabled:
            return "skipped"
        try:
            state, url = cloudflare.download(s.replay_ref)
        except cloudflare.CloudflareLiveError as exc:
            s.error = f"replay: {exc}"[:500]
            db.commit()
            return "failed"
        if state == "error":
            s.error = "replay: Cloudflare could not prepare the recording"
            db.commit()
            return "failed"
        if not url:
            return "waiting"
        try:
            owner = quotas.owner_user_id(db, s.tenant_id)
            video = media.create_video(db, channel=db.get(Channel, s.channel_id), user_id=owner or 0,
                                       title=f"{s.title} (live replay)", description=s.description,
                                       visibility="public", rights_declared=True)
            if s.members_rank:
                video.access, video.members_rank = "members", s.members_rank
            db.flush()
            prov = provider(video.provider)
            video.provider_video_id = prov.ingest_url(video, url)
            video.status = "processing"
            s.replay_video_id = video.id
            db.commit()
        except Exception as exc:
            db.rollback()
            s = db.get(LiveStream, stream_id)
            s.error = f"replay: {type(exc).__name__}: {exc}"[:500]
            db.commit()
            return "failed"
        if prov.name == "sandbox":
            from app.video.pipeline.jobs import sandbox_encode

            sandbox_encode.enqueue(video.id)
        return "imported"
