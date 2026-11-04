from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.config import settings
from app.core import audit
from app.core.messages import err
from app.video.ads import service as ads
from app.video.models.ads import AdCampaign, AdDaily, AdPayout, BrandProfile
from app.video.models.media import Video
from app.video.models.social import Channel, Profile
from app.video.present import iso
from app.video.routers.deps import Ctx, StudioCtx, Viewer, optional_viewer, platform, studio
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video", tags=["ads"])
STATES = ("AN", "AP", "AR", "AS", "BR", "CH", "CT", "DL", "DN", "GA", "GJ", "HP", "HR", "JH", "JK", "KA", "KL", "LA", "LD",
          "MH", "ML", "MN", "MP", "MZ", "NL", "OR", "PB", "PY", "RJ", "SK", "TG", "TN", "TR", "UP", "UT", "WB")


def _video(db, public_id: str) -> tuple[Video, Channel]:
    v = db.execute(select(Video).where(Video.public_id == public_id, Video.is_deleted.is_(False))).scalars().first()
    if v is None:
        raise err(404, "video_not_found")
    return v, db.get(Channel, v.channel_id)


def _country(db, viewer: Viewer, request: Request) -> str:
    if viewer.user is not None:
        p = db.get(Profile, viewer.user.id)
        if p is not None and p.country:
            return p.country
    return (request.headers.get("cf-ipcountry") or "IN").upper()[:2]


def _device(ua: str | None, app: str | None = None) -> str:
    if (app or "").lower() in ("tv", "mobile", "web"):
        return {"web": "desktop"}.get(app.lower(), app.lower())
    u = (ua or "").lower()
    if "smart-tv" in u or "smarttv" in u or "aft" in u or "android tv" in u or "klygenix-tv" in u:
        return "tv"
    if "mobi" in u or "android" in u or "iphone" in u or "expo" in u:
        return "mobile"
    return "desktop"


@router.get("/ads/breaks")
def ad_breaks(video: str, viewer: Viewer = Depends(optional_viewer)):
    with platform_session() as db:
        v, ch = _video(db, video)
        why = ads.why_not(db, v, ch, viewer.user)
        return {"eligible": why is None, "reason": why, "pre": why is None, "mid": ads.breaks(db, v) if why is None else []}


@router.get("/ads/decision")
def ad_decision(request: Request, video: str, slot: str = Query("pre", pattern="^(pre|mid)$"),
                viewer: Viewer = Depends(optional_viewer), user_agent: str | None = Header(default=None),
                x_klygenix_app: str | None = Header(default=None)):
    with platform_session() as db:
        v, ch = _video(db, video)
        ip = request.client.host if request.client else "unknown"
        ad = ads.decide(db, video=v, channel=ch, user=viewer.user, slot=slot, ip=ip, country=_country(db, viewer, request),
                        device=_device(user_agent, x_klygenix_app))
        return {"ad": ad}


class EventIn(BaseModel):
    token: str = Field(min_length=10, max_length=60)
    event: str


@router.post("/ads/events", status_code=202)
def ad_event(data: EventIn):
    return {"counted": ads.event(data.token, data.event)}


class BrandIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    contact_email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)
    website: str | None = Field(default=None, max_length=300)
    gstin: str | None = Field(default=None, pattern=r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
    state_code: str | None = None
    about: str = Field(default="", max_length=2000)


def brand_out(b: BrandProfile | None) -> dict | None:
    if b is None:
        return None
    return {"name": b.name, "contact_email": b.contact_email, "website": b.website, "gstin": b.gstin, "state_code": b.state_code,
            "about": b.about, "status": b.status, "created_at": iso(b.created_at)}


@router.get("/studio/brand")
def get_brand(ctx: StudioCtx = Depends(studio("video.brand", need_channel=False))):
    return {"brand": brand_out(ads.brand_of(ctx.db, ctx.tenant_id))}


@router.put("/studio/brand")
def put_brand(data: BrandIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    state = (data.state_code or (data.gstin or "")[:2] or "").upper() or None
    if state and not state.isdigit() and state not in STATES:
        raise err(400, "action_not_allowed")
    b = ads.brand_of(ctx.db, ctx.tenant_id)
    if b is None:
        b = BrandProfile(tenant_id=ctx.tenant_id, name=data.name.strip(), contact_email=data.contact_email.lower())
        ctx.db.add(b)
    if b.status == "suspended":
        raise err(403, "brand_suspended")
    b.name, b.contact_email, b.website = data.name.strip(), data.contact_email.lower(), data.website
    b.gstin, b.state_code, b.about = data.gstin, state, data.about.strip()
    ctx.db.commit()
    return {"brand": brand_out(b)}


class CampaignIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    creative_video_id: str | None = None
    click_url: str = Field(pattern=r"^https://", max_length=500)
    cpm_minor: int = Field(ge=1)
    daily_cap_minor: int | None = Field(default=None, ge=100)
    start_at: datetime | None = None
    end_at: datetime | None = None
    countries: list[str] = Field(default_factory=list, max_length=20)
    languages: list[str] = Field(default_factory=list, max_length=10)
    devices: list[str] = Field(default_factory=list, max_length=3)


def campaign_out(db, c: AdCampaign, with_report: bool = False) -> dict:
    v = db.get(Video, c.creative_video_id) if c.creative_video_id else None
    out = {"id": c.public_id, "name": c.name, "status": c.status, "click_url": c.click_url, "cpm_minor": c.cpm_minor,
           "budget_minor": c.budget_minor, "spent_minor": c.spent_minor, "remaining_minor": ads.unspent(c),
           "refunded_minor": c.refunded_minor, "daily_cap_minor": c.daily_cap_minor, "start_at": iso(c.start_at),
           "end_at": iso(c.end_at), "targeting": c.targeting, "skip_after_seconds": c.skip_after_seconds,
           "review_note": c.review_note, "created_at": iso(c.created_at),
           "creative": None if v is None else {"id": v.public_id, "title": v.title, "status": v.status, "duration_ms": v.duration_ms}}
    if with_report:
        out["report"] = ads.report(db, c.id)
    return out


def _creative(db, tenant_id: int, public_id: str | None) -> int | None:
    if not public_id:
        return None
    v = db.execute(select(Video).where(Video.public_id == public_id, Video.tenant_id == tenant_id,
                                       Video.is_deleted.is_(False))).scalars().first()
    if v is None or v.source == "embed":
        raise err(409, "ad_creative_not_eligible")
    if v.duration_ms and v.duration_ms > ads.CREATIVE_MAX_MS:
        raise err(409, "ad_creative_too_long")
    return v.id


def _apply(c: AdCampaign, data: CampaignIn, db, tenant_id: int) -> None:
    if data.cpm_minor < settings.ADS_MIN_CPM_MINOR:
        raise err(400, "ad_cpm_too_low", low=settings.ADS_MIN_CPM_MINOR // 100)
    if data.start_at and data.end_at and data.end_at <= data.start_at:
        raise err(400, "action_not_allowed")
    if any(d not in ("desktop", "mobile", "tv") for d in data.devices):
        raise err(400, "action_not_allowed")
    c.name, c.click_url, c.cpm_minor, c.daily_cap_minor = data.name.strip(), data.click_url, data.cpm_minor, data.daily_cap_minor
    c.start_at, c.end_at = data.start_at, data.end_at
    c.creative_video_id = _creative(db, tenant_id, data.creative_video_id)
    c.targeting = {"countries": [x.upper()[:2] for x in data.countries], "languages": [x.lower()[:8] for x in data.languages],
                   "devices": data.devices}


def _own(ctx: StudioCtx, public_id: str) -> AdCampaign:
    c = ctx.db.execute(select(AdCampaign).where(AdCampaign.public_id == public_id)).scalars().first()
    if c is None or c.tenant_id != ctx.tenant_id:
        raise err(404, "ad_campaign_not_found")
    return c


def _need_brand(ctx: StudioCtx) -> BrandProfile:
    b = ads.brand_of(ctx.db, ctx.tenant_id)
    if b is None:
        raise err(409, "brand_profile_needed")
    if b.status != "active":
        raise err(403, "brand_suspended")
    return b


@router.get("/studio/ads/campaigns")
def list_campaigns(ctx: StudioCtx = Depends(studio("video.brand", need_channel=False))):
    rows = ctx.db.execute(select(AdCampaign).where(AdCampaign.tenant_id == ctx.tenant_id)
                          .order_by(AdCampaign.id.desc())).scalars().all()
    return [campaign_out(ctx.db, c) for c in rows]


@router.post("/studio/ads/campaigns", status_code=201)
def create_campaign(data: CampaignIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    _need_brand(ctx)
    c = AdCampaign(tenant_id=ctx.tenant_id, public_id=ads.public_id(ctx.db, AdCampaign), name=data.name, click_url=data.click_url,
                   cpm_minor=max(data.cpm_minor, 1), status="draft")
    _apply(c, data, ctx.db, ctx.tenant_id)
    ctx.db.add(c)
    ctx.db.commit()
    return campaign_out(ctx.db, c)


@router.get("/studio/ads/campaigns/{public_id}")
def get_campaign(public_id: str, ctx: StudioCtx = Depends(studio("video.brand", need_channel=False))):
    return campaign_out(ctx.db, _own(ctx, public_id), with_report=True)


@router.put("/studio/ads/campaigns/{public_id}")
def edit_campaign(public_id: str, data: CampaignIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    c = _own(ctx, public_id)
    if c.status not in ("draft", "rejected", "paused"):
        raise err(409, "ad_campaign_locked")
    if c.status == "paused" and (data.cpm_minor != c.cpm_minor):
        raise err(409, "ad_campaign_locked")
    _apply(c, data, ctx.db, ctx.tenant_id)
    if c.status == "rejected":
        c.status = "draft"
    ctx.db.commit()
    return campaign_out(ctx.db, c)


@router.post("/studio/ads/campaigns/{public_id}/submit")
def submit_campaign(public_id: str, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    c = _own(ctx, public_id)
    if c.status not in ("draft", "rejected"):
        raise err(409, "ad_campaign_locked")
    if not c.creative_video_id:
        raise err(409, "ad_creative_not_eligible")
    c.status = "review"
    ctx.db.commit()
    return campaign_out(ctx.db, c)


class StateIn(BaseModel):
    action: str


@router.post("/studio/ads/campaigns/{public_id}/state")
def campaign_state(public_id: str, data: StateIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    c = _own(ctx, public_id)
    if data.action == "pause" and c.status == "active":
        c.status = "paused"
    elif data.action == "resume" and c.status == "paused":
        c.status = "active"
    elif data.action == "end" and c.status not in ("ended",):
        with platform_session() as db:
            pc = db.get(AdCampaign, c.id)
            back = ads.end(db, pc, ctx.user.id, "Ended by the advertiser.")
            db.commit()
        ctx.db.expire_all()
        out = campaign_out(ctx.db, ctx.db.get(AdCampaign, c.id))
        return {**out, "refunded_now_minor": back}
    else:
        raise err(409, "ad_campaign_locked")
    ads.forget_cache()
    ctx.db.commit()
    return campaign_out(ctx.db, c)


class FundIn(BaseModel):
    amount_minor: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=80)


@router.post("/studio/ads/campaigns/{public_id}/fund", status_code=201)
def fund_campaign(public_id: str, data: FundIn, ctx: StudioCtx = Depends(studio("video.brand", "full", need_channel=False))):
    c = _own(ctx, public_id)
    if c.status == "ended":
        raise err(409, "ad_campaign_locked")
    with platform_session() as db:
        chk = ads.create_checkout(db, user=ctx.user, campaign=db.get(AdCampaign, c.id), amount=data.amount_minor,
                                  idempotency_key=data.idempotency_key)
        db.commit()
        return {"id": chk.id, "status": chk.status, "amount_minor": chk.amount_minor, "taxable_minor": chk.taxable_minor,
                "tax_minor": chk.tax_minor, "rail": chk.rail, "client": (chk.target or {}).get("client")}


class AdsSettingIn(BaseModel):
    ads_enabled: bool


@router.get("/studio/ads/settings")
def ads_settings(ctx: StudioCtx = Depends(studio("video.earnings"))):
    return {"ads_enabled": ctx.channel.ads_enabled, "share_bps": settings.ADS_CREATOR_SHARE_BPS,
            "rules": ["Hosted long videos only — never embeds or reels", "Never on members-only or paid videos",
                      "Never shown to Premium viewers", "Skippable after 5 seconds; mid-rolls only past 8 minutes"]}


@router.put("/studio/ads/settings")
def put_ads_settings(data: AdsSettingIn, ctx: StudioCtx = Depends(studio("video.earnings", "full"))):
    ctx.channel.ads_enabled = data.ads_enabled
    ctx.db.commit()
    return {"ads_enabled": ctx.channel.ads_enabled}


@router.put("/studio/ads/videos/{public_id}")
def video_ads(public_id: str, data: AdsSettingIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = ctx.db.execute(select(Video).where(Video.public_id == public_id, Video.tenant_id == ctx.tenant_id)).scalars().first()
    if v is None:
        raise err(404, "video_not_found")
    v.ads_enabled = data.ads_enabled
    ctx.db.commit()
    return {"id": v.public_id, "ads_enabled": v.ads_enabled}


@router.get("/studio/ads/revenue")
def ads_revenue(ctx: StudioCtx = Depends(studio("video.earnings"))):
    with platform_session() as db:
        month = func.to_char(AdDaily.day, "YYYY-MM").label("month")
        rows = db.execute(select(month, func.sum(AdDaily.impressions), func.sum(AdDaily.spend_minor))
                          .where(AdDaily.channel_tenant_id == ctx.tenant_id).group_by(month).order_by(month.desc())).all()
        pays = {p.period: p for p in db.execute(select(AdPayout).where(AdPayout.tenant_id == ctx.tenant_id)).scalars()}
        out = []
        for m, imps, spend in rows:
            p = pays.get(m)
            out.append({"period": m, "impressions": int(imps), "ad_spend_minor": int(spend),
                        "share_minor": p.share_minor if p else int(spend) * settings.ADS_CREATOR_SHARE_BPS // 10_000,
                        "status": p.status if p else "accruing", "note": p.note if p else None})
        return {"share_bps": settings.ADS_CREATOR_SHARE_BPS, "months": out}


@router.get("/admin/ads/campaigns")
def admin_campaigns(response: Response, status: str | None = None, limit: int = Query(100, le=500), offset: int = 0,
                    ctx: Ctx = Depends(platform("admin.ads"))):
    q = select(AdCampaign)
    if status:
        q = q.where(AdCampaign.status == status)
    total = ctx.db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
    rows = ctx.db.execute(q.order_by(AdCampaign.id.desc()).limit(limit).offset(offset)).scalars().all()
    response.headers["X-Total-Count"] = str(total)
    out = []
    for c in rows:
        b = ads.brand_of(ctx.db, c.tenant_id)
        out.append({**campaign_out(ctx.db, c), "brand": brand_out(b)})
    return out


class ReviewIn(BaseModel):
    decision: str
    note: str = Field(default="", max_length=2000)


@router.post("/admin/ads/campaigns/{public_id}/review")
def review_campaign(public_id: str, data: ReviewIn, ctx: Ctx = Depends(platform("admin.ads", "full"))):
    c = ctx.db.execute(select(AdCampaign).where(AdCampaign.public_id == public_id)).scalars().first()
    if c is None:
        raise err(404, "ad_campaign_not_found")
    if data.decision == "approve":
        if c.status != "review":
            raise err(409, "ad_campaign_locked")
        v = ctx.db.get(Video, c.creative_video_id) if c.creative_video_id else None
        if v is None or v.status != "published":
            raise err(409, "ad_creative_not_eligible")
        c.status = "active"
    elif data.decision == "reject":
        if c.status not in ("review", "active", "paused"):
            raise err(409, "ad_campaign_locked")
        c.status = "rejected"
    elif data.decision == "pause" and c.status == "active":
        c.status = "paused"
    else:
        raise err(400, "action_not_allowed")
    c.review_note, c.reviewed_by, c.reviewed_at = data.note.strip() or None, ctx.user.id, datetime.now(timezone.utc)
    audit.record(ctx.db, action=f"ads.{data.decision}", target_table="kv_commerce.ad_campaigns", target_id=c.id,
                 after={"status": c.status, "note": c.review_note})
    ads.forget_cache()
    ctx.db.commit()
    return campaign_out(ctx.db, c)


@router.get("/admin/ads/report")
def admin_report(ctx: Ctx = Depends(platform("admin.ads"))):
    month = func.to_char(AdDaily.day, "YYYY-MM").label("month")
    rows = ctx.db.execute(select(month, func.sum(AdDaily.impressions), func.sum(AdDaily.clicks), func.sum(AdDaily.spend_minor))
                          .group_by(month).order_by(month.desc())).all()
    funded = ctx.db.execute(select(func.coalesce(func.sum(AdCampaign.budget_minor), 0),
                                   func.coalesce(func.sum(AdCampaign.spent_minor), 0))).one()
    return {"months": [{"period": m, "impressions": int(i), "clicks": int(k), "spend_minor": int(s),
                        "creator_share_minor": int(s) * settings.ADS_CREATOR_SHARE_BPS // 10_000} for m, i, k, s in rows],
            "budget_minor": int(funded[0]), "spent_minor": int(funded[1]), "share_bps": settings.ADS_CREATOR_SHARE_BPS}


class PayoutRunIn(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")


@router.post("/admin/ads/payouts/run")
def run_payouts(data: PayoutRunIn, ctx: Ctx = Depends(platform("admin.ads", "full"))):
    with platform_session() as db:
        rows = ads.pay_shares(db, data.period)
        audit.record(db, action="ads.payouts_run", target_table="kv_commerce.ad_payouts", target_id=None,
                     after={"period": data.period, "rows": len(rows)})
        db.commit()
        return [{"tenant_id": p.tenant_id, "period": p.period, "impressions": p.impressions, "spend_minor": p.spend_minor,
                 "share_minor": p.share_minor, "status": p.status, "note": p.note} for p in rows]


@router.get("/admin/ads/payouts")
def list_payouts(period: str | None = None, ctx: Ctx = Depends(platform("admin.ads"))):
    q = select(AdPayout)
    if period:
        q = q.where(AdPayout.period == period)
    return [{"tenant_id": p.tenant_id, "period": p.period, "impressions": p.impressions, "spend_minor": p.spend_minor,
             "share_bps": p.share_bps, "share_minor": p.share_minor, "status": p.status, "note": p.note,
             "created_at": iso(p.created_at)} for p in ctx.db.execute(q.order_by(AdPayout.id.desc()).limit(500)).scalars()]
