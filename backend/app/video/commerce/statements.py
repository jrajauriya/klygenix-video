from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.messages import err
from app.core.models.tenant import Tenant
from app.video.commerce import splits
from app.video.models.payouts import CreatorSplit, RouteTransfer
from app.video.models.tax import TaxInvoice
from app.video.services.numbering import next_number
from app.video.clock import ist_today

IST = timedelta(hours=5, minutes=30)


def month_range(month: str) -> tuple[datetime, datetime]:
    try:
        y, m = (int(x) for x in month.split("-"))
        start = date(y, m, 1)
    except (ValueError, TypeError):
        raise err(400, "action_not_allowed")
    end = date(y + (m == 12), m % 12 + 1, 1)
    return _utc(start), _utc(end)


def _utc(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time(), timezone.utc) - IST


def this_month() -> str:
    return (datetime.now(timezone.utc) + IST).strftime("%Y-%m")


def split_out(s: CreatorSplit) -> dict:
    return {"id": s.id, "purpose": s.purpose, "reference": s.reference, "paid_at": s.paid_at.isoformat(),
            "gross_minor": s.gross_minor, "taxable_minor": s.taxable_minor, "seller_tax_minor": s.seller_tax_minor,
            "commission_bps": s.commission_bps, "commission_minor": s.commission_minor,
            "commission_tax_minor": s.commission_tax_minor, "tcs_minor": s.tcs_minor, "tds_minor": s.tds_minor,
            "reserve_minor": s.reserve_minor, "net_minor": s.creator_net_minor, "refunded_minor": s.refunded_minor,
            "commission_invoice_id": s.commission_invoice_id}


def statement(db: Session, tenant_id: int, month: str) -> dict:
    start, end = month_range(month)
    rows = db.execute(select(CreatorSplit).where(CreatorSplit.tenant_id == tenant_id, CreatorSplit.paid_at >= start,
                                                 CreatorSplit.paid_at < end).order_by(CreatorSplit.paid_at)).scalars().all()
    released = db.execute(select(RouteTransfer).where(RouteTransfer.tenant_id == tenant_id,
                                                      RouteTransfer.status == "released",
                                                      RouteTransfer.released_at >= start,
                                                      RouteTransfer.released_at < end)).scalars().all()
    keys = ("gross_minor", "commission_minor", "commission_tax_minor", "tcs_minor", "tds_minor", "net_minor", "refunded_minor")
    out_rows = [split_out(s) for s in rows]
    totals = {k: sum(r[k] for r in out_rows) for k in keys}
    by_purpose: dict[str, int] = {}
    for r in out_rows:
        by_purpose[r["purpose"]] = by_purpose.get(r["purpose"], 0) + r["gross_minor"]
    return {"month": month, "currency": "INR", "sales": out_rows, "totals": totals, "by_purpose": by_purpose,
            "released_minor": sum(t.open_minor for t in released), "released": len(released)}


def statement_csv(st: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["paid_at", "reference", "purpose", "gross", "commission", "gst_on_commission", "tcs", "tds",
                "net", "refunded"])
    for r in st["sales"]:
        w.writerow([r["paid_at"], r["reference"], r["purpose"], *(f"{r[k] / 100:.2f}" for k in (
            "gross_minor", "commission_minor", "commission_tax_minor", "tcs_minor", "tds_minor", "net_minor",
            "refunded_minor"))])
    t = st["totals"]
    w.writerow(["", "", "total", *(f"{t[k] / 100:.2f}" for k in (
        "gross_minor", "commission_minor", "commission_tax_minor", "tcs_minor", "tds_minor", "net_minor",
        "refunded_minor"))])
    return buf.getvalue()


def issue_month(db: Session, month: str) -> int:
    start, end = month_range(month)
    pid = splits.platform_tenant_id(db)
    platform = db.get(Tenant, pid)
    rows = db.execute(select(CreatorSplit).where(CreatorSplit.paid_at >= start, CreatorSplit.paid_at < end,
                                                 CreatorSplit.commission_invoice_id.is_(None),
                                                 CreatorSplit.commission_minor > 0)).scalars().all()
    by_tenant: dict[int, list[CreatorSplit]] = {}
    for s in rows:
        by_tenant.setdefault(s.tenant_id, []).append(s)
    issued = 0
    for tenant_id, group in sorted(by_tenant.items()):
        acct = splits.payout_account(db, tenant_id)
        commission = sum(s.commission_minor for s in group)
        cg = sum(s.commission_cgst_minor for s in group)
        sg = sum(s.commission_sgst_minor for s in group)
        ig = sum(s.commission_igst_minor for s in group)
        inv = TaxInvoice(
            tenant_id=pid, kind="commission",
            number=next_number(db, tenant_id=pid, series="KCM", day=ist_today()), invoice_date=ist_today(),
            seller={"name": platform.name, "gstin": platform.gst_number, "address": platform.address},
            buyer={"name": acct.legal_name if acct else f"Tenant {tenant_id}", "gstin": acct.gstin if acct else None,
                   "pan": acct.pan if acct else None, "tenant_id": tenant_id, "month": month},
            place_of_supply=((acct.gstin if acct else None) or "")[:2] or None,
            lines=[{"title": f"Klygenix Play platform commission, {month} ({len(group)} sales)", "sac": "998599",
                    "taxable_minor": commission, "tax_minor": cg + sg + ig, "total_minor": commission + cg + sg + ig}],
            taxable_minor=commission, cgst_minor=cg, sgst_minor=sg, igst_minor=ig, total_minor=commission + cg + sg + ig,
            currency="INR",
        )
        db.add(inv)
        db.flush()
        for s in group:
            s.commission_invoice_id = inv.id
        issued += 1
    db.flush()
    return issued


def gstr8_csv(db: Session, month: str) -> str:
    start, end = month_range(month)
    rows = db.execute(select(CreatorSplit).where(CreatorSplit.paid_at >= start, CreatorSplit.paid_at < end,
                                                 CreatorSplit.seller_gstin.is_not(None))).scalars().all()
    agg: dict[str, list[int]] = {}
    for s in rows:
        a = agg.setdefault(s.seller_gstin, [0, 0, 0, 0, 0])
        a[0] += s.taxable_minor - (s.refunded_minor * s.taxable_minor // max(s.gross_minor, 1))
        a[1] += s.tcs_cgst_minor
        a[2] += s.tcs_sgst_minor
        a[3] += s.tcs_igst_minor
        a[4] += 1
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["supplier_gstin", "net_taxable_value", "tcs_cgst", "tcs_sgst", "tcs_igst", "sales"])
    for gstin, a in sorted(agg.items()):
        w.writerow([gstin, f"{a[0] / 100:.2f}", f"{a[1] / 100:.2f}", f"{a[2] / 100:.2f}", f"{a[3] / 100:.2f}", a[4]])
    return buf.getvalue()


def tds_194o_csv(db: Session, month: str) -> str:
    start, end = month_range(month)
    rows = db.execute(select(CreatorSplit).where(CreatorSplit.paid_at >= start, CreatorSplit.paid_at < end,
                                                 CreatorSplit.tds_minor > 0)).scalars().all()
    agg: dict[str, list[int]] = {}
    for s in rows:
        a = agg.setdefault(s.seller_pan or "NO-PAN", [0, 0, 0])
        a[0] += s.gross_minor
        a[1] += s.tds_minor
        a[2] += 1
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["deductee_pan", "gross_amount", "tds_194o", "sales"])
    for pan, a in sorted(agg.items()):
        w.writerow([pan, f"{a[0] / 100:.2f}", f"{a[1] / 100:.2f}", a[2]])
    return buf.getvalue()
