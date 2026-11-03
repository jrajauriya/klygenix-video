"""Run queued side effects only once the transaction that caused them has committed.

An adapter appends `(job, args)` to `db.info["after_commit"]`; this listener enqueues them
after COMMIT and drops them on ROLLBACK — so a rolled-back order never messaged a bot.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session

KEY = "after_commit"


@event.listens_for(Session, "after_commit")
def _flush_jobs(session: Session) -> None:
    if session.in_nested_transaction():
        return
    pending = session.info.pop(KEY, None)
    if not pending:
        return
    for job, args in pending:
        try:
            job.enqueue(*args)
        except Exception:  # a failed enqueue must never undo a committed order
            import logging

            logging.getLogger(__name__).exception("after-commit enqueue failed")


@event.listens_for(Session, "after_rollback")
def _drop_jobs(session: Session) -> None:
    if session.in_nested_transaction():
        return
    session.info.pop(KEY, None)


def later(session: Session, job, *args) -> None:
    session.info.setdefault(KEY, []).append((job, args))
