from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.models.tenant import Tenant
from app.core.models.user import User
from app.video.models.media import Video
from app.video.models.social import Channel, Comment, Danmaku
from app.video.models.trust import ModerationAction, Report, Strike

STRIKE_DAYS = 90
SUSPEND_AT = 3


def now() -> datetime:
    return datetime.now(timezone.utc)


def system_user_id(db: Session) -> int:
    return db.execute(select(User.id).where(User.email == settings.GLOBAL_ADMIN_EMAIL)).scalar() or 0


def target_row(db: Session, target_type: str, target_id: int):
    from app.video.models.community import LiveMessage
    from app.video.models.media import LiveStream

    model = {"video": Video, "comment": Comment, "danmaku": Danmaku, "channel": Channel, "live": LiveStream,
             "live_message": LiveMessage}[target_type]
    return db.get(model, target_id)


def target_tenant(db: Session, target_type: str, target_id: int) -> int | None:
    row = target_row(db, target_type, target_id)
    return getattr(row, "tenant_id", None) if row is not None else None


def channel_for(db: Session, target_type: str, row) -> Channel | None:
    if target_type == "channel":
        return row
    if target_type in ("video", "live"):
        return db.get(Channel, row.channel_id)
    if target_type == "live_message":
        return None
    video = db.get(Video, row.video_id)
    return db.get(Channel, video.channel_id) if video else None


def _strike(db: Session, channel: Channel, action: ModerationAction, reason: str) -> None:
    db.add(Strike(tenant_id=channel.tenant_id, channel_id=channel.id, action_id=action.id, reason=reason,
                  expires_at=now() + timedelta(days=STRIKE_DAYS)))
    db.flush()
    live = db.execute(select(func.count(Strike.id)).where(
        Strike.channel_id == channel.id, Strike.lifted_at.is_(None), Strike.expires_at > now())).scalar() or 0
    channel.strike_count = live
    if live >= SUSPEND_AT and not channel.is_suspended:
        channel.is_suspended = True
        db.add(ModerationAction(tenant_id=channel.tenant_id, target_type="channel", target_id=channel.id,
                                action="suspend", reason=f"{live} active strikes", actor_user_id=action.actor_user_id))


def apply_action(db: Session, *, target_type: str, target_id: int, action: str, reason: str, actor_user_id: int,
                 report_id: int | None = None, takedown_id: int | None = None, strike: bool = False) -> ModerationAction:
    row = target_row(db, target_type, target_id)
    if row is None:
        raise LookupError("target")
    act = ModerationAction(tenant_id=row.tenant_id, target_type=target_type, target_id=target_id, action=action,
                           reason=reason, actor_user_id=actor_user_id, report_id=report_id, takedown_id=takedown_id)
    db.add(act)
    db.flush()
    if target_type == "video":
        if action in ("remove", "restrict"):
            row.status = "blocked"
            row.status_note = reason[:500]
        elif action in ("approve", "restore"):
            if row.status in ("in_review", "blocked"):
                row.status = "scanning"
                from app.video.media.service import publish_if_ready

                publish_if_ready(db, row)
            row.status_note = None
    elif target_type in ("comment", "danmaku"):
        if action in ("remove", "restrict"):
            row.status = "hidden"
        elif action in ("approve", "restore"):
            row.status = "visible"
    elif target_type == "live":
        if action in ("remove", "restrict") and row.status in ("scheduled", "live"):
            from app.video.live import service as live

            live.stop(db, row, reason)
    elif target_type == "live_message":
        if action in ("remove", "restrict") and row.status == "visible":
            from app.video.live import service as live

            live.hide_message(db, row, actor_user_id, "Removed by the platform")
        elif action in ("approve", "restore") and row.status == "hidden":
            row.status = "visible"
    elif target_type == "channel":
        if action == "suspend":
            row.is_suspended = True
        elif action in ("unsuspend", "restore"):
            row.is_suspended = False
    if strike and action in ("remove", "restrict"):
        channel = channel_for(db, target_type, row)
        if channel is not None:
            _strike(db, channel, act, reason)
    if report_id is None and action in ("remove", "restrict", "approve", "restore"):
        for r in db.execute(select(Report).where(Report.target_type == target_type, Report.target_id == target_id,
                                                 Report.status == "open")).scalars().all():
            r.status = "actioned" if action in ("remove", "restrict") else "dismissed"
            r.resolved_at = now()
            r.resolved_by = actor_user_id
    db.flush()
    return act


def auto_block(db: Session, video: Video, labels: list[str]) -> None:
    db.add(ModerationAction(tenant_id=video.tenant_id, target_type="video", target_id=video.id, action="remove",
                            reason="Automatic safety check: " + ", ".join(labels or ["blocked"]),
                            actor_user_id=system_user_id(db)))
    db.flush()


def admin_tenant_id(db: Session) -> int:
    return db.execute(select(Tenant.id).where(Tenant.slug == settings.ADMIN_TENANT_SLUG)).scalar()


def sla_table() -> dict[str, tuple[timedelta, timedelta]]:
    from app.config import settings

    out = {}
    for part in settings.TAKEDOWN_SLA_HOURS.split(","):
        kind, _, hours = part.strip().partition(":")
        ack, _, resolve = hours.partition("/")
        if kind and ack.isdigit() and resolve.isdigit():
            out[kind] = (timedelta(hours=int(ack)), timedelta(hours=int(resolve)))
    out.setdefault("other", (timedelta(hours=24), timedelta(days=15)))
    return out


def business_days_after(start: datetime, days: int) -> datetime:
    d, left = start, days
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            left -= 1
    return d


def owner_email(db: Session, tenant_id: int | None) -> tuple[str | None, str]:
    if not tenant_id:
        return None, "en"
    from app.video.commerce.quotas import owner_user_id

    uid = owner_user_id(db, tenant_id)
    u = db.get(User, uid) if uid else None
    if u is None:
        return None, "en"
    from app.video.models.social import Profile

    lang = db.execute(select(Profile.language).where(Profile.user_id == u.id)).scalar()
    return u.email, "hi" if lang == "hi" else "en"


def restore_countered(db: Session) -> int:
    from app.core.services import mailer
    from app.video.models.trust import Takedown

    n = 0
    for t in db.execute(select(Takedown).where(Takedown.status == "countered", Takedown.legal_action_at.is_(None),
                                               Takedown.restore_due_at <= now())).scalars().all():
        if t.video_id:
            apply_action(db, target_type="video", target_id=t.video_id, action="restore",
                         reason=f"Takedown {t.reference}: counter-notice period ended without a court action",
                         actor_user_id=system_user_id(db), takedown_id=t.id)
        t.status, t.resolved_at = "restored", now()
        v = db.get(Video, t.video_id) if t.video_id else None
        data = {"reference": t.reference, "title": v.title if v else t.target_url}
        mailer.send(db, "takedown_restored", t.complainant_email, data)
        to, lang = owner_email(db, t.target_tenant_id)
        if to:
            mailer.send(db, "takedown_restored", to, data, lang, tenant_id=t.target_tenant_id)
        n += 1
    db.flush()
    return n
