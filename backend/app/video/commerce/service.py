from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.core.models.tenant import Tenant
from app.core.models.user import User
from app.database import SessionLocal
from app.video.commerce import entitlements
from app.video.ledger.posting import Entry, post
from app.video.models.commerce import Checkout, Entitlement, Payment, Plan, ProviderEvent, Subscription
from app.video.models.social import Profile
from app.video.models.tax import TaxInvoice
from app.video.rails import RailError, rail_for, rail_named
from app.video.services.numbering import next_number
from app.video.tax.gst import split_amount, treatment
from app.video.clock import ist_today

logger = logging.getLogger(__name__)

PERIOD_DAYS = 30
GRACE_DAYS = 3
TAX_CODE = "SAAS"


def now() -> datetime:
    return datetime.now(timezone.utc)


def admin_tenant(db: Session) -> Tenant:
    return db.execute(select(Tenant).where(Tenant.slug == settings.ADMIN_TENANT_SLUG)).scalars().one()


def price(plan: Plan, country: str) -> tuple[int, str]:
    if (country or "IN").upper() == "IN":
        return plan.price_inr_minor, "INR"
    return plan.price_usd_minor, "USD"


def quote(db: Session, plan: Plan, country: str, state_code: str | None) -> dict:
    amount, currency = price(plan, country)
    seller = admin_tenant(db)
    seller_state = (seller.gst_number or "")[:2] or None
    t = treatment(db, code=TAX_CODE, on=ist_today(), seller_gstin=seller.gst_number, seller_state=seller_state,
                  buyer_country=country, buyer_state=state_code)
    parts = split_amount(amount, t, inclusive=True)
    return {"plan_key": plan.key, "amount_minor": amount, "currency": currency, "taxable_minor": parts["taxable_minor"],
            "tax_minor": parts["tax_minor"], "cgst_minor": parts["cgst_minor"], "sgst_minor": parts["sgst_minor"],
            "igst_minor": parts["igst_minor"], "rate_bps": t.rate_bps, "sac": t.sac, "split": t.split,
            "place_of_supply": t.place_of_supply, "note": t.note}


def create_checkout(db: Session, *, user: User, plan: Plan, country: str, state_code: str | None,
                    idempotency_key: str) -> Checkout:
    existing = db.execute(select(Checkout).where(Checkout.tenant_id == user.tenant_id,
                                                 Checkout.idempotency_key == idempotency_key)).scalars().first()
    if existing is not None:
        return existing
    q = quote(db, plan, country, state_code)
    rail = rail_for(country)
    order = rail.create_order(amount_minor=q["amount_minor"], currency=q["currency"],
                              receipt=f"kvplan-{user.id}-{plan.key}"[:40], notes={"plan": plan.key, "user": user.id},
                              prefill={"email": user.email, "name": user.name})
    chk = Checkout(tenant_id=user.tenant_id, user_id=user.id, purpose="plan", plan_key=plan.key,
                   taxable_minor=q["taxable_minor"], tax_minor=q["tax_minor"], amount_minor=q["amount_minor"],
                   currency=q["currency"], country=(country or "IN").upper(), state_code=state_code, rail=rail.name,
                   gateway_order_id=order.order_id, idempotency_key=idempotency_key,
                   target={"client": order.client, "quote": q})
    db.add(chk)
    db.flush()
    return chk


def ingest_payment(rail_name: str, body: bytes, signature: str | None) -> int | None:
    try:
        rail = rail_named(rail_name)
    except RailError:
        raise PermissionError("rail")
    ok = rail.verify(body, signature)
    try:
        facts = rail.facts(body) if ok else []
        event_id = facts[0].event_id if facts else ""
        kind = facts[0].kind if facts else ""
    except Exception:
        event_id, kind = "", ""
    if not ok or not event_id:
        event_id = f"unverified:{hashlib.sha256(body).hexdigest()}"
    db = SessionLocal()
    try:
        row = ProviderEvent(rail=rail_name, event_id=event_id[:200], event_type=kind[:60],
                            body=body.decode("utf-8", "replace"), signature_ok=ok)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if not ok:
                raise PermissionError("signature")
            return None
        if not ok:
            raise PermissionError("signature")
        rid = row.id
    finally:
        db.close()
    from app.video.commerce.jobs import process_payment_event

    process_payment_event.enqueue(rid)
    return rid


def _invoice(db: Session, chk: Checkout, payment: Payment, buyer: User) -> TaxInvoice:
    seller = admin_tenant(db)
    q = (chk.target or {}).get("quote") or {}
    profile = db.get(Profile, buyer.id)
    kind = "plan" if chk.country == "IN" else "export"
    inv = TaxInvoice(
        tenant_id=seller.id, kind=kind, number=next_number(db, tenant_id=seller.id, series="PLY", day=ist_today()),
        invoice_date=ist_today(), order_id=chk.id,
        seller={"name": seller.name, "address": seller.address, "email": seller.email, "gstin": seller.gst_number,
                "order_number": f"CHK-{chk.id}"},
        buyer={"name": buyer.name, "email": buyer.email, "country": chk.country, "state": chk.state_code,
               "language": profile.language if profile else "en"},
        place_of_supply=q.get("place_of_supply"),
        lines=[{"title": f"Klygenix Play — {chk.plan_key.replace('_', ' ').title()} (30 days)", "sac": q.get("sac"),
                "taxable_minor": chk.taxable_minor, "tax_rate_bps": q.get("rate_bps", 0), "tax_minor": chk.tax_minor,
                "total_minor": chk.amount_minor}],
        taxable_minor=chk.taxable_minor, cgst_minor=q.get("cgst_minor", 0), sgst_minor=q.get("sgst_minor", 0),
        igst_minor=q.get("igst_minor", 0), total_minor=chk.amount_minor, currency=chk.currency,
    )
    db.add(inv)
    db.flush()
    try:
        from app.video.documents.invoice import render
        from app.video.storage import backend

        pdf = render(inv)
        stored = backend().put(f"invoices/{inv.number.replace('/', '-')}.pdf", pdf, "application/pdf")
        inv.storage_key, inv.checksum = stored.key, stored.checksum
    except Exception:
        logger.exception("invoice render failed", extra={"invoice": inv.id})
    return inv


def _post_sale(db: Session, chk: Checkout, payment: Payment, inv: TaxInvoice) -> int | None:
    seller = admin_tenant(db)
    from app.video.services.provisioning import ensure_books

    ensure_books(db, seller.id)
    if chk.currency != "INR":
        return None
    entry = (Entry(db, seller.id).dr("gateway_clearing", chk.amount_minor - payment.fee_minor - payment.tax_on_fee_minor)
             .dr("gateway_fees", payment.fee_minor).dr("tax_input", payment.tax_on_fee_minor)
             .cr("sales", chk.taxable_minor).cr("tax_output_cgst", inv.cgst_minor)
             .cr("tax_output_sgst", inv.sgst_minor).cr("tax_output_igst", inv.igst_minor))
    j = post(db, tenant_id=seller.id, business_date=ist_today(), source_type="plan_payment", source_id=payment.id,
             lines=entry, idempotency_key=f"plan-payment-{payment.id}", currency="INR",
             memo=f"Plan {chk.plan_key} for user {chk.user_id}")
    return j.id


def grant_plan(db: Session, *, user_id: int, tenant_id: int, plan: Plan, rail: str, source: str,
               source_id: int | None, gateway_subscription_id: str | None = None) -> Subscription:
    sub = db.execute(select(Subscription).where(Subscription.user_id == user_id, Subscription.audience == plan.audience,
                                                Subscription.status.in_(("active", "grace")))).scalars().first()
    start = now()
    if sub is not None and sub.plan_key == plan.key and sub.current_period_end > start:
        start = sub.current_period_end
    end = start + timedelta(days=PERIOD_DAYS)
    if sub is None:
        sub = Subscription(tenant_id=tenant_id, user_id=user_id, plan_key=plan.key, audience=plan.audience,
                           status="active", rail=rail, gateway_subscription_id=gateway_subscription_id,
                           current_period_start=now(), current_period_end=end)
        db.add(sub)
    else:
        if sub.plan_key != plan.key:
            entitlements.revoke(db, user_id=user_id, kind="plan", ref=sub.plan_key, reason="plan_changed")
            sub.current_period_start = now()
        sub.plan_key, sub.status, sub.rail, sub.current_period_end = plan.key, "active", rail, end
        sub.cancel_at_period_end = False
    db.add(Entitlement(tenant_id=tenant_id, user_id=user_id, kind="plan", ref=plan.key, source=source,
                       source_id=source_id, starts_at=now(), ends_at=end))
    db.flush()
    return sub


def fulfil(db: Session, fact) -> str:
    chk = db.execute(select(Checkout).where(Checkout.gateway_order_id == fact.gateway_order_id)).scalars().first()
    if chk is None:
        return "unknown_order"
    if fact.kind in ("payment.failed",):
        if chk.status == "created":
            chk.status = "failed"
        return "failed"
    if fact.kind not in ("payment.captured", "order.paid"):
        return "ignored"
    if chk.status == "paid":
        return "duplicate"
    if fact.amount_minor and int(fact.amount_minor) != int(chk.amount_minor):
        logger.warning("amount mismatch", extra={"checkout": chk.id, "got": fact.amount_minor})
        return "amount_mismatch"
    buyer = db.get(User, chk.user_id)
    payment = Payment(tenant_id=chk.tenant_id, checkout_id=chk.id, gateway_payment_id=fact.gateway_payment_id,
                      amount_minor=chk.amount_minor, fee_minor=fact.fee_minor, tax_on_fee_minor=fact.tax_on_fee_minor,
                      currency=chk.currency, method=fact.method)
    db.add(payment)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return "duplicate"
    chk.status, chk.paid_at = "paid", now()
    if chk.purpose != "plan":
        from app.video.commerce import support

        support.fulfil(db, chk, payment)
        return "paid"
    plan = db.execute(select(Plan).where(Plan.key == chk.plan_key)).scalars().one()
    grant_plan(db, user_id=chk.user_id, tenant_id=chk.tenant_id, plan=plan, rail=chk.rail, source="payment",
               source_id=payment.id)
    inv = _invoice(db, chk, payment, buyer)
    payment.invoice_id = inv.id
    payment.journal_id = _post_sale(db, chk, payment, inv)
    return "paid"


def cancel(db: Session, user_id: int, audience: str) -> Subscription | None:
    sub = db.execute(select(Subscription).where(Subscription.user_id == user_id, Subscription.audience == audience,
                                                Subscription.status == "active")).scalars().first()
    if sub is not None:
        sub.cancel_at_period_end = True
        db.flush()
    return sub


def lapse_due(db: Session) -> int:
    t = now()
    n = 0
    for sub in db.execute(select(Subscription).where(Subscription.status.in_(("active", "grace")),
                                                     Subscription.current_period_end <= t)).scalars().all():
        if sub.status == "active" and not sub.cancel_at_period_end and sub.current_period_end + timedelta(days=GRACE_DAYS) > t:
            sub.status = "grace"
            n += 1
            continue
        if sub.current_period_end + timedelta(days=0 if sub.cancel_at_period_end else GRACE_DAYS) <= t:
            sub.status = "cancelled" if sub.cancel_at_period_end else "lapsed"
            entitlements.revoke(db, user_id=sub.user_id, kind="membership" if sub.audience == "member" else "plan",
                                ref=sub.plan_key, reason=sub.status)
            n += 1
    db.flush()
    return n


def sandbox_event(chk: Checkout, kind: str = "payment.captured") -> tuple[bytes, str]:
    from app.video.rails.sandbox import SandboxRail, sign

    rail = SandboxRail()
    body = rail.event_body(kind, order_id=chk.gateway_order_id, payment_id=f"sbx_pay_{chk.id}",
                           amount=chk.amount_minor, currency=chk.currency, fee=0, tax=0, method="upi")
    return body, sign(body)


def dump(obj) -> str:
    return json.dumps(obj, default=str)
