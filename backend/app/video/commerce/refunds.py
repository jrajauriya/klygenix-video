from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.messages import err, refused
from app.video.commerce import entitlements, splits
from app.video.jobs import job
from app.video.ledger.posting import Entry, post
from app.video.models.commerce import Checkout, Payment, Subscription
from app.video.models.payouts import CreatorSplit, Refund
from app.video.models.social import Comment, Danmaku
from app.video.models.tax import TaxInvoice
from app.video.rails import RailError, rail_named
from app.video.services.numbering import next_number


def refunded(db: Session, payment_id: int) -> int:
    return int(db.execute(select(func.coalesce(func.sum(Refund.amount_minor), 0)).where(
        Refund.payment_id == payment_id, Refund.status == "processed")).scalar_one())


def _credit_note(db: Session, inv: TaxInvoice, amount: int, refund: Refund) -> TaxInvoice:
    g = inv.total_minor or 1

    def part(x: int) -> int:
        return (x * amount * 2 + g) // (2 * g)

    cg, sg, ig = part(inv.cgst_minor), part(inv.sgst_minor), part(inv.igst_minor)
    note = TaxInvoice(
        tenant_id=inv.tenant_id, kind="credit_note",
        number=next_number(db, tenant_id=inv.tenant_id, series="KCN", day=date.today()),
        invoice_date=date.today(), order_id=inv.order_id, seller=inv.seller, buyer=inv.buyer,
        place_of_supply=inv.place_of_supply,
        lines=[{"title": f"Refund against {inv.number}", "taxable_minor": amount - cg - sg - ig,
                "tax_minor": cg + sg + ig, "total_minor": amount}],
        taxable_minor=amount - cg - sg - ig, cgst_minor=cg, sgst_minor=sg, igst_minor=ig, total_minor=amount,
        currency=inv.currency,
    )
    db.add(note)
    db.flush()
    return note


def _plan_reversal(db: Session, chk: Checkout, payment: Payment, inv: TaxInvoice | None, amount: int, refund: Refund) -> None:
    if chk.currency != "INR" or inv is None:
        return
    g = chk.amount_minor or 1

    def part(x: int) -> int:
        return (x * amount * 2 + g) // (2 * g)

    cg, sg, ig = part(inv.cgst_minor), part(inv.sgst_minor), part(inv.igst_minor)
    seller = splits.platform_tenant_id(db)
    post(db, tenant_id=seller, business_date=date.today(), source_type="plan_refund", source_id=refund.id,
         idempotency_key=f"refund:{refund.id}", currency="INR", memo=f"Refund of plan payment {payment.id}",
         lines=Entry(db, seller).dr("sales", amount - cg - sg - ig).dr("tax_output_cgst", cg)
         .dr("tax_output_sgst", sg).dr("tax_output_igst", ig).cr("gateway_clearing", amount))


def _undo_effects(db: Session, chk: Checkout, payment: Payment, full: bool) -> None:
    from app.video.after_commit import later

    if chk.purpose == "plan" and full:
        entitlements.revoke(db, user_id=chk.user_id, kind="plan", source_id=payment.id, reason="refunded")
        sub = db.execute(select(Subscription).where(Subscription.user_id == chk.user_id,
                                                    Subscription.plan_key == chk.plan_key,
                                                    Subscription.status.in_(("active", "grace")))).scalars().first()
        if sub is not None:
            sub.status, sub.current_period_end = "cancelled", datetime.now(timezone.utc)
    elif chk.purpose == "membership" and full:
        key = f"tier:{(chk.target or {}).get('tier_id')}"
        entitlements.revoke(db, user_id=chk.user_id, kind="membership", source_id=payment.id, reason="refunded")
        if entitlements.active(db, chk.user_id, "membership", key) is None:
            for sub in db.execute(select(Subscription).where(Subscription.user_id == chk.user_id,
                                                             Subscription.plan_key == key,
                                                             Subscription.status.in_(("active", "grace")))).scalars():
                sub.status, sub.current_period_end = "cancelled", datetime.now(timezone.utc)
    elif chk.purpose in ("video", "series") and full:
        entitlements.revoke(db, user_id=chk.user_id, kind="video", source_id=payment.id, reason="refunded")
    elif chk.purpose == "tip":
        for c in db.execute(select(Comment).where(Comment.checkout_id == chk.id)).scalars():
            c.paid_minor = 0
    elif chk.purpose == "boost":
        for d in db.execute(select(Danmaku).where(Danmaku.checkout_id == chk.id)).scalars():
            if d.status == "visible":
                d.status = "deleted"
                later(db, _announce_removed, d.video_id, d.id)
    db.flush()


def refund(db: Session, *, payment_id: int, amount_minor: int | None, reason: str, actor_user_id: int | None,
           idempotency_key: str) -> Refund:
    existing = db.execute(select(Refund).where(Refund.idempotency_key == idempotency_key)).scalars().first()
    if existing is not None:
        return existing
    payment = db.execute(select(Payment).where(Payment.id == payment_id).with_for_update()).scalars().first()
    if payment is None:
        raise err(404, "payment_not_found")
    chk = db.get(Checkout, payment.checkout_id)
    room = payment.amount_minor - refunded(db, payment.id)
    amount = room if amount_minor is None else int(amount_minor)
    if amount <= 0 or amount > room:
        raise err(400, "refund_amount_invalid", room=room)
    r = Refund(tenant_id=payment.tenant_id, payment_id=payment.id, checkout_id=chk.id, amount_minor=amount,
               reason=(reason or "")[:200], status="requested", actor_user_id=actor_user_id,
               idempotency_key=idempotency_key)
    db.add(r)
    db.flush()
    try:
        r.gateway_refund_id = rail_named(chk.rail).refund(
            gateway_payment_id=payment.gateway_payment_id or "", amount_minor=amount,
            notes={"refund": r.id, "checkout": chk.id})
    except RailError as exc:
        r.status, r.error = "failed", str(exc)[:500]
        db.flush()
        raise refused(502, str(exc))
    r.status = "processed"
    full = amount == room
    _undo_effects(db, chk, payment, full)
    inv = db.get(TaxInvoice, payment.invoice_id) if payment.invoice_id else None
    if inv is not None:
        r.credit_note_id = _credit_note(db, inv, amount, r).id
    if chk.purpose == "plan":
        _plan_reversal(db, chk, payment, inv, amount, r)
    else:
        split = db.execute(select(CreatorSplit).where(CreatorSplit.source_key == f"{chk.purpose}:{chk.id}")).scalars().first()
        if split is not None:
            splits.on_refund(db, split, amount, r.id)
    db.flush()
    return r


@job
def _announce_removed(video_id: int, danmaku_id: int) -> None:
    from app.video.realtime.rooms import publish

    publish(video_id, {"type": "danmaku_removed", "id": danmaku_id})
