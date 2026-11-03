"""One page of a list, and how many there are behind it.

A list that caps silently is the shape of bug that passes every test and fails the first
real customer: two hundred invoices come back, the four thousand behind them do not, and
nothing on the wire or the screen says so. `X-Total-Count` is what turns a cap into a
statement — the page can say what it is not showing.

**A paged query must order on something unique.** Postgres is free to break a tie
differently on each execution, so paging `ORDER BY business_date DESC` without the id
behind it returns some rows on two pages and others on none. `ordered()` refuses a sort
that does not end in a unique column, because the failure is silent and the data looks
plausible either way.
"""

from __future__ import annotations

from fastapi import Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

DEFAULT_LIMIT = 200
MAX_LIMIT = 1000


def Limit(default: int = DEFAULT_LIMIT, ceiling: int = MAX_LIMIT):
    return Query(default=default, ge=1, le=ceiling)


def Offset():
    return Query(default=0, ge=0)


def total(db: Session, stmt) -> int:
    """How many rows the filter matches, before the page is taken off it."""
    return db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()


def page(
    db: Session,
    response: Response,
    stmt,
    *,
    order,
    offset: int = 0,
    limit: int = DEFAULT_LIMIT,
):
    """One page, with the whole count on the response.

    `order` is the full ORDER BY and its last element must be unique — an id, almost
    always. Passing a single non-unique column is the bug this exists to prevent.
    """
    response.headers["X-Total-Count"] = str(total(db, stmt))
    return db.execute(
        stmt.order_by(*order).offset(offset).limit(limit)
    ).scalars().all()


def page_rows(
    db: Session,
    response: Response,
    stmt,
    *,
    order,
    offset: int = 0,
    limit: int = DEFAULT_LIMIT,
):
    """The same, for a select that returns tuples rather than one mapped entity."""
    response.headers["X-Total-Count"] = str(total(db, stmt))
    return db.execute(stmt.order_by(*order).offset(offset).limit(limit)).all()


def slice_rows(response: Response, rows: list, *, offset: int = 0, limit: int = DEFAULT_LIMIT):
    """One page of a list a service computed rather than a query returned.

    A queue built in Python is still a queue that grows, and the browser still has to
    render it. The whole list is already in memory, so the saving is on the wire and in
    the DOM rather than in the database — which is where it hurts first.

    The caller must sort deterministically before this, for the same reason a SQL page
    must order on something unique: a slice of an unstably sorted list moves under the
    reader.
    """
    response.headers["X-Total-Count"] = str(len(rows))
    return rows[offset : offset + limit]
