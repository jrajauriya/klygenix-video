from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.messages import err
from app.core.models.user import User
from app.video.models.commerce import Entitlement, Plan, UsageCounter

METRICS = {
    "ask": ("viewer", "ask_per_day", "day"),
    "ai_minutes": ("creator", "ai_minutes", "month"),
    "renders": ("creator", "renders", "month"),
    "ai_images": ("creator", "ai_images", "month"),
}
LABELS = {"ask": "Ask questions", "ai_minutes": "AI minutes", "renders": "clip renders", "ai_images": "AI thumbnails"}


class QuotaExceeded(Exception):
    def __init__(self, metric: str, limit: int, used: int):
        super().__init__(metric)
        self.metric, self.limit, self.used = metric, limit, used


def now() -> datetime:
    return datetime.now(timezone.utc)


def period(kind: str, at: datetime | None = None) -> str:
    at = at or now()
    return at.strftime("%Y-%m-%d") if kind == "day" else at.strftime("%Y-%m")


def owner_user_id(db: Session, tenant_id: int) -> int | None:
    return db.execute(select(User.id).where(User.tenant_id == tenant_id, User.role == "owner")
                      .order_by(User.id)).scalar() or db.execute(
        select(User.id).where(User.tenant_id == tenant_id).order_by(User.id)).scalar()


def active_plan(db: Session, user_id: int, audience: str) -> Plan:
    t = now()
    keys = db.execute(select(Entitlement.ref).where(
        Entitlement.user_id == user_id, Entitlement.kind == "plan", Entitlement.revoked_at.is_(None),
        Entitlement.starts_at <= t, (Entitlement.ends_at.is_(None)) | (Entitlement.ends_at > t),
    )).scalars().all()
    plans = db.execute(select(Plan).where(Plan.audience == audience)).scalars().all()
    owned = [p for p in plans if p.key in keys]
    if owned:
        return max(owned, key=lambda p: p.sort)
    free = next((p for p in plans if p.price_inr_minor == 0), None)
    if free is None:
        raise RuntimeError(f"no free {audience} plan seeded")
    return free


def limit_for(db: Session, user_id: int, metric: str) -> int:
    audience, key, _ = METRICS[metric]
    return int((active_plan(db, user_id, audience).limits or {}).get(key) or 0)


def _row(db: Session, tenant_id: int, user_id: int, metric: str, per: str) -> UsageCounter:
    db.execute(insert(UsageCounter).values(tenant_id=tenant_id, user_id=user_id, metric=metric, period=per,
                                           used=0, reserved=0).on_conflict_do_nothing(
        index_elements=["user_id", "metric", "period"]))
    return db.execute(select(UsageCounter).where(UsageCounter.user_id == user_id, UsageCounter.metric == metric,
                                                 UsageCounter.period == per).with_for_update()).scalars().one()


def usage(db: Session, user_id: int, metric: str) -> dict:
    _, _, kind = METRICS[metric]
    row = db.execute(select(UsageCounter).where(UsageCounter.user_id == user_id, UsageCounter.metric == metric,
                                                UsageCounter.period == period(kind))).scalars().first()
    used = int(row.used + row.reserved) if row else 0
    return {"metric": metric, "label": LABELS[metric], "used": used, "limit": limit_for(db, user_id, metric),
            "period": period(kind)}


def reserve(db: Session, tenant_id: int, user_id: int, metric: str, amount: int) -> str:
    _, _, kind = METRICS[metric]
    per = period(kind)
    row = _row(db, tenant_id, user_id, metric, per)
    cap = limit_for(db, user_id, metric)
    if row.used + row.reserved + amount > cap:
        raise QuotaExceeded(metric, cap, int(row.used + row.reserved))
    row.reserved += amount
    db.flush()
    return per


def commit(db: Session, tenant_id: int, user_id: int, metric: str, amount: int, per: str, actual: int | None = None) -> None:
    row = _row(db, tenant_id, user_id, metric, per)
    row.reserved = max(0, row.reserved - amount)
    row.used += amount if actual is None else actual
    db.flush()


def release(db: Session, tenant_id: int, user_id: int, metric: str, amount: int, per: str) -> None:
    row = _row(db, tenant_id, user_id, metric, per)
    row.reserved = max(0, row.reserved - amount)
    db.flush()


def refuse(exc: QuotaExceeded):
    return err(402, "quota_reached", metric=LABELS.get(exc.metric, exc.metric))
