"""Balances are reads of journal lines — never stored copies (§19)."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.video.models.ledger import Account, Journal, JournalLine

DEBIT_NORMAL = ("asset", "expense")


def trial_balance(db: Session, tenant_id: int, as_of: date | None = None) -> list[dict]:
    stmt = (
        select(
            Account.id, Account.code, Account.name, Account.type, Account.role,
            func.coalesce(func.sum(JournalLine.debit_minor), 0),
            func.coalesce(func.sum(JournalLine.credit_minor), 0),
        )
        .select_from(Account)
        .outerjoin(JournalLine, JournalLine.account_id == Account.id)
        .outerjoin(Journal, Journal.id == JournalLine.journal_id)
        .where(Account.tenant_id == tenant_id)
        .group_by(Account.id)
        .order_by(Account.code)
    )
    if as_of is not None:
        stmt = stmt.where((Journal.business_date <= as_of) | (Journal.id.is_(None)))
    rows = []
    for aid, code, name, typ, role, dr, cr in db.execute(stmt).all():
        dr, cr = int(dr), int(cr)
        balance = dr - cr if typ in DEBIT_NORMAL else cr - dr
        rows.append({"account_id": aid, "code": code, "name": name, "type": typ, "role": role,
                     "debit_minor": dr, "credit_minor": cr, "balance_minor": balance})
    return rows


def role_balance(db: Session, tenant_id: int, role: str) -> int:
    for row in trial_balance(db, tenant_id):
        if row["role"] == role:
            return row["balance_minor"]
    return 0
