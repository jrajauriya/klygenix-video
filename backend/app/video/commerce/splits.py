from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.core.models.tenant import Tenant
from app.video.jobs import job
from app.video.ledger.posting import Entry, post
from app.video.models.commerce import Payment
from app.video.models.payouts import CreatorSplit, PayoutAccount, RouteTransfer
from app.video.models.social import Channel
from app.video.models.tax import Withholding
from app.video.rails.base import RailError
from app.video.tax.gst import rate_for

logger = logging.getLogger(__name__)
BPS = 10_000
IST = timedelta(hours=5, minutes=30)
INDIVIDUAL = ("individual", "proprietorship")
DEFAULT_COMMISSION_BPS = 2000


def _pct(amount: int, bps: int) -> int:
    return (amount * bps * 2 + BPS) // (2 * BPS) if amount > 0 and bps > 0 else 0


def _ist_date(at: datetime) -> date:
    return (at + IST).date()


def financial_year_start(day: date) -> date:
    return date(day.year if day.month >= 4 else day.year - 1, 4, 1)


def platform_tenant_id(db: Session) -> int:
    return db.execute(select(Tenant.id).where(Tenant.slug == settings.ADMIN_TENANT_SLUG)).scalar_one()


def platform_state(db: Session) -> str | None:
    gst = db.execute(select(Tenant.gst_number).where(Tenant.slug == settings.ADMIN_TENANT_SLUG)).scalar()
    return (gst or "")[:2] or None


def payout_account(db: Session, tenant_id: int) -> PayoutAccount | None:
    return db.execute(select(PayoutAccount).where(PayoutAccount.tenant_id == tenant_id)).scalars().first()


def commission_bps(db: Session, tenant_id: int) -> int:
    from app.video.commerce import quotas

    owner = quotas.owner_user_id(db, tenant_id)
    if not owner:
        return DEFAULT_COMMISSION_BPS
    limits = quotas.active_plan(db, owner, "creator").limits or {}
    return int(limits.get("commission_bps", DEFAULT_COMMISSION_BPS))


def selling_problem(db: Session, channel: Channel | None) -> str | None:
    if channel is None or channel.is_suspended:
        return "channel_cannot_take_money"
    acct = payout_account(db, channel.tenant_id)
    if acct is None or acct.status != "activated":
        return "creator_payouts_not_ready"
    return None


def require_selling(db: Session, channel: Channel | None) -> None:
    problem = selling_problem(db, channel)
    if problem:
        raise err(409, problem)


def _rate(db: Session, section: str, on: date) -> Withholding | None:
    return db.execute(select(Withholding).where(Withholding.section == section, Withholding.effective_from <= on)
                      .order_by(Withholding.effective_from.desc())).scalars().first()


@dataclass
class Sale:
    source_key: str
    purpose: str
    tenant_id: int
    checkout_id: int | None
    payment_id: int | None
    reference: str
    paid_at: datetime
    currency: str
    total_minor: int
    taxable_minor: int
    tax_minor: int
    buyer_state_code: str | None
    taxed: bool = True


def compute(db: Session, sale: Sale, *, platform_state_code: str | None) -> CreatorSplit:
    on = _ist_date(sale.paid_at)
    acct = payout_account(db, sale.tenant_id)
    gstin = acct.gstin if acct else None
    pan = acct.pan if acct else None
    seller_state = (gstin or "")[:2] or None
    pos = sale.buyer_state_code or seller_state
    taxable = sale.taxable_minor
    bps = commission_bps(db, sale.tenant_id)
    commission = _pct(taxable, bps)
    rate, _sac = rate_for(db, "PLATFORM", on)
    c_tax = _pct(commission, rate)
    c_cgst = c_sgst = c_igst = 0
    if platform_state_code and seller_state == platform_state_code:
        c_cgst = c_tax // 2
        c_sgst = c_tax - c_cgst
    else:
        c_igst = c_tax
    tcs_rate = 0
    t_cgst = t_sgst = t_igst = 0
    if gstin and sale.taxed:
        row = _rate(db, "TCS52", on)
        tcs_rate = row.rate_bps if row else 0
        tcs = _pct(taxable, tcs_rate)
        if pos and pos == seller_state:
            t_cgst = tcs // 2
            t_sgst = tcs - t_cgst
        else:
            t_igst = tcs
    tds_rate = 0
    if not pan:
        row = _rate(db, "194O_NOPAN", on)
        tds_rate = row.rate_bps if row else 0
    else:
        row = _rate(db, "194O", on)
        if row:
            tds_rate = row.rate_bps
            if (acct.business_type if acct else "individual") in INDIVIDUAL and row.threshold_minor:
                start = datetime.combine(financial_year_start(on), datetime.min.time(), timezone.utc) - IST
                fy_gross = db.execute(select(func.coalesce(func.sum(CreatorSplit.taxable_minor), 0)).where(
                    CreatorSplit.tenant_id == sale.tenant_id, CreatorSplit.paid_at >= start)).scalar_one()
                if fy_gross + taxable <= row.threshold_minor:
                    tds_rate = 0
    tds = _pct(taxable, tds_rate)
    net = sale.total_minor - commission - c_tax - (t_cgst + t_sgst + t_igst) - tds
    reserve = _pct(max(net, 0), settings.MARKETPLACE_RESERVE_BPS)
    return CreatorSplit(
        tenant_id=sale.tenant_id, source_key=sale.source_key, purpose=sale.purpose, checkout_id=sale.checkout_id,
        payment_id=sale.payment_id, reference=sale.reference, paid_at=sale.paid_at, currency=sale.currency,
        gross_minor=sale.total_minor, taxable_minor=taxable, seller_tax_minor=sale.tax_minor, seller_gstin=gstin,
        seller_pan=pan, place_of_supply=pos, commission_bps=bps, commission_minor=commission,
        commission_cgst_minor=c_cgst, commission_sgst_minor=c_sgst, commission_igst_minor=c_igst,
        tcs_rate_bps=tcs_rate, tcs_cgst_minor=t_cgst, tcs_sgst_minor=t_sgst, tcs_igst_minor=t_igst,
        tds_rate_bps=tds_rate, tds_minor=tds, reserve_minor=reserve, creator_net_minor=net,
    )


def _seller_tax_parts(split: CreatorSplit) -> tuple[int, int, int]:
    tax = split.seller_tax_minor
    if not tax:
        return 0, 0, 0
    seller_state = (split.seller_gstin or "")[:2]
    if split.place_of_supply and split.place_of_supply == seller_state:
        return tax // 2, tax - tax // 2, 0
    return 0, 0, tax


def record_split(db: Session, sale: Sale) -> CreatorSplit | None:
    from app.video.after_commit import later
    from app.video.services.provisioning import ensure_books

    if sale.total_minor <= 0 or sale.currency != "INR":
        return None
    existing = db.execute(select(CreatorSplit).where(CreatorSplit.source_key == sale.source_key)).scalars().first()
    if existing is not None:
        return existing
    split = compute(db, sale, platform_state_code=platform_state(db))
    db.add(split)
    db.flush()
    acct = payout_account(db, sale.tenant_id)
    window = max(settings.REFUND_WINDOW_DAYS, 0)
    db.add(RouteTransfer(tenant_id=sale.tenant_id, payout_account_id=acct.id if acct else None, split_id=split.id,
                         kind="sale", amount_minor=max(split.creator_net_minor - split.reserve_minor, 0),
                         status="pending", hold_until=sale.paid_at + timedelta(days=window)))
    if split.reserve_minor:
        db.add(RouteTransfer(tenant_id=sale.tenant_id, payout_account_id=acct.id if acct else None, split_id=split.id,
                             kind="reserve", amount_minor=split.reserve_minor, status="pending",
                             hold_until=sale.paid_at + timedelta(days=max(settings.MARKETPLACE_RESERVE_DAYS, window))))
    ensure_books(db, sale.tenant_id)
    registered = bool(split.seller_gstin)
    cg, sg, ig = _seller_tax_parts(split)
    post(db, tenant_id=sale.tenant_id, business_date=_ist_date(sale.paid_at), source_type="creator_sale",
         source_id=split.id, idempotency_key=f"split:{sale.source_key}", currency="INR",
         memo=f"{sale.purpose.title()} {sale.reference}",
         lines=Entry(db, sale.tenant_id)
         .dr("payout_clearing", split.creator_net_minor)
         .dr("commission_expense", split.commission_minor + (0 if registered else split.commission_tax_minor))
         .dr("tax_input", split.commission_tax_minor if registered else 0)
         .dr("tcs_receivable", split.tcs_minor)
         .dr("tds_receivable", split.tds_minor)
         .cr("sales", split.taxable_minor)
         .cr("tax_output_cgst", cg).cr("tax_output_sgst", sg).cr("tax_output_igst", ig))
    db.flush()
    later(db, settle, split.id)
    return split


def _sessions():
    from app.video.sessions import platform_session

    return platform_session()


@job
def settle(split_id: int) -> dict:
    from app.video.rails.route import route_client
    from app.video.services.provisioning import ensure_books

    out = {"transfers": 0}
    with _sessions() as db:
        split = db.get(CreatorSplit, split_id)
        if split is None:
            return out
        payment = db.get(Payment, split.payment_id) if split.payment_id else None
        ensure_books(db, platform_tenant_id(db))
        _post_platform_sale(db, split, payment)
        db.commit()
        route = route_client()
        acct = payout_account(db, split.tenant_id)
        ids = db.execute(select(RouteTransfer.id).where(RouteTransfer.split_id == split.id,
                                                        RouteTransfer.kind.in_(("sale", "reserve")),
                                                        RouteTransfer.status == "pending")).scalars().all()
        for tid in ids:
            t = db.execute(select(RouteTransfer).where(RouteTransfer.id == tid, RouteTransfer.status == "pending")
                           .with_for_update(skip_locked=True)).scalars().first()
            if t is None:
                db.rollback()
                continue
            if t.kind == "sale":
                t.reversed_minor += _net_recoveries(db, t)
            amount = t.open_minor
            try:
                if amount > 0:
                    t.gateway_transfer_id = route.transfer(
                        payment_id=payment.gateway_payment_id if payment else "",
                        account_id=acct.gateway_account_id if acct else "", amount_minor=amount,
                        hold_until=t.hold_until, notes={"ref": split.reference, "kind": t.kind, "tenant": split.tenant_id})
                t.status = "held" if amount > 0 else "reversed"
                t.error = None
                out["transfers"] += 1
            except RailError as exc:
                t.error = str(exc)[:500]
            db.commit()
    return out


def _net_recoveries(db: Session, sale: RouteTransfer) -> int:
    room = sale.open_minor
    taken = 0
    for r in db.execute(select(RouteTransfer).where(
            RouteTransfer.tenant_id == sale.tenant_id, RouteTransfer.kind == "recovery",
            RouteTransfer.status == "pending").order_by(RouteTransfer.id).with_for_update()).scalars().all():
        if room <= 0:
            break
        take = min(r.open_minor, room)
        r.reversed_minor += take
        room -= take
        taken += take
        if r.open_minor == 0:
            r.status = "recovered"
            r.recovered_by_id = sale.id
    return taken


def _post_platform_sale(db: Session, split: CreatorSplit, payment: Payment | None) -> None:
    pid = platform_tenant_id(db)
    party = {"party_type": "tenant", "party_id": split.tenant_id}
    if payment is not None and (payment.fee_minor or payment.tax_on_fee_minor):
        post(db, tenant_id=pid, business_date=_ist_date(split.paid_at), source_type="creator_fee", source_id=split.id,
             idempotency_key=f"creator_fee:{split.source_key}", currency="INR",
             memo=f"Gateway fee on creator sale {split.reference}",
             lines=Entry(db, pid).dr("gateway_fees", payment.fee_minor).dr("tax_input", payment.tax_on_fee_minor)
             .cr("gateway_clearing", payment.fee_minor + payment.tax_on_fee_minor, **party))
    post(db, tenant_id=pid, business_date=_ist_date(split.paid_at), source_type="creator_sale", source_id=split.id,
         idempotency_key=f"creator_sale:{split.source_key}", currency="INR",
         memo=f"Creator sale {split.reference} (tenant {split.tenant_id})",
         lines=Entry(db, pid)
         .dr("gateway_clearing", split.gross_minor, **party)
         .cr("seller_payable", split.creator_net_minor - split.reserve_minor, **party)
         .cr("seller_reserve", split.reserve_minor, **party)
         .cr("commission_income", split.commission_minor, **party)
         .cr("tax_output_cgst", split.commission_cgst_minor).cr("tax_output_sgst", split.commission_sgst_minor)
         .cr("tax_output_igst", split.commission_igst_minor)
         .cr("tcs_payable", split.tcs_minor, **party)
         .cr("tds_payable", split.tds_minor, **party))


def release_due(now: datetime | None = None) -> int:
    from app.video.rails.route import route_client

    now = now or datetime.now(timezone.utc)
    released = 0
    with _sessions() as db:
        route = route_client()
        due = db.execute(select(RouteTransfer.id).where(
            RouteTransfer.status == "held", RouteTransfer.kind.in_(("sale", "reserve")),
            RouteTransfer.hold_until <= now).order_by(RouteTransfer.id)).scalars().all()
        for tid in due:
            t = db.execute(select(RouteTransfer).where(RouteTransfer.id == tid, RouteTransfer.status == "held")
                           .with_for_update(skip_locked=True)).scalars().first()
            if t is None:
                db.rollback()
                continue
            try:
                if t.gateway_transfer_id:
                    route.release(t.gateway_transfer_id)
            except RailError as exc:
                t.error = str(exc)[:500]
                db.commit()
                continue
            amount = t.open_minor
            t.status = "released"
            t.released_at = now
            pid = platform_tenant_id(db)
            party = {"party_type": "tenant", "party_id": t.tenant_id}
            post(db, tenant_id=pid, business_date=_ist_date(now), source_type="transfer_release", source_id=t.id,
                 idempotency_key=f"release:{t.id}", currency="INR", memo=f"Released to creator (tenant {t.tenant_id})",
                 lines=Entry(db, pid).dr("seller_reserve" if t.kind == "reserve" else "seller_payable", amount, **party)
                 .cr("gateway_clearing", amount, **party))
            post(db, tenant_id=t.tenant_id, business_date=_ist_date(now), source_type="payout", source_id=t.id,
                 idempotency_key=f"payout:{t.id}", currency="INR", memo="Payout released to your bank",
                 lines=Entry(db, t.tenant_id).dr("bank", amount).cr("payout_clearing", amount))
            db.commit()
            released += 1
    return released


def _portion(split: CreatorSplit, amount: int) -> dict:
    g = split.gross_minor

    def part(x: int) -> int:
        return (x * amount * 2 + g) // (2 * g) if g else 0

    c_cgst, c_sgst, c_igst = part(split.commission_cgst_minor), part(split.commission_sgst_minor), part(split.commission_igst_minor)
    t_cgst, t_sgst, t_igst = part(split.tcs_cgst_minor), part(split.tcs_sgst_minor), part(split.tcs_igst_minor)
    taxable = part(split.taxable_minor)
    out = {"commission": part(split.commission_minor), "c_cgst": c_cgst, "c_sgst": c_sgst, "c_igst": c_igst,
           "commission_tax": c_cgst + c_sgst + c_igst, "t_cgst": t_cgst, "t_sgst": t_sgst, "t_igst": t_igst,
           "tcs": t_cgst + t_sgst + t_igst, "tds": part(split.tds_minor), "taxable": taxable,
           "seller_tax": amount - taxable}
    out["creator"] = amount - out["commission"] - out["commission_tax"] - out["tcs"] - out["tds"]
    return out


def on_refund(db: Session, split: CreatorSplit, amount: int, refund_id: int) -> dict | None:
    from app.video.after_commit import later
    from app.video.rails.route import route_client

    if amount <= 0:
        return None
    parts = _portion(split, amount)
    split.refunded_minor += amount
    route = route_client()
    remaining = parts["creator"]
    from_reserve = 0
    for t in db.execute(select(RouteTransfer).where(
            RouteTransfer.split_id == split.id, RouteTransfer.kind.in_(("sale", "reserve")),
            RouteTransfer.status.in_(("pending", "held"))).order_by(RouteTransfer.kind.desc())).scalars().all():
        if remaining <= 0:
            break
        take = min(t.open_minor, remaining)
        if take <= 0:
            continue
        if t.status == "held" and t.gateway_transfer_id:
            try:
                route.reverse(t.gateway_transfer_id, take)
            except RailError as exc:
                raise err(409, "creator_s_transfer_could_not_reversed", exc=exc)
        t.reversed_minor += take
        if t.open_minor == 0:
            t.status = "reversed"
        if t.kind == "reserve":
            from_reserve += take
        remaining -= take
    if remaining > 0:
        acct = payout_account(db, split.tenant_id)
        db.add(RouteTransfer(tenant_id=split.tenant_id, payout_account_id=acct.id if acct else None, split_id=split.id,
                             kind="recovery", amount_minor=remaining, status="pending",
                             note=f"Refund on {split.reference} after payout"))
    registered = bool(split.seller_gstin)
    tax = parts["seller_tax"]
    seller_state = (split.seller_gstin or "")[:2]
    same = bool(split.place_of_supply and split.place_of_supply == seller_state)
    cg, sg, ig = (tax // 2, tax - tax // 2, 0) if same else (0, 0, tax)
    post(db, tenant_id=split.tenant_id, business_date=_ist_date(datetime.now(timezone.utc)), source_type="split_refund",
         source_id=refund_id, idempotency_key=f"split_refund:{refund_id}", currency="INR",
         memo=f"Refund on {split.reference}",
         lines=Entry(db, split.tenant_id)
         .dr("sales", parts["taxable"])
         .dr("tax_output_cgst", cg).dr("tax_output_sgst", sg).dr("tax_output_igst", ig)
         .cr("payout_clearing", parts["creator"])
         .cr("commission_expense", parts["commission"] + (0 if registered else parts["commission_tax"]))
         .cr("tax_input", parts["commission_tax"] if registered else 0)
         .cr("tcs_receivable", parts["tcs"])
         .cr("tds_receivable", parts["tds"]))
    db.flush()
    parts["from_reserve"] = from_reserve
    later(db, settle_refund, split.id, refund_id, amount, parts)
    return parts


@job
def settle_refund(split_id: int, refund_id: int, amount: int, parts: dict) -> None:
    with _sessions() as db:
        split = db.get(CreatorSplit, split_id)
        pid = platform_tenant_id(db)
        party = {"party_type": "tenant", "party_id": split.tenant_id}
        reserve_now = parts.get("from_reserve", 0)
        post(db, tenant_id=pid, business_date=_ist_date(datetime.now(timezone.utc)), source_type="creator_refund",
             source_id=refund_id, idempotency_key=f"creator_refund:{refund_id}", currency="INR",
             memo=f"Refund on creator sale {split.reference} (tenant {split.tenant_id})",
             lines=Entry(db, pid)
             .dr("seller_payable", parts["creator"] - reserve_now, **party)
             .dr("seller_reserve", reserve_now, **party)
             .dr("commission_income", parts["commission"], **party)
             .dr("tax_output_cgst", parts["c_cgst"]).dr("tax_output_sgst", parts["c_sgst"]).dr("tax_output_igst", parts["c_igst"])
             .dr("tcs_payable", parts["tcs"], **party)
             .dr("tds_payable", parts["tds"], **party)
             .cr("gateway_clearing", amount, **party))
        db.commit()


def balances(db: Session, tenant_id: int) -> dict:
    rows = db.execute(select(RouteTransfer).where(RouteTransfer.tenant_id == tenant_id)).scalars().all()
    held = sum(t.open_minor for t in rows if t.status == "held" and t.kind == "sale")
    reserve = sum(t.open_minor for t in rows if t.status == "held" and t.kind == "reserve")
    pending = sum(t.open_minor for t in rows if t.status == "pending" and t.kind in ("sale", "reserve"))
    owed_back = sum(t.open_minor for t in rows if t.status == "pending" and t.kind == "recovery")
    released = sum(t.amount_minor - t.reversed_minor for t in rows if t.status == "released" and t.kind != "recovery")
    nxt = min((t.hold_until for t in rows if t.status == "held" and t.hold_until), default=None)
    return {"held_minor": held, "reserve_minor": reserve, "pending_minor": pending, "owed_back_minor": owed_back,
            "released_minor": released, "next_release_at": nxt.isoformat() if nxt else None, "currency": "INR"}


def ledger_owed(db: Session, tenant_id: int) -> int:
    from app.video.models.ledger import Account, JournalLine

    pid = platform_tenant_id(db)
    ids = db.execute(select(Account.id).where(Account.tenant_id == pid,
                                              Account.role.in_(("seller_payable", "seller_reserve")))).scalars().all()
    cr, dr = db.execute(select(func.coalesce(func.sum(JournalLine.credit_minor), 0),
                               func.coalesce(func.sum(JournalLine.debit_minor), 0))
                        .where(JournalLine.account_id.in_(ids), JournalLine.party_type == "tenant",
                               JournalLine.party_id == tenant_id)).one()
    return int(cr) - int(dr)
