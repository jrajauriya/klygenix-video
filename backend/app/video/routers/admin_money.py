from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core import audit
from app.core.messages import err
from app.core.models.user import User
from app.video.commerce import payouts, refunds, splits, statements
from app.video.models.commerce import Checkout, Payment
from app.video.models.payouts import CreatorSplit, PayoutAccount, Refund, RouteTransfer
from app.video.models.social import Channel
from app.video.present import iso
from app.video.routers.deps import Ctx, platform
from app.video.routers.studio_earnings import transfer_out

router = APIRouter(prefix="/api/video/admin", tags=["admin-money"])
KEY = "admin.money"


@router.get("/money/summary")
def summary(ctx: Ctx = Depends(platform(KEY))):
    db = ctx.db
    rows = db.execute(select(RouteTransfer)).scalars().all()
    splits_q = db.execute(select(func.coalesce(func.sum(CreatorSplit.gross_minor), 0),
                                 func.coalesce(func.sum(CreatorSplit.commission_minor), 0),
                                 func.coalesce(func.sum(CreatorSplit.tcs_cgst_minor + CreatorSplit.tcs_sgst_minor + CreatorSplit.tcs_igst_minor), 0),
                                 func.coalesce(func.sum(CreatorSplit.tds_minor), 0),
                                 func.coalesce(func.sum(CreatorSplit.refunded_minor), 0),
                                 func.count(CreatorSplit.id))).one()
    return {
        "currency": "INR", "sales": int(splits_q[5]), "gross_minor": int(splits_q[0]), "commission_minor": int(splits_q[1]),
        "tcs_minor": int(splits_q[2]), "tds_minor": int(splits_q[3]), "refunded_minor": int(splits_q[4]),
        "held_minor": sum(t.open_minor for t in rows if t.status == "held" and t.kind == "sale"),
        "reserve_minor": sum(t.open_minor for t in rows if t.status == "held" and t.kind == "reserve"),
        "pending_minor": sum(t.open_minor for t in rows if t.status == "pending" and t.kind != "recovery"),
        "owed_back_minor": sum(t.open_minor for t in rows if t.status == "pending" and t.kind == "recovery"),
        "released_minor": sum(t.open_minor for t in rows if t.status == "released"),
        "failed": sum(1 for t in rows if t.error and t.status == "pending"),
        "accounts": dict(db.execute(select(PayoutAccount.status, func.count(PayoutAccount.id)).group_by(PayoutAccount.status)).all()),
    }


@router.get("/money/creators")
def creators(ctx: Ctx = Depends(platform(KEY))):
    db = ctx.db
    out = []
    for a in db.execute(select(PayoutAccount).order_by(PayoutAccount.updated_at.desc())).scalars():
        ch = db.execute(select(Channel).where(Channel.tenant_id == a.tenant_id)).scalars().first()
        out.append({"tenant_id": a.tenant_id, "channel": ch.handle if ch else None, "channel_name": ch.name if ch else None,
                    "account": payouts.out(a), "balances": splits.balances(db, a.tenant_id),
                    "ledger_owed_minor": splits.ledger_owed(db, a.tenant_id)})
    return out


@router.get("/money/transfers")
def transfers(status: str | None = None, tenant_id: int | None = None, limit: int = Query(100, le=500),
              ctx: Ctx = Depends(platform(KEY))):
    q = select(RouteTransfer)
    if status:
        q = q.where(RouteTransfer.status == status)
    if tenant_id:
        q = q.where(RouteTransfer.tenant_id == tenant_id)
    return [{**transfer_out(t), "tenant_id": t.tenant_id}
            for t in ctx.db.execute(q.order_by(RouteTransfer.id.desc()).limit(limit)).scalars()]


@router.post("/money/release-due")
def release_due(ctx: Ctx = Depends(platform(KEY, "full"))):
    n = splits.release_due()
    audit.record(ctx.db, action="money.release_due", target_table="kv_commerce.route_transfers", target_id=None,
                 after={"released": n})
    ctx.db.commit()
    return {"released": n}


@router.post("/money/transfers/{transfer_id}/retry")
def retry(transfer_id: int, ctx: Ctx = Depends(platform(KEY, "full"))):
    t = ctx.db.get(RouteTransfer, transfer_id)
    if t is None or t.status != "pending" or t.split_id is None:
        raise err(409, "action_not_allowed")
    out = splits.settle(t.split_id)
    ctx.db.expire_all()
    return {"transfer": transfer_out(ctx.db.get(RouteTransfer, transfer_id)), "result": out}


def payment_out(db, p: Payment) -> dict:
    chk = db.get(Checkout, p.checkout_id)
    buyer = db.get(User, chk.user_id)
    done = refunds.refunded(db, p.id)
    return {"id": p.id, "checkout_id": chk.id, "purpose": chk.purpose, "plan_key": chk.plan_key,
            "amount_minor": p.amount_minor, "currency": p.currency, "refunded_minor": done,
            "refundable_minor": p.amount_minor - done, "rail": chk.rail, "buyer": buyer.email if buyer else None,
            "channel": (chk.target or {}).get("channel_handle"), "created_at": iso(p.created_at)}


@router.get("/payments")
def payments(purpose: str | None = None, limit: int = Query(50, le=200), offset: int = 0,
             ctx: Ctx = Depends(platform(KEY))):
    q = select(Payment).join(Checkout, Checkout.id == Payment.checkout_id)
    if purpose:
        q = q.where(Checkout.purpose == purpose)
    rows = ctx.db.execute(q.order_by(Payment.id.desc()).limit(limit).offset(offset)).scalars().all()
    return [payment_out(ctx.db, p) for p in rows]


class RefundIn(BaseModel):
    amount_minor: int | None = Field(default=None, gt=0)
    reason: str = Field(min_length=3, max_length=200)
    idempotency_key: str = Field(default_factory=lambda: secrets.token_hex(12), max_length=80)


@router.post("/payments/{payment_id}/refund", status_code=201)
def refund(payment_id: int, data: RefundIn, ctx: Ctx = Depends(platform(KEY, "full"))):
    seen = ctx.db.execute(select(Refund.id).where(Refund.idempotency_key == data.idempotency_key)).first()
    r = refunds.refund(ctx.db, payment_id=payment_id, amount_minor=data.amount_minor, reason=data.reason,
                       actor_user_id=ctx.user.id, idempotency_key=data.idempotency_key)
    if not seen:
        audit.record(ctx.db, action="money.refund", target_table="kv_commerce.payments", target_id=payment_id,
                     after={"amount_minor": r.amount_minor, "reason": r.reason})
    ctx.db.commit()
    return {"id": r.id, "status": r.status, "amount_minor": r.amount_minor, "credit_note_id": r.credit_note_id,
            "payment": payment_out(ctx.db, ctx.db.get(Payment, payment_id))}


@router.get("/refunds")
def list_refunds(limit: int = Query(50, le=200), ctx: Ctx = Depends(platform(KEY))):
    return [{"id": r.id, "payment_id": r.payment_id, "amount_minor": r.amount_minor, "status": r.status,
             "reason": r.reason, "credit_note_id": r.credit_note_id, "created_at": iso(r.created_at)}
            for r in ctx.db.execute(select(Refund).order_by(Refund.id.desc()).limit(limit)).scalars()]


@router.post("/money/commission-invoices")
def issue_commission(month: str | None = None, ctx: Ctx = Depends(platform(KEY, "full"))):
    n = statements.issue_month(ctx.db, month or statements.this_month())
    audit.record(ctx.db, action="money.commission_invoices", target_table="kv_tax.tax_invoices", target_id=None,
                 after={"issued": n, "month": month})
    ctx.db.commit()
    return {"issued": n}


@router.get("/money/reports/{name}.csv")
def report(name: str, month: str | None = None, ctx: Ctx = Depends(platform(KEY))):
    m = month or statements.this_month()
    if name == "gstr8":
        body = statements.gstr8_csv(ctx.db, m)
    elif name == "tds-194o":
        body = statements.tds_194o_csv(ctx.db, m)
    else:
        raise err(404, "action_not_allowed")
    return Response(body, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}-{m}.csv"'})
