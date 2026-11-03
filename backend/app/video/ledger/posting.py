"""The only code in this repository that writes a journal line (Pay's rule 03).

Forked from Klygenix Pay's `post()`, narrowed to one tenant and one currency per set of
books: a Store seller has no legal-entity level (§17). The refusals are the same — a
closed period, an unbalanced entry, an account that is not this tenant's or not active —
and so is the rule that corrections are reversals, enforced by the database grant.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.video.models.ledger import Account, Journal, JournalLine, Period


class LedgerError(HTTPException):
    """A refusal. 409, because the request is well-formed and a rule declines it."""

    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


@dataclass(frozen=True, slots=True)
class Line:
    account_id: int
    debit_minor: int = 0
    credit_minor: int = 0
    memo: str | None = None
    party_type: str | None = None
    party_id: int | None = None

    def __post_init__(self) -> None:
        if self.debit_minor < 0 or self.credit_minor < 0:
            raise LedgerError("A journal line cannot carry a negative amount")
        if bool(self.debit_minor) == bool(self.credit_minor):
            raise LedgerError("A journal line must be a debit or a credit, not both and not neither")


def account_by_role(db: Session, tenant_id: int, role: str) -> Account:
    """Look an account up by what it is FOR, never by name or number."""
    account = db.execute(
        select(Account).where(
            Account.tenant_id == tenant_id, Account.role == role, Account.is_active.is_(True)
        )
    ).scalars().first()
    if account is None:
        raise LedgerError(f"This store has no '{role}' account. Its chart of accounts is incomplete.")
    return account


class Entry:
    """Build an entry by role: `Entry(db, tid).dr("gateway_clearing", 1180).cr("sales", 1000)`.

    Zero amounts are dropped rather than refused, so a sale with no tax or no discount
    reads the same as one with — the caller never branches on whether a figure is zero.
    """

    def __init__(self, db: Session, tenant_id: int) -> None:
        self.db = db
        self.tenant_id = tenant_id
        self.lines: list[Line] = []

    def dr(self, role: str, amount: int, **kw) -> "Entry":
        if amount:
            acct = account_by_role(self.db, self.tenant_id, role)
            self.lines.append(Line(acct.id, debit_minor=amount, **kw))
        return self

    def cr(self, role: str, amount: int, **kw) -> "Entry":
        if amount:
            acct = account_by_role(self.db, self.tenant_id, role)
            self.lines.append(Line(acct.id, credit_minor=amount, **kw))
        return self


def _assert_period_open(db: Session, tenant_id: int, business_date: date) -> None:
    period = db.execute(
        select(Period).where(
            Period.tenant_id == tenant_id,
            Period.starts_on <= business_date,
            Period.ends_on >= business_date,
        )
    ).scalars().first()
    if period is not None and period.is_closed:
        raise LedgerError(
            f"The period {period.name} is closed. Post the correction in the open period instead."
        )


def check(db: Session, *, tenant_id: int, business_date: date, lines: list[Line]) -> None:
    if not lines:
        raise LedgerError("A journal must have at least one line")
    _assert_period_open(db, tenant_id, business_date)
    total_debit = sum(line.debit_minor for line in lines)
    total_credit = sum(line.credit_minor for line in lines)
    if total_debit != total_credit:
        raise LedgerError(
            f"Entry does not balance: debits {total_debit} ≠ credits {total_credit}"
        )
    account_ids = {line.account_id for line in lines}
    accounts = {
        a.id: a for a in db.execute(select(Account).where(Account.id.in_(account_ids))).scalars().all()
    }
    for account_id in account_ids:
        account = accounts.get(account_id)
        if account is None:
            raise LedgerError(f"Account {account_id} does not exist")
        if account.tenant_id != tenant_id:
            raise LedgerError(f"Account {account.code} belongs to a different store")
        if not account.is_active:
            raise LedgerError(f"Account {account.code} is inactive")


def post(
    db: Session,
    *,
    tenant_id: int,
    business_date: date,
    source_type: str,
    lines: list[Line] | Entry,
    idempotency_key: str,
    currency: str = "INR",
    source_id: int | None = None,
    memo: str | None = None,
    reverses_journal_id: int | None = None,
    posted_by_user_id: int | None = None,
) -> Journal:
    """Write one balanced journal. A repeat of the same idempotency key returns the first."""
    if isinstance(lines, Entry):
        lines = lines.lines
    existing = db.execute(
        select(Journal).where(Journal.tenant_id == tenant_id, Journal.idempotency_key == idempotency_key)
    ).scalars().first()
    if existing is not None:
        return existing
    check(db, tenant_id=tenant_id, business_date=business_date, lines=lines)
    journal = Journal(
        tenant_id=tenant_id,
        business_date=business_date,
        source_type=source_type,
        source_id=source_id,
        memo=memo,
        currency=currency,
        idempotency_key=idempotency_key,
        reverses_journal_id=reverses_journal_id,
        posted_by_user_id=posted_by_user_id,
    )
    db.add(journal)
    db.flush()
    for line in lines:
        db.add(
            JournalLine(
                tenant_id=tenant_id,
                journal_id=journal.id,
                account_id=line.account_id,
                debit_minor=line.debit_minor,
                credit_minor=line.credit_minor,
                memo=line.memo,
                party_type=line.party_type,
                party_id=line.party_id,
            )
        )
    db.flush()
    return journal


def reverse(
    db: Session, journal: Journal, *, business_date: date, idempotency_key: str, memo: str | None = None
) -> Journal:
    """The only correction there is: the same lines with the sides swapped."""
    lines = db.execute(select(JournalLine).where(JournalLine.journal_id == journal.id)).scalars().all()
    swapped = [
        Line(l.account_id, debit_minor=l.credit_minor, credit_minor=l.debit_minor, memo=l.memo,
             party_type=l.party_type, party_id=l.party_id)
        for l in lines
    ]
    return post(
        db, tenant_id=journal.tenant_id, business_date=business_date, source_type=journal.source_type,
        source_id=journal.source_id, lines=swapped, idempotency_key=idempotency_key,
        currency=journal.currency, memo=memo or f"Reversal of journal {journal.id}",
        reverses_journal_id=journal.id,
    )
