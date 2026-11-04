from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.models.user import User
from app.video.jobs import job
from app.video.models.social import Notification

DIGEST_KEY = "kv:digest:last_run"


def now() -> datetime:
    return datetime.now(timezone.utc)


def add(db: Session, user_id: int, kind: str, title: str, body: str = "", url: str | None = None, image: str | None = None,
        dedupe_key: str | None = None) -> Notification | None:
    user = db.get(User, user_id)
    if user is None:
        return None
    if dedupe_key and db.execute(select(Notification.id).where(Notification.dedupe_key == dedupe_key)).first():
        return None
    row = Notification(tenant_id=user.tenant_id, user_id=user_id, kind=kind[:20], title=title[:160], body=(body or "")[:300],
                       url=url, image=image, dedupe_key=dedupe_key)
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        return None
    return row


def unread(db: Session, user_id: int) -> int:
    return db.execute(select(func.count(Notification.id)).where(Notification.user_id == user_id,
                                                                Notification.read_at.is_(None))).scalar() or 0


def mark_read(db: Session, user_id: int, ids: list[int] | None) -> int:
    q = update(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    if ids:
        q = q.where(Notification.id.in_(ids))
    return db.execute(q.values(read_at=now())).rowcount


@job
def new_video(video_id: int) -> int:
    from app.video.media.service import thumb
    from app.video.models.media import Video
    from app.video.models.social import Channel, Follow
    from app.video.sessions import platform_session

    n = 0
    with platform_session() as db:
        v = db.get(Video, video_id)
        if v is None or v.status != "published" or v.visibility != "public":
            return 0
        ch = db.get(Channel, v.channel_id)
        for uid in db.execute(select(Follow.user_id).where(Follow.channel_id == v.channel_id).limit(20000)).scalars():
            if add(db, uid, "new_video", f"{ch.name} posted a new video", v.title, f"/watch/{v.public_id}", thumb(v),
                   f"newvideo:{v.id}:{uid}"):
                n += 1
        db.commit()
    return n


def frequency(user: User) -> str:
    f = (user.settings or {}).get("digest") or "weekly"
    return f if f in ("off", "daily", "weekly") else "weekly"


def digest(db: Session, at: datetime | None = None, force: str | None = None) -> int:
    from app.config import settings
    from app.core.redis_client import get_redis
    from app.core.services import mailer
    from app.video.clock import IST
    from app.video.models.social import Profile

    at = at or now()
    local = at.astimezone(IST)
    due = {"daily"} | ({"weekly"} if local.weekday() == 0 else set())
    if force:
        due = {force}
    users = db.execute(select(Notification.user_id).where(Notification.read_at.is_(None), Notification.digest_sent_at.is_(None),
                                                          Notification.created_at < at - timedelta(minutes=30))
                       .group_by(Notification.user_id).limit(5000)).scalars().all()
    sent = 0
    base = settings.WEB_BASE_URL.rstrip("/")
    for uid in users:
        user = db.get(User, uid)
        if user is None or not user.is_active or frequency(user) not in due:
            continue
        rows = db.execute(select(Notification).where(Notification.user_id == uid, Notification.read_at.is_(None),
                                                     Notification.digest_sent_at.is_(None))
                          .order_by(Notification.id.desc()).limit(10)).scalars().all()
        lang = db.execute(select(Profile.language).where(Profile.user_id == uid)).scalar()
        lines = "\n".join(f"• {r.title}" + (f" — {r.body}" if r.body else "") + (f"\n  {base}{r.url}" if r.url else "")
                          for r in rows)
        mailer.send(db, "digest", user.email, {"count": len(rows), "items": lines, "link": f"{base}/notifications"},
                    "hi" if lang == "hi" else "en", tenant_id=user.tenant_id)
        db.execute(update(Notification).where(Notification.user_id == uid, Notification.digest_sent_at.is_(None))
                   .values(digest_sent_at=at))
        sent += 1
    db.flush()
    try:
        get_redis().set(DIGEST_KEY, int(at.timestamp()))
    except Exception:
        pass
    return sent
