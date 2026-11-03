from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import settings
from app.core.messages import err
from app.video.commerce import payouts, splits, statements
from app.video.models.media import Video
from app.video.models.payouts import CreatorSplit, MembershipTier, RouteTransfer
from app.video.models.social import Playlist
from app.video.models.tax import TaxInvoice
from app.video.present import iso
from app.video.routers.deps import StudioCtx, studio
from app.video.routers.support import tier_out

router = APIRouter(prefix="/api/video/studio", tags=["studio-earnings"])
KEY = "video.earnings"
PRICE_MIN, PRICE_MAX = 1000, 5_000_000


def _can_sell(ctx: StudioCtx) -> bool:
    return splits.selling_problem(ctx.db, ctx.channel) is None


@router.get("/earnings")
def earnings(ctx: StudioCtx = Depends(studio(KEY))):
    acct = splits.payout_account(ctx.db, ctx.tenant_id)
    month = statements.this_month()
    st = statements.statement(ctx.db, ctx.tenant_id, month)
    return {"account": payouts.out(acct), "problems": payouts.problems(acct) if acct else [],
            "can_take_money": _can_sell(ctx), "problem": splits.selling_problem(ctx.db, ctx.channel),
            "balances": splits.balances(ctx.db, ctx.tenant_id), "commission_bps": splits.commission_bps(ctx.db, ctx.tenant_id),
            "refund_window_days": settings.REFUND_WINDOW_DAYS, "reserve_bps": settings.MARKETPLACE_RESERVE_BPS,
            "month": month, "month_totals": st["totals"], "month_by_purpose": st["by_purpose"]}


class AccountIn(BaseModel):
    business_type: str | None = None
    legal_name: str | None = Field(default=None, max_length=200)
    contact_name: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=20)
    pan: str | None = Field(default=None, max_length=10)
    gstin: str | None = Field(default=None, max_length=15)
    address: dict | None = None
    beneficiary_name: str | None = Field(default=None, max_length=120)
    ifsc: str | None = Field(default=None, max_length=11)
    account_number: str | None = Field(default=None, max_length=24)


@router.put("/earnings/account")
def save_account(data: AccountIn, ctx: StudioCtx = Depends(studio(KEY, "full"))):
    a = payouts.save(ctx.db, ctx.tenant_id, data.model_dump())
    ctx.db.commit()
    return {"account": payouts.out(a), "problems": payouts.problems(a)}


@router.post("/earnings/account/submit")
def submit_account(ctx: StudioCtx = Depends(studio(KEY, "full"))):
    a = payouts.submit(ctx.db, ctx.tenant_id)
    ctx.db.commit()
    return {"account": payouts.out(a), "problems": []}


@router.post("/earnings/account/refresh")
def refresh_account(ctx: StudioCtx = Depends(studio(KEY))):
    a = splits.payout_account(ctx.db, ctx.tenant_id)
    if a is None:
        raise err(404, "fill_payout_details_first")
    payouts.refresh(ctx.db, a, strict=True)
    ctx.db.commit()
    return {"account": payouts.out(a)}


def transfer_out(t: RouteTransfer) -> dict:
    return {"id": t.id, "kind": t.kind, "amount_minor": t.amount_minor, "reversed_minor": t.reversed_minor,
            "open_minor": t.open_minor, "status": t.status, "hold_until": iso(t.hold_until),
            "released_at": iso(t.released_at), "note": t.note, "error": t.error, "split_id": t.split_id}


@router.get("/earnings/transfers")
def transfers(response: Response, status: str | None = None, limit: int = Query(50, le=200), offset: int = 0,
              ctx: StudioCtx = Depends(studio(KEY))):
    q = select(RouteTransfer).where(RouteTransfer.tenant_id == ctx.tenant_id)
    if status:
        q = q.where(RouteTransfer.status == status)
    rows = ctx.db.execute(q.order_by(RouteTransfer.id.desc()).limit(limit).offset(offset)).scalars().all()
    return [transfer_out(t) for t in rows]


@router.get("/earnings/sales")
def sales(purpose: str | None = None, limit: int = Query(50, le=200), offset: int = 0,
          ctx: StudioCtx = Depends(studio(KEY))):
    q = select(CreatorSplit).where(CreatorSplit.tenant_id == ctx.tenant_id)
    if purpose:
        q = q.where(CreatorSplit.purpose == purpose)
    rows = ctx.db.execute(q.order_by(CreatorSplit.paid_at.desc()).limit(limit).offset(offset)).scalars().all()
    return [statements.split_out(s) for s in rows]


@router.get("/earnings/statement")
def statement(month: str | None = None, format: str = "json", ctx: StudioCtx = Depends(studio(KEY))):
    st = statements.statement(ctx.db, ctx.tenant_id, month or statements.this_month())
    if format == "csv":
        return Response(statements.statement_csv(st), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="earnings-{st["month"]}.csv"'})
    return st


@router.get("/earnings/commission-invoices")
def commission_invoices(ctx: StudioCtx = Depends(studio(KEY))):
    from app.video.sessions import platform_session

    with platform_session() as db:
        ids = {s.commission_invoice_id for s in db.execute(select(CreatorSplit).where(
            CreatorSplit.tenant_id == ctx.tenant_id, CreatorSplit.commission_invoice_id.is_not(None))).scalars()}
        rows = db.execute(select(TaxInvoice).where(TaxInvoice.id.in_(ids)).order_by(TaxInvoice.id.desc())).scalars().all() if ids else []
        return [{"id": i.id, "number": i.number, "date": i.invoice_date.isoformat(), "taxable_minor": i.taxable_minor,
                 "tax_minor": i.cgst_minor + i.sgst_minor + i.igst_minor, "total_minor": i.total_minor,
                 "month": (i.buyer or {}).get("month")} for i in rows]


class TierIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    rank: int = Field(ge=1, le=5)
    price_minor: int
    perks: str = Field(default="", max_length=1000)
    badge: str = Field(default="Member", min_length=1, max_length=16)


class TierPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    price_minor: int | None = None
    perks: str | None = Field(default=None, max_length=1000)
    badge: str | None = Field(default=None, min_length=1, max_length=16)
    is_active: bool | None = None


def _price_ok(price: int) -> None:
    if not PRICE_MIN <= price <= PRICE_MAX:
        raise err(400, "price_out_of_range", low=PRICE_MIN // 100, high=PRICE_MAX // 100)


def _need_payouts(ctx: StudioCtx) -> None:
    if not _can_sell(ctx):
        raise err(409, "setup_payouts_first")


@router.get("/memberships/tiers")
def list_tiers(ctx: StudioCtx = Depends(studio(KEY))):
    rows = ctx.db.execute(select(MembershipTier).where(MembershipTier.tenant_id == ctx.tenant_id)
                          .order_by(MembershipTier.rank)).scalars().all()
    return [tier_out(t) for t in rows]


@router.post("/memberships/tiers", status_code=201)
def create_tier(data: TierIn, ctx: StudioCtx = Depends(studio(KEY, "full"))):
    _need_payouts(ctx)
    _price_ok(data.price_minor)
    if ctx.db.execute(select(MembershipTier.id).where(MembershipTier.channel_id == ctx.channel.id,
                                                      MembershipTier.rank == data.rank)).first():
        raise err(409, "action_not_allowed")
    t = MembershipTier(tenant_id=ctx.tenant_id, channel_id=ctx.channel.id, name=data.name.strip(), rank=data.rank,
                       price_inr_minor=data.price_minor, perks=data.perks.strip(), badge=data.badge.strip())
    ctx.db.add(t)
    ctx.db.commit()
    return tier_out(t)


@router.patch("/memberships/tiers/{tier_id}")
def patch_tier(tier_id: int, data: TierPatch, ctx: StudioCtx = Depends(studio(KEY, "full"))):
    t = ctx.db.get(MembershipTier, tier_id)
    if t is None or t.tenant_id != ctx.tenant_id:
        raise err(404, "tier_not_found")
    if data.price_minor is not None:
        _price_ok(data.price_minor)
        t.price_inr_minor = data.price_minor
    for f in ("name", "perks", "badge", "is_active"):
        v = getattr(data, f)
        if v is not None:
            setattr(t, f, v.strip() if isinstance(v, str) else v)
    ctx.db.commit()
    return tier_out(t)


class AccessIn(BaseModel):
    access: str
    price_minor: int | None = None
    members_rank: int | None = Field(default=None, ge=1, le=5)
    preview_seconds: int | None = Field(default=None, ge=0, le=300)


@router.put("/videos/{video_id}/access")
def set_access(video_id: int, data: AccessIn, ctx: StudioCtx = Depends(studio(KEY, "full"))):
    v = ctx.db.get(Video, video_id)
    if v is None or v.tenant_id != ctx.tenant_id or v.is_deleted:
        raise err(404, "video_not_found")
    if data.access not in ("free", "members", "paid"):
        raise err(400, "action_not_allowed")
    if data.access != "free":
        if v.source == "embed":
            raise err(400, "price_on_embed")
        _need_payouts(ctx)
    if data.access == "paid":
        _price_ok(int(data.price_minor or 0))
        v.price_inr_minor, v.members_rank = data.price_minor, None
    elif data.access == "members":
        rank = data.members_rank or 1
        if not ctx.db.execute(select(MembershipTier.id).where(MembershipTier.channel_id == v.channel_id,
                                                              MembershipTier.rank <= rank,
                                                              MembershipTier.is_active.is_(True))).first():
            raise err(400, "tier_not_found")
        v.members_rank, v.price_inr_minor = rank, None
    else:
        v.price_inr_minor = v.members_rank = None
    v.access = data.access
    if data.preview_seconds is not None:
        v.preview_seconds = data.preview_seconds
    ctx.db.commit()
    return {"id": v.id, "access": v.access, "price_minor": v.price_inr_minor, "members_rank": v.members_rank,
            "preview_seconds": v.preview_seconds}


class SeriesPrice(BaseModel):
    price_minor: int | None = None


@router.put("/playlists/{playlist_id}/price")
def set_series_price(playlist_id: int, data: SeriesPrice, ctx: StudioCtx = Depends(studio(KEY, "full"))):
    pl = ctx.db.get(Playlist, playlist_id)
    if pl is None or pl.tenant_id != ctx.tenant_id:
        raise err(404, "playlist_not_found")
    if data.price_minor is not None:
        if pl.kind != "series":
            raise err(400, "action_not_allowed")
        _need_payouts(ctx)
        _price_ok(data.price_minor)
    pl.price_inr_minor = data.price_minor
    ctx.db.commit()
    return {"id": pl.id, "price_minor": pl.price_inr_minor}


@router.get("/earnings/commission-invoices/{invoice_id}.pdf")
def commission_invoice_pdf(invoice_id: int, ctx: StudioCtx = Depends(studio(KEY))):
    from app.video.documents.invoice import render
    from app.video.sessions import platform_session

    with platform_session() as db:
        mine = db.execute(select(CreatorSplit.id).where(CreatorSplit.tenant_id == ctx.tenant_id,
                                                        CreatorSplit.commission_invoice_id == invoice_id)).first()
        inv = db.get(TaxInvoice, invoice_id)
        if not mine or inv is None:
            raise err(404, "action_not_allowed")
        pdf = render(inv)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="commission-{inv.number.replace("/", "-")}.pdf"'})
