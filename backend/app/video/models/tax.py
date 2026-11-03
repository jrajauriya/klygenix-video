"""kv_tax — GST codes and dated rates, numbering, and the stored tax invoice (§15).

A rate is a row with an effective date, never a constant in code: a notification changes a
row, not a release. An invoice is rendered once and stored, never regenerated.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger, CheckConstraint, Date, ForeignKey, Integer, String, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, minor, pk, tenant_fk

SCHEMA = "kv_tax"


class TaxCode(Base):
    """Platform-wide: the kinds of supply and their SAC. Not tenant-scoped."""

    __tablename__ = "tax_codes"
    __table_args__ = (UniqueConstraint("code", name="uq_tax_codes_code"), {"schema": SCHEMA})

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    sac: Mapped[str] = mapped_column(String(10), nullable=False)


class TaxRate(Base):
    __tablename__ = "tax_rates"
    __table_args__ = (
        UniqueConstraint("tax_code_id", "effective_from", name="uq_tax_rates_from"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tax_code_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{SCHEMA}.tax_codes.id", ondelete="CASCADE"), nullable=False
    )
    rate_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str | None] = mapped_column(String(200))


class Withholding(Base):
    """Dated withholding rates — TDS on commission (s.194H) now; operator TCS/TDS in P3."""

    __tablename__ = "withholding_rates"
    __table_args__ = (
        UniqueConstraint("section", "effective_from", name="uq_withholding_from"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    section: Mapped[str] = mapped_column(String(12), nullable=False)
    rate_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    # Below this in a financial year, nothing is withheld.
    threshold_minor: Mapped[int] = minor()
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    source: Mapped[str | None] = mapped_column(String(200))


class NumberCounter(Base):
    """Gapless numbering: a row lock on the counter, never a sequence (Pay's numbering)."""

    __tablename__ = "number_counters"
    __table_args__ = (
        UniqueConstraint("tenant_id", "series", "financial_year", name="uq_counters_series_fy"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    series: Mapped[str] = mapped_column(String(10), nullable=False)
    financial_year: Mapped[str] = mapped_column(String(9), nullable=False)
    next_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class TaxInvoice(Base):
    __tablename__ = "tax_invoices"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_tax_invoices_number"),
        CheckConstraint("kind IN ('invoice','credit_note','export','commission','plan')", name="ck_tax_invoices_kind"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    kind: Mapped[str] = mapped_column(String(12), nullable=False, default="invoice")
    number: Mapped[str] = mapped_column(String(30), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    # An export invoice covers a month of merchant-of-record sales, not one order (§16).
    order_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    refund_id: Mapped[int | None] = mapped_column(BigInteger)
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    # The inward-remittance evidence an export under LUT is zero-rated on.
    fira_reference: Mapped[str | None] = mapped_column(String(120))
    # Who sold and who bought, frozen at issue — a March invoice keeps March's address.
    seller: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    buyer: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    place_of_supply: Mapped[str | None] = mapped_column(String(2))
    lines: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    taxable_minor: Mapped[int] = minor()
    cgst_minor: Mapped[int] = minor()
    sgst_minor: Mapped[int] = minor()
    igst_minor: Mapped[int] = minor()
    total_minor: Mapped[int] = minor()
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    storage_key: Mapped[str | None] = mapped_column(String(500))
    checksum: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = created()
