from __future__ import annotations

import logging

from app.video.commerce.service import fulfil, now
from app.video.jobs import job
from app.video.models.commerce import ProviderEvent
from app.video.rails import rail_named
from app.video.sessions import platform_session

logger = logging.getLogger(__name__)


@job
def process_payment_event(event_row_id: int) -> None:
    with platform_session() as db:
        row = db.execute(
            ProviderEvent.__table__.select().where(ProviderEvent.id == event_row_id).with_for_update()
        ).first()
        if row is None or row.processed_at is not None or not row.signature_ok:
            return
        event = db.get(ProviderEvent, event_row_id)
        outcomes = []
        try:
            for fact in rail_named(event.rail).facts(event.body.encode()):
                outcomes.append(fulfil(db, fact))
            event.processed_at = now()
            event.attempts += 1
            event.error = None if all(o in ("paid", "duplicate", "ignored", "failed") for o in outcomes) else ",".join(outcomes)
            db.commit()
        except Exception as exc:
            db.rollback()
            event = db.get(ProviderEvent, event_row_id)
            event.attempts += 1
            event.error = str(exc)[:500]
            db.commit()
            raise
