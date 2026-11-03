"""kv_ledger — the books, forked from Klygenix Pay (§14).

Append-only by database grant: the application role holds SELECT and INSERT on journals
and journal lines, nothing else. A wrong entry is corrected by a reversing entry.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, minor, pk, tenant_fk

SCHEMA = "kv_ledger"

TYPES = ("asset", "liability", "equity", "income", "expense")

# What an account is FOR. Posting code looks accounts up by role, never by name (Pay's rule).
ROLES = (
    "gateway_clearing",   # collected by the gateway, not yet settled to the bank
    "bank",
    "sales",              # the seller's revenue (P1: Klygenix's own)
    "tax_output_cgst", "tax_output_sgst", "tax_output_igst",
    "gateway_fees",
    "tax_input",          # GST charged on gateway fees
    "affiliate_payable",
    "affiliate_expense",
    "tds_payable",
    "refunds_payable",
    "seller_payable",     # P3 — owed to creators, held
    "seller_reserve",     # P3
    "commission_income",  # P3
    "tcs_payable",        # P3
    "commission_expense",
    "tcs_receivable",
    "tds_receivable",
    "payout_clearing",
    "retained_earnings",
)


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_accounts_code"),
        Index("uq_accounts_role", "tenant_id", "role", unique=True, postgresql_where="role IS NOT NULL"),
        CheckConstraint("type IN ('asset','liability','equity','income','expense')", name="ck_accounts_type"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    code: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)
    role: Mapped[str | None] = mapped_column(String(24))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = created()


class Journal(Base):
    __tablename__ = "journals"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_journals_idem"),
        Index("idx_journals_source", "source_type", "source_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)
    source_id: Mapped[int | None] = mapped_column(BigInteger)
    memo: Mapped[str | None] = mapped_column(String(300))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    reverses_journal_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.journals.id")
    )
    posted_by_user_id: Mapped[int | None] = mapped_column(Integer)
    posted_at: Mapped[datetime] = created()


class JournalLine(Base):
    __tablename__ = "journal_lines"
    __table_args__ = (
        CheckConstraint("debit_minor >= 0 AND credit_minor >= 0", name="ck_lines_positive"),
        CheckConstraint("(debit_minor = 0) <> (credit_minor = 0)", name="ck_lines_one_side"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    journal_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.journals.id"), nullable=False, index=True
    )
    account_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.accounts.id"), nullable=False, index=True
    )
    debit_minor: Mapped[int] = minor()
    credit_minor: Mapped[int] = minor()
    memo: Mapped[str | None] = mapped_column(String(200))
    party_type: Mapped[str | None] = mapped_column(String(12))
    party_id: Mapped[int | None] = mapped_column(BigInteger)


class Period(Base):
    __tablename__ = "periods"
    __table_args__ = (
        UniqueConstraint("tenant_id", "starts_on", name="uq_periods_start"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    name: Mapped[str] = mapped_column(String(20), nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    is_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
