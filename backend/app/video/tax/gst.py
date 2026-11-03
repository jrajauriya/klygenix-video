"""GST on a digital supply (§15). Server-side only — the browser never adds up tax.

Place of supply for a digital service sold to a consumer is the buyer's state; it is
derived from the address, never offered as a choice. Same state as the seller: CGST+SGST.
Another state: IGST. Outside India: zero-rated export. A seller with no GSTIN charges none.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.video.models.tax import TaxCode, TaxRate

BPS = 10_000


@dataclass(frozen=True, slots=True)
class Treatment:
    rate_bps: int
    sac: str | None
    split: str  # "intra" (CGST+SGST) | "inter" (IGST) | "none"
    place_of_supply: str | None
    note: str | None = None


def rate_for(db: Session, code: str, on: date) -> tuple[int, str | None]:
    """The rate in force for a tax code on a date — last year's invoice stays last year's."""
    row = db.execute(
        select(TaxRate.rate_bps, TaxCode.sac)
        .join(TaxCode, TaxCode.id == TaxRate.tax_code_id)
        .where(
            TaxCode.code == code,
            TaxRate.effective_from <= on,
            (TaxRate.effective_to.is_(None)) | (TaxRate.effective_to >= on),
        )
        .order_by(TaxRate.effective_from.desc())
    ).first()
    if row is None:
        return 0, None
    return int(row[0]), row[1]


def treatment(
    db: Session, *, code: str, on: date, seller_gstin: str | None, seller_state: str | None,
    buyer_country: str, buyer_state: str | None,
) -> Treatment:
    rate, sac = rate_for(db, code, on)
    if not seller_gstin:
        return Treatment(0, sac, "none", None, "Seller not registered for GST")
    if (buyer_country or "IN").upper() != "IN":
        return Treatment(0, sac, "none", "96", "Export of services — zero-rated under LUT")
    pos = buyer_state or seller_state
    if rate == 0:
        return Treatment(0, sac, "none", pos)
    split = "intra" if pos and seller_state and pos == seller_state else "inter"
    return Treatment(rate, sac, split, pos)


def split_amount(gross_minor: int, t: Treatment, inclusive: bool) -> dict:
    """Taxable value and tax components for one line. Rounded per line, half-up."""
    if t.rate_bps == 0:
        taxable, tax = gross_minor, 0
    elif inclusive:
        taxable = (gross_minor * BPS * 2 + (BPS + t.rate_bps)) // (2 * (BPS + t.rate_bps))
        tax = gross_minor - taxable
    else:
        taxable = gross_minor
        tax = (gross_minor * t.rate_bps * 2 + BPS) // (2 * BPS)
    cgst = sgst = igst = 0
    if t.split == "intra":
        cgst = tax // 2
        sgst = tax - cgst
    elif t.split == "inter":
        igst = tax
    return {"taxable_minor": taxable, "tax_minor": tax, "cgst_minor": cgst, "sgst_minor": sgst,
            "igst_minor": igst, "total_minor": taxable + tax}
