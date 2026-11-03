from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.video.models.commerce import Entitlement


def active(db: Session, user_id: int, kind: str, ref: str) -> Entitlement | None:
    now = datetime.now(timezone.utc)
    return db.execute(select(Entitlement).where(
        Entitlement.user_id == user_id, Entitlement.kind == kind, Entitlement.ref == ref,
        Entitlement.revoked_at.is_(None), Entitlement.starts_at <= now,
        (Entitlement.ends_at.is_(None)) | (Entitlement.ends_at > now)).order_by(Entitlement.ends_at.desc().nulls_first())
    ).scalars().first()


def revoke(db: Session, *, user_id: int, kind: str, ref: str | None = None, source_id: int | None = None,
           reason: str) -> int:
    q = select(Entitlement).where(Entitlement.user_id == user_id, Entitlement.kind == kind,
                                  Entitlement.revoked_at.is_(None))
    if ref is not None:
        q = q.where(Entitlement.ref == ref)
    if source_id is not None:
        q = q.where(Entitlement.source_id == source_id)
    at = datetime.now(timezone.utc)
    rows = db.execute(q).scalars().all()
    for e in rows:
        e.revoked_at, e.revoke_reason = at, reason[:40]
    db.flush()
    return len(rows)
