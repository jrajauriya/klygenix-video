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
KINDS = ("render_ready", "published", "live", "membership")
DEFAULTS = {k: True for k in KINDS}


def prefs(user: User) -> dict:
    return {**DEFAULTS, **((user.settings or {}).get("notify") or {})}


def provider() -> str:
    return "expo" if settings.PUSH_PROVIDER == "expo" else "sandbox"


def _expo(tokens: list[str], title: str, body: str, data: dict) -> tuple[int, list[str], str | None]:
    sent, dead = 0, []
    for i in range(0, len(tokens), 100):
        batch = tokens[i:i + 100]
        r = httpx.post(EXPO, json=[{"to": t, "title": title, "body": body, "data": data, "sound": "default"} for t in batch],
                       headers={"Accept": "application/json", **({"Authorization": f"Bearer {settings.EXPO_ACCESS_TOKEN}"}
                                                              if settings.EXPO_ACCESS_TOKEN else {})}, timeout=20)
        if r.status_code >= 400:
            return sent, dead, f"Expo push refused: {r.status_code}"
        for t, ticket in zip(batch, r.json().get("data", [])):
            if ticket.get("status") == "ok":
                sent += 1
            elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                dead.append(t)
    return sent, dead, None


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
            sent, dead, error = _expo(tokens, msg.title, msg.body, msg.data)
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
