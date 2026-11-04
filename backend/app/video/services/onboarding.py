from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.models.user import User
from app.video.models.media import Video
from app.video.models.payouts import PayoutAccount
from app.video.models.social import Channel
from app.video.models.studio import Clip

STEPS = (("upload", 0, "onboarding_upload", "/videos"), ("clip", 2, "onboarding_clip", "/clips"),
         ("payouts", 7, "onboarding_payouts", "/earnings"))
WINDOW_DAYS = 14


def _done(db: Session, step: str, tenant_id: int) -> bool | None:
    if step == "upload":
        return bool(db.execute(select(Video.id).where(Video.tenant_id == tenant_id, Video.is_deleted.is_(False))).first())
    if step == "clip":
        if not db.execute(select(Video.id).where(Video.tenant_id == tenant_id, Video.is_deleted.is_(False))).first():
            return None
        return bool(db.execute(select(Clip.id).where(Clip.tenant_id == tenant_id)).first())
    return bool(db.execute(select(PayoutAccount.id).where(PayoutAccount.tenant_id == tenant_id)).first())


def drip(db: Session, now: datetime | None = None) -> dict:
    from app.core.services import mailer

    now = now or datetime.now(timezone.utc)
    out = {"sent": 0, "skipped": 0}
    rows = db.execute(select(User, Channel).join(Channel, Channel.tenant_id == User.tenant_id)
                      .where(Channel.created_at >= now - timedelta(days=WINDOW_DAYS), User.is_active.is_(True),
                             User.role != "global_admin")).all()
    for user, channel in rows:
        s = dict(user.settings or {})
        if s.get("onboarding_mails") is False:
            continue
        sent = dict(s.get("onboarding_sent") or {})
        age = now - channel.created_at
        changed = False
        for step, day, template, path in STEPS:
            if step in sent or age < timedelta(days=day):
                continue
            done = _done(db, step, channel.tenant_id)
            if done is None:
                continue
            if done:
                sent[step], changed = "done", True
                out["skipped"] += 1
                continue
            lang = s.get("language") if s.get("language") in ("en", "hi") else "en"
            mailer.send(db, template, user.email, {"name": user.name, "channel": channel.name,
                                                   "link": f"{settings.STUDIO_APP_URL}{path}"}, lang, tenant_id=channel.tenant_id)
            sent[step], changed = now.isoformat(), True
            out["sent"] += 1
            break
        if changed:
            user.settings = {**s, "onboarding_sent": sent}
    db.flush()
    return out
