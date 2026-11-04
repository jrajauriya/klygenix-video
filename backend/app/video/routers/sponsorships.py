from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core import audit
from app.core.messages import err
from app.video.ads import service as ads
from app.video.ads import sponsorships as sp
from app.video.models.ads import BrandProfile, SponsorApplication, SponsorBrief, SponsorDeal
from app.video.models.media import Video
from app.video.models.social import Channel
from app.video.present import channel_card, iso
from app.video.routers.deps import Ctx, StudioCtx, platform, studio
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video", tags=["sponsorships"])
DELIVERABLES = ("dedicated", "integration", "reel", "post")


class BriefIn(BaseModel):
    title: str = Field(min_length=4, max_length=160)
    description: str = Field(min_length=20, max_length=5000)
    deliverable: str
    budget_min_minor: int = Field(ge=100000)
    budget_max_minor: int = Field(ge=100000)
    languages: list[str] = Field(default_factory=list, max_length=10)
    min_followers: int = Field(default=0, ge=0)
    deadline: date | None = None


def brief_out(db, b: SponsorBrief, brand: BrandProfile | None = None, mine: SponsorApplication | None = None,
              applicants: int | None = None) -> dict:
    brand = brand or ads.brand_of(db, b.tenant_id)
    out = {"id": b.public_id, "title": b.title, "description": b.description, "deliverable": b.deliverable,
           "budget_min_minor": b.budget_min_minor, "budget_max_minor": b.budget_max_minor, "languages": b.languages,
           "min_followers": b.min_followers, "deadline": b.deadline.isoformat() if b.deadline else None, "status": b.status,
           "created_at": iso(b.created_at), "brand": {"name": brand.name, "website": brand.website} if brand else None}
    if mine is not None:
        out["my_application"] = {"id": mine.id, "status": mine.status, "quote_minor": mine.quote_minor}
    if applicants is not None:
        out["applicants"] = applicants
    return out


def deal_out(db, d: SponsorDeal) -> dict:
    ch = db.get(Channel, d.channel_id)
    v = db.get(Video, d.video_id) if d.video_id else None
    brand = ads.brand_of(db, d.tenant_id)
    return {"id": d.public_id, "title": d.title, "deliverables": d.deliverables, "price_minor": d.price_minor, "status": d.status,
            "channel": channel_card(ch) if ch else None, "brand": {"name": brand.name} if brand else None,
            "video": {"id": v.public_id, "title": v.title} if v else None, "funded_at": iso(d.funded_at),
            "delivered_at": iso(d.delivered_at), "approve_by": iso(d.approve_by), "approved_at": iso(d.approved_at),
            "auto_approved": d.auto_approved, "dispute_reason": d.dispute_reason, "resolution_note": d.resolution_note,
            "created_at": iso(d.created_at)}


def _brand(ctx: StudioCtx) -> BrandProfile:
    b = ads.brand_of(ctx.db, ctx.tenant_id)
    if b is None:
        raise err(409, "brand_profile_needed")
    if b.status != "active":
        raise err(403, "brand_suspended")
    return b


@router.post("/studio/sponsorships/briefs", status_code=201)
def create_brief(data: BriefIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    _brand(ctx)
    if data.deliverable not in DELIVERABLES or data.budget_max_minor < data.budget_min_minor:
        raise err(400, "action_not_allowed")
    b = SponsorBrief(tenant_id=ctx.tenant_id, public_id=sp.public_id(ctx.db, SponsorBrief, "B"), title=data.title.strip(),
                     description=data.description.strip(), deliverable=data.deliverable, budget_min_minor=data.budget_min_minor,
                     budget_max_minor=data.budget_max_minor, languages=[x.lower()[:8] for x in data.languages],
                     min_followers=data.min_followers, deadline=data.deadline)
    ctx.db.add(b)
    ctx.db.commit()
    return brief_out(ctx.db, b)


@router.get("/studio/sponsorships/my-briefs")
def my_briefs(ctx: StudioCtx = Depends(studio("video.brand", need_channel=False))):
    rows = ctx.db.execute(select(SponsorBrief).where(SponsorBrief.tenant_id == ctx.tenant_id)
                          .order_by(SponsorBrief.id.desc())).scalars().all()
    with platform_session() as db:
        counts = dict(db.execute(select(SponsorApplication.brief_id, func.count(SponsorApplication.id))
                                 .where(SponsorApplication.brief_id.in_([b.id for b in rows]))
                                 .group_by(SponsorApplication.brief_id)).all()) if rows else {}
    return [brief_out(ctx.db, b, applicants=counts.get(b.id, 0)) for b in rows]


@router.post("/studio/sponsorships/briefs/{public_id}/close")
def close_brief(public_id: str, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    b = ctx.db.execute(select(SponsorBrief).where(SponsorBrief.public_id == public_id)).scalars().first()
    if b is None or b.tenant_id != ctx.tenant_id:
        raise err(404, "brief_not_found")
    b.status = "closed"
    ctx.db.commit()
    return brief_out(ctx.db, b)


@router.get("/studio/sponsorships/briefs")
def open_briefs(response: Response, limit: int = Query(50, le=200), offset: int = 0,
                ctx: StudioCtx = Depends(studio("video.sponsorships"))):
    with platform_session() as db:
        q = select(SponsorBrief).where(SponsorBrief.status == "open", SponsorBrief.tenant_id != ctx.tenant_id,
                                       SponsorBrief.min_followers <= ctx.channel.follower_count,
                                       (SponsorBrief.deadline.is_(None)) | (SponsorBrief.deadline >= func.current_date()))
        total = db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
        rows = db.execute(q.order_by(SponsorBrief.id.desc()).limit(limit).offset(offset)).scalars().all()
        mine = {a.brief_id: a for a in db.execute(select(SponsorApplication).where(
            SponsorApplication.channel_id == ctx.channel.id, SponsorApplication.brief_id.in_([b.id for b in rows]))).scalars()} if rows else {}
        response.headers["X-Total-Count"] = str(total)
        return [brief_out(db, b, mine=mine.get(b.id)) for b in rows
                if not b.languages or ctx.channel.language in b.languages]


class ApplyIn(BaseModel):
    pitch: str = Field(min_length=20, max_length=3000)
    quote_minor: int = Field(ge=100000)


@router.post("/studio/sponsorships/briefs/{public_id}/apply", status_code=201)
def apply(public_id: str, data: ApplyIn, ctx: StudioCtx = Depends(studio("video.sponsorships", "full"))):
    from app.video.commerce import splits

    with platform_session() as db:
        b = db.execute(select(SponsorBrief).where(SponsorBrief.public_id == public_id)).scalars().first()
        if b is None or b.status != "open" or b.tenant_id == ctx.tenant_id:
            raise err(404, "brief_not_found")
        splits.require_selling(db, db.get(Channel, ctx.channel.id))
        if db.execute(select(SponsorApplication.id).where(SponsorApplication.brief_id == b.id,
                                                          SponsorApplication.channel_id == ctx.channel.id)).first():
            raise err(409, "already_applied")
        a = SponsorApplication(tenant_id=ctx.tenant_id, brief_id=b.id, channel_id=ctx.channel.id, pitch=data.pitch.strip(),
                               quote_minor=data.quote_minor)
        db.add(a)
        db.commit()
        return {"id": a.id, "status": a.status, "quote_minor": a.quote_minor}


@router.get("/studio/sponsorships/briefs/{public_id}/applications")
def applications(public_id: str, ctx: StudioCtx = Depends(studio("video.brand", need_channel=False))):
    b = ctx.db.execute(select(SponsorBrief).where(SponsorBrief.public_id == public_id)).scalars().first()
    if b is None or b.tenant_id != ctx.tenant_id:
        raise err(404, "brief_not_found")
    with platform_session() as db:
        rows = db.execute(select(SponsorApplication).where(SponsorApplication.brief_id == b.id)
                          .order_by(SponsorApplication.id)).scalars().all()
        return [{"id": a.id, "pitch": a.pitch, "quote_minor": a.quote_minor, "status": a.status, "created_at": iso(a.created_at),
                 "channel": channel_card(db.get(Channel, a.channel_id))} for a in rows]


class AcceptIn(BaseModel):
    deliverables: str = Field(min_length=10, max_length=3000)
    price_minor: int | None = Field(default=None, ge=100000)


@router.post("/studio/sponsorships/applications/{application_id}/accept", status_code=201)
def accept(application_id: int, data: AcceptIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    _brand(ctx)
    with platform_session() as db:
        a = db.get(SponsorApplication, application_id)
        b = db.get(SponsorBrief, a.brief_id) if a else None
        if a is None or b is None or b.tenant_id != ctx.tenant_id:
            raise err(404, "brief_not_found")
        if a.status != "applied":
            raise err(409, "deal_not_open")
        ch = db.get(Channel, a.channel_id)
        a.status = "accepted"
        d = SponsorDeal(tenant_id=ctx.tenant_id, public_id=sp.public_id(db, SponsorDeal, "D"), brief_id=b.id, application_id=a.id,
                        channel_id=ch.id, channel_tenant_id=ch.tenant_id, title=b.title, deliverables=data.deliverables.strip(),
                        price_minor=data.price_minor or a.quote_minor, status="proposed")
        db.add(d)
        db.commit()
        return deal_out(db, d)


@router.post("/studio/sponsorships/applications/{application_id}/decline")
def decline(application_id: int, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    with platform_session() as db:
        a = db.get(SponsorApplication, application_id)
        b = db.get(SponsorBrief, a.brief_id) if a else None
        if a is None or b is None or b.tenant_id != ctx.tenant_id or a.status != "applied":
            raise err(404, "brief_not_found")
        a.status = "declined"
        db.commit()
        return {"id": a.id, "status": a.status}


def _deal(db, public_id: str) -> SponsorDeal:
    d = db.execute(select(SponsorDeal).where(SponsorDeal.public_id == public_id)).scalars().first()
    if d is None:
        raise err(404, "deal_not_found")
    return d


@router.get("/studio/sponsorships/deals")
def deals(ctx: StudioCtx = Depends(studio("video.dashboard", need_channel=False))):
    with platform_session() as db:
        rows = db.execute(select(SponsorDeal).where((SponsorDeal.tenant_id == ctx.tenant_id)
                                                    | (SponsorDeal.channel_tenant_id == ctx.tenant_id))
                          .order_by(SponsorDeal.id.desc())).scalars().all()
        return [{**deal_out(db, d), "role": "brand" if d.tenant_id == ctx.tenant_id else "creator"} for d in rows]


@router.get("/studio/sponsorships/deals/{public_id}")
def deal(public_id: str, ctx: StudioCtx = Depends(studio("video.dashboard", need_channel=False))):
    with platform_session() as db:
        d = _deal(db, public_id)
        if ctx.tenant_id not in (d.tenant_id, d.channel_tenant_id):
            raise err(404, "deal_not_found")
        return {**deal_out(db, d), "role": "brand" if d.tenant_id == ctx.tenant_id else "creator"}


class FundIn(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=80)


@router.post("/studio/sponsorships/deals/{public_id}/fund", status_code=201)
def fund(public_id: str, data: FundIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    with platform_session() as db:
        d = _deal(db, public_id)
        if d.tenant_id != ctx.tenant_id:
            raise err(404, "deal_not_found")
        chk = sp.create_checkout(db, user=ctx.user, deal=d, idempotency_key=data.idempotency_key)
        db.commit()
        return {"id": chk.id, "status": chk.status, "amount_minor": chk.amount_minor, "rail": chk.rail,
                "client": (chk.target or {}).get("client")}


class DeliverIn(BaseModel):
    video_id: str


@router.post("/studio/sponsorships/deals/{public_id}/deliver")
def deliver(public_id: str, data: DeliverIn, ctx: StudioCtx = Depends(studio("video.sponsorships", "full"))):
    with platform_session() as db:
        d = _deal(db, public_id)
        if d.channel_tenant_id != ctx.tenant_id:
            raise err(404, "deal_not_found")
        v = db.execute(select(Video).where(Video.public_id == data.video_id, Video.tenant_id == ctx.tenant_id)).scalars().first()
        if v is None:
            raise err(404, "video_not_found")
        sp.deliver(db, d, v)
        db.commit()
        return deal_out(db, d)


@router.post("/studio/sponsorships/deals/{public_id}/approve")
def approve(public_id: str, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    from app.video.commerce import splits

    with platform_session() as db:
        d = _deal(db, public_id)
        if d.tenant_id != ctx.tenant_id:
            raise err(404, "deal_not_found")
        if d.status != "delivered":
            raise err(409, "deal_not_open")
        sp.approve(db, d)
        db.commit()
        out = deal_out(db, d)
    splits.release_due()
    return out


class DisputeIn(BaseModel):
    reason: str = Field(min_length=10, max_length=2000)


@router.post("/studio/sponsorships/deals/{public_id}/dispute")
def dispute(public_id: str, data: DisputeIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    with platform_session() as db:
        d = _deal(db, public_id)
        if d.tenant_id != ctx.tenant_id:
            raise err(404, "deal_not_found")
        if d.status != "delivered":
            raise err(409, "deal_not_open")
        d.status, d.dispute_reason = "disputed", data.reason.strip()
        sp.notify(db, d, "disputed")
        db.commit()
        return deal_out(db, d)


@router.post("/studio/sponsorships/deals/{public_id}/cancel")
def cancel(public_id: str, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    with platform_session() as db:
        d = _deal(db, public_id)
        if d.tenant_id != ctx.tenant_id:
            raise err(404, "deal_not_found")
        if d.status == "proposed":
            d.status = "cancelled"
        elif d.status == "funded":
            sp.refund(db, d, ctx.user.id, "Cancelled by the brand before delivery")
        else:
            raise err(409, "deal_not_open")
        db.commit()
        return deal_out(db, d)


@router.get("/admin/sponsorships/deals")
def admin_deals(status: str | None = None, ctx: Ctx = Depends(platform("admin.sponsorships"))):
    q = select(SponsorDeal)
    if status:
        q = q.where(SponsorDeal.status == status)
    return [deal_out(ctx.db, d) for d in ctx.db.execute(q.order_by(SponsorDeal.id.desc()).limit(300)).scalars()]


class ResolveIn(BaseModel):
    decision: str
    note: str = Field(min_length=3, max_length=2000)


@router.post("/admin/sponsorships/deals/{public_id}/resolve")
def resolve(public_id: str, data: ResolveIn, ctx: Ctx = Depends(platform("admin.sponsorships", "full"))):
    from app.video.commerce import splits

    d = _deal(ctx.db, public_id)
    if d.status != "disputed":
        raise err(409, "deal_not_open")
    if data.decision == "release":
        sp.approve(ctx.db, d)
    elif data.decision == "refund":
        sp.refund(ctx.db, d, ctx.user.id, data.note)
    else:
        raise err(400, "action_not_allowed")
    d.resolution_note = data.note.strip()
    audit.record(ctx.db, action=f"sponsorship.{data.decision}", target_table="kv_commerce.sponsor_deals", target_id=d.id,
                 after={"note": data.note})
    ctx.db.commit()
    if data.decision == "release":
        splits.release_due()
    return deal_out(ctx.db, d)


@router.get("/brands")
def brands_page():
    with platform_session() as db:
        briefs = db.execute(select(func.count(SponsorBrief.id)).where(SponsorBrief.status == "open")).scalar() or 0
        active = db.execute(select(func.count(func.distinct(SponsorDeal.tenant_id)))).scalar() or 0
    return {"open_briefs": briefs, "brands": active,
            "how": ["Open a brand profile in the studio", "Post a brief or run an ad campaign",
                    "Fund a deal — the money is held until you approve the video",
                    "Every sponsored video carries a “Paid partnership” label"]}
