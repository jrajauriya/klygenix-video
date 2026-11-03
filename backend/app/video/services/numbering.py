"""Gapless document numbers — a row lock on the counter, never a sequence (Pay's numbering).

`ORD/26-27/00001`, `INV/26-27/00001`, `CN/26-27/00001` — within the GST portal's 16 characters. Indian GST requires an
invoice series to be consecutive within a financial year, which a Postgres sequence is not:
a rolled-back transaction burns a sequence value and leaves a gap.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.video.models.tax import NumberCounter

PADDING = 5


def financial_year(day: date) -> str:
    """Indian financial year, April to March."""
    start = day.year if day.month >= 4 else day.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def next_number(db: Session, *, tenant_id: int, series: str, day: date) -> str:
    fy = financial_year(day)
    stmt = (
        select(NumberCounter)
        .where(
            NumberCounter.tenant_id == tenant_id,
            NumberCounter.series == series,
            NumberCounter.financial_year == fy,
        )
        .with_for_update()
    )
    counter = db.execute(stmt).scalar_one_or_none()
    if counter is None:
        counter = NumberCounter(tenant_id=tenant_id, series=series, financial_year=fy, next_number=1)
        nested = db.begin_nested()
        try:
            db.add(counter)
            db.flush()
            nested.commit()
        except IntegrityError:
            nested.rollback()
            counter = db.execute(stmt).scalar_one()
    sequence = counter.next_number
    counter.next_number = sequence + 1
    db.flush()
    return f"{series}/{fy[2:]}/{str(sequence).zfill(PADDING)}"
