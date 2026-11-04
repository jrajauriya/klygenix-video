from __future__ import annotations

import logging

import httpx
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.core.models.user import User
from app.video.jobs import job
from app.video.models.social import DeviceToken, PushMessage

logger = logging.getLogger(__name__)
EXPO = "https://exp.host/--/api/v2/push/send"
RECEIPTS = "https://exp.host/--/api/v2/push/getReceipts"
KINDS = ("render_ready", "published", "live", "membership")
DEFAULTS = {k: True for k in KINDS}


def prefs(user: User) -> dict:
    return {**DEFAULTS, **((user.settings or {}).get("notify") or {})}


def provider() -> str:
    return "expo" if settings.PUSH_PROVIDER == "expo" else "sandbox"


def _headers() -> dict:
    return {"Accept": "application/json", **({"Authorization": f"Bearer {settings.EXPO_ACCESS_TOKEN}"}
                                            if settings.EXPO_ACCESS_TOKEN else {})}


def _expo(tokens: list[str], title: str, body: str, data: dict) -> tuple[int, list[str], str | None, dict]:
    sent, dead, tickets = 0, [], {}
    for i in range(0, len(tokens), 100):
        batch = tokens[i:i + 100]
        r = httpx.post(EXPO, json=[{"to": t, "title": title, "body": body, "data": data, "sound": "default"} for t in batch],
                       headers=_headers(), timeout=20)
        if r.status_code >= 400:
            return sent, dead, f"Expo push refused: {r.status_code}", tickets
        for t, ticket in zip(batch, r.json().get("data", [])):
            if ticket.get("status") == "ok":
                sent += 1
                if ticket.get("id"):
                    tickets[ticket["id"]] = t
            elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                dead.append(t)
    return sent, dead, None, tickets


def notify(db: Session, user_id: int, kind: str, title: str, body: str, data: dict | None = None,
           dedupe_key: str | None = None) -> PushMessage | None:
    user = db.get(User, user_id)
    if user is None:
        return None
    if dedupe_key and db.execute(select(PushMessage.id).where(PushMessage.dedupe_key == dedupe_key)).first():
        return None
    tokens = [t.token for t in db.execute(select(DeviceToken).where(DeviceToken.user_id == user_id)).scalars()]
    msg = PushMessage(tenant_id=user.tenant_id, user_id=user_id, kind=kind, title=title[:120], body=body[:300],
                      data=data or {}, dedupe_key=dedupe_key, provider=provider(), status="sent", tokens=len(tokens))
    if not prefs(user).get(kind, True):
        msg.status, msg.error = "skipped", "turned off by the user"
    elif not tokens:
        msg.status, msg.error = "skipped", "no device"
    elif provider() == "expo":
        try:
            sent, dead, error, tickets = _expo(tokens, msg.title, msg.body, msg.data)
            msg.tickets = tickets or None
            if dead:
                db.execute(delete(DeviceToken).where(DeviceToken.token.in_(dead)))
            msg.status, msg.error = ("failed", error) if error or not sent else ("sent", None)
        except httpx.HTTPError as exc:
            msg.status, msg.error = "failed", str(exc)[:300]
    try:
        with db.begin_nested():
            db.add(msg)
            db.flush()
    except IntegrityError:
        return None
    return msg


@job
def notify_job(user_id: int, kind: str, title: str, body: str, data: dict | None = None, dedupe_key: str | None = None) -> None:
    from app.video.sessions import platform_session

    with platform_session() as db:
        notify(db, user_id, kind, title, body, data, dedupe_key)
        db.commit()


@job
def notify_followers_live(stream_id: int) -> int:
    from app.video.models.media import LiveStream
    from app.video.models.social import Channel, Follow
    from app.video.sessions import platform_session

    n = 0
    with platform_session() as db:
        s = db.get(LiveStream, stream_id)
        if s is None or s.status != "live":
            return 0
        ch = db.get(Channel, s.channel_id)
        for uid in db.execute(select(Follow.user_id).where(Follow.channel_id == s.channel_id).limit(5000)).scalars():
            if notify(db, uid, "live", f"{ch.name} is live", s.title, {"url": f"/live/{s.public_id}"},
                      dedupe_key=f"live:{s.id}:{uid}"):
                n += 1
        db.commit()
    return n


def check_receipts(db: Session, older_than_minutes: int = 15) -> int:
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
    rows = db.execute(select(PushMessage).where(PushMessage.provider == "expo", PushMessage.tickets.is_not(None),
                                                PushMessage.receipts_checked_at.is_(None),
                                                PushMessage.created_at < cutoff).limit(300)).scalars().all()
    dead: set[str] = set()
    for m in rows:
        ids = list((m.tickets or {}).keys())
        try:
            r = httpx.post(RECEIPTS, json={"ids": ids}, headers=_headers(), timeout=20)
        except httpx.HTTPError:
            continue
        if r.status_code >= 400:
            continue
        failed = 0
        for tid, receipt in (r.json().get("data") or {}).items():
            if receipt.get("status") == "error":
                failed += 1
                if (receipt.get("details") or {}).get("error") == "DeviceNotRegistered" and tid in m.tickets:
                    dead.add(m.tickets[tid])
        if failed:
            m.error = f"{failed} of {len(ids)} deliveries failed at Apple or Google"
        m.receipts_checked_at = datetime.now(timezone.utc)
    if dead:
        db.execute(delete(DeviceToken).where(DeviceToken.token.in_(dead)))
    db.flush()
    return len(rows)
