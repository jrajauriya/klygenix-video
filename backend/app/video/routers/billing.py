from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import settings
from app.core.messages import err
from app.video.commerce import quotas
from app.video.commerce import service as commerce
from app.video.models.commerce import Checkout, Payment, Plan, Subscription
from app.video.models.social import Profile
from app.video.models.tax import TaxInvoice
from app.video.present import iso
from app.video.rails import RailError
from app.video.routers import limits
from app.video.routers.deps import Ctx, signed_in
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video", tags=["billing"])


def plan_out(p: Plan, country: str = "IN") -> dict:
    amount, currency = commerce.price(p, country)
    return {"key": p.key, "audience": p.audience, "name": p.name, "description": p.description,
            "price_minor": amount, "currency": currency, "price_inr_minor": p.price_inr_minor,
            "price_usd_minor": p.price_usd_minor, "limits": p.limits, "free": p.price_inr_minor == 0}


@router.get("/plans")
def plans(country: str = "IN"):
    with platform_session() as db:
        rows = db.execute(select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.sort)).scalars().all()
        return [plan_out(p, country) for p in rows]


@router.get("/me")
def me(ctx: Ctx = Depends(signed_in)):
    from app.video.models.social import Channel
    from app.video.present import channel_card

    p = ctx.db.get(Profile, ctx.user.id)
    channel = ctx.db.execute(select(Channel).where(Channel.tenant_id == ctx.tenant_id)).scalars().first()
    viewer_plan = quotas.active_plan(ctx.db, ctx.user.id, "viewer")
    creator_plan = quotas.active_plan(ctx.db, ctx.user.id, "creator")
    subs = ctx.db.execute(select(Subscription).where(Subscription.user_id == ctx.user.id,
                                                     Subscription.status.in_(("active", "grace")))).scalars().all()
    return {
        "user": {"id": ctx.user.id, "email": ctx.user.email, "name": ctx.user.name, "role": ctx.user.role},
        "profile": None if p is None else {"display_name": p.display_name, "country": p.country, "language": p.language},
        "channel": channel_card(channel),
        "plans": {"viewer": plan_out(viewer_plan, p.country if p else "IN"), "creator": plan_out(creator_plan, p.country if p else "IN")},
        "subscriptions": [{"plan_key": s.plan_key, "audience": s.audience, "status": s.status,
                           "current_period_end": iso(s.current_period_end), "cancel_at_period_end": s.cancel_at_period_end}
                          for s in subs],
        "usage": [quotas.usage(ctx.db, ctx.user.id, m) for m in ("ask", "ai_minutes", "renders")],
    }


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    language: str | None = None


@router.patch("/me")
def patch_me(data: ProfilePatch, ctx: Ctx = Depends(signed_in)):
    p = ctx.db.get(Profile, ctx.user.id)
    if p is None:
        raise err(404, "action_not_allowed")
    if data.display_name is not None:
        p.display_name = data.display_name.strip()
    if data.language is not None and data.language in ("en", "hi", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa", "or"):
        p.language = data.language
        ctx.user.settings = {**(ctx.user.settings or {}), "language": data.language}
    ctx.db.commit()
    return me(ctx)


class CheckoutIn(BaseModel):
    plan_key: str
    state_code: str | None = Field(default=None, max_length=2)
    idempotency_key: str = Field(default_factory=lambda: secrets.token_hex(12), max_length=80)


def checkout_out(c: Checkout) -> dict:
    return {"id": c.id, "plan_key": c.plan_key, "amount_minor": c.amount_minor, "taxable_minor": c.taxable_minor,
            "tax_minor": c.tax_minor, "currency": c.currency, "rail": c.rail, "status": c.status,
            "client": (c.target or {}).get("client"), "quote": (c.target or {}).get("quote"),
            "created_at": iso(c.created_at), "paid_at": iso(c.paid_at)}


@router.post("/checkout", status_code=201, dependencies=[Depends(limits.checkout_create)])
def checkout(data: CheckoutIn, ctx: Ctx = Depends(signed_in)):
    plan = ctx.db.execute(select(Plan).where(Plan.key == data.plan_key, Plan.is_active.is_(True))).scalars().first()
    if plan is None or plan.price_inr_minor == 0:
        raise err(404, "plan_not_found")
    current = quotas.active_plan(ctx.db, ctx.user.id, plan.audience)
    if current.key == plan.key:
        sub = ctx.db.execute(select(Subscription).where(Subscription.user_id == ctx.user.id,
                                                        Subscription.plan_key == plan.key,
                                                        Subscription.status == "active")).scalars().first()
        if sub is not None and not sub.cancel_at_period_end:
            raise err(409, "already_on_plan")
    p = ctx.db.get(Profile, ctx.user.id)
    try:
        chk = commerce.create_checkout(ctx.db, user=ctx.user, plan=plan, country=p.country if p else "IN",
                                       state_code=data.state_code, idempotency_key=data.idempotency_key)
    except RailError as exc:
        raise err(503, "action_not_allowed") from exc
    ctx.db.commit()
    return checkout_out(chk)


@router.get("/checkout/{checkout_id}")
def get_checkout(checkout_id: int, ctx: Ctx = Depends(signed_in)):
    c = ctx.db.get(Checkout, checkout_id)
    if c is None or c.user_id != ctx.user.id:
        raise err(404, "checkout_not_found")
    return checkout_out(c)


@router.post("/sandbox/pay/{checkout_id}", dependencies=[Depends(limits.sandbox_pay)])
def sandbox_pay(checkout_id: int, outcome: str = "captured", ctx: Ctx = Depends(signed_in)):
    if not settings.SANDBOX_ENABLED:
        raise err(404, "sandbox_only")
    c = ctx.db.get(Checkout, checkout_id)
    if c is None or c.user_id != ctx.user.id or c.rail != "sandbox":
        raise err(404, "checkout_not_found")
    body, sig = commerce.sandbox_event(c, "payment.failed" if outcome == "failed" else "payment.captured")
    commerce.ingest_payment("sandbox", body, sig)
    return {"queued": True}


@router.post("/me/plans/{audience}/cancel")
def cancel_plan(audience: str, ctx: Ctx = Depends(signed_in)):
    if audience not in ("viewer", "creator"):
        raise err(404, "plan_not_found")
    sub = commerce.cancel(ctx.db, ctx.user.id, audience)
    ctx.db.commit()
    return {"cancelled": sub is not None, "ends_at": iso(sub.current_period_end) if sub else None}


@router.get("/me/invoices")
def my_invoices(ctx: Ctx = Depends(signed_in)):
    pays = ctx.db.execute(select(Payment).where(Payment.tenant_id == ctx.tenant_id).order_by(Payment.id.desc())).scalars().all()
    ids = [p.invoice_id for p in pays if p.invoice_id]
    if not ids:
        return []
    with platform_session() as db:
        invs = db.execute(select(TaxInvoice).where(TaxInvoice.id.in_(ids)).order_by(TaxInvoice.id.desc())).scalars().all()
        return [{"id": i.id, "number": i.number, "date": i.invoice_date.isoformat(), "total_minor": i.total_minor,
                 "currency": i.currency, "kind": i.kind, "has_pdf": bool(i.storage_key)} for i in invs]


@router.get("/me/invoices/{invoice_id}.pdf")
def invoice_pdf(invoice_id: int, ctx: Ctx = Depends(signed_in)):
    from app.video.storage import backend

    owned = ctx.db.execute(select(Payment.id).where(Payment.tenant_id == ctx.tenant_id, Payment.invoice_id == invoice_id)).first()
    if not owned:
        raise err(404, "checkout_not_found")
    with platform_session() as db:
        inv = db.get(TaxInvoice, invoice_id)
        key = inv.storage_key if inv else None
    if not key:
        raise err(404, "checkout_not_found")
    return Response(backend().get(key), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="invoice-{invoice_id}.pdf"'})


@router.post("/webhooks/payments/{rail}")
async def payment_webhook(rail: str, request: Request):
    if rail not in ("razorpay", "lemonsqueezy", "sandbox"):
        raise err(404, "action_not_allowed")
    body = await request.body()
    signature = (request.headers.get("X-Razorpay-Signature") or request.headers.get("X-Signature")
                 or request.headers.get("X-Sandbox-Signature"))
    try:
        await run_in_threadpool(commerce.ingest_payment, rail, body, signature)
    except PermissionError:
        raise err(400, "action_not_allowed")
    return {"ok": True}
