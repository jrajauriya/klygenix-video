from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import settings
from app.core.messages import err
from app.video.commerce import entitlements, splits, support
from app.video.models.commerce import Entitlement, Subscription
from app.video.models.media import Video
from app.video.models.payouts import MembershipTier
from app.video.models.social import Channel, Playlist
from app.video.present import iso
from app.video.rails import RailError
from app.video.routers import limits
from app.video.routers.billing import checkout_out
from app.video.routers.deps import Ctx, Viewer, optional_viewer, signed_in
from app.video.sessions import platform_session
from app.video.services import handles

router = APIRouter(prefix="/api/video", tags=["support"])


def tier_out(t: MembershipTier) -> dict:
    return {"id": t.id, "name": t.name, "rank": t.rank, "price_minor": t.price_inr_minor, "currency": "INR",
            "perks": t.perks, "badge": t.badge, "is_active": t.is_active}


def boost_tiers() -> list[dict]:
    return [{"tier": k, "price_minor": v["price_minor"], "pin_ms": v["pin_ms"], "color": v["color"], "label": v["label"]}
            for k, v in support.BOOST_TIERS.items()]


def my_rank(db, user_id: int | None, channel_id: int) -> int:
    if not user_id:
        return 0
    rank = 0
    for e in db.execute(select(Entitlement).where(Entitlement.user_id == user_id, Entitlement.kind == "membership",
                                                  Entitlement.revoked_at.is_(None))).scalars():
        if entitlements.active(db, user_id, "membership", e.ref) is None:
            continue
        t = db.get(MembershipTier, int(e.ref.split(":")[1]))
        if t is not None and t.channel_id == channel_id:
            rank = max(rank, t.rank)
    return rank


@router.get("/channels/{handle}/support")
def channel_support(handle: str, viewer: Viewer = Depends(optional_viewer)):
    with platform_session() as db:
        ch = handles.resolve(db, handle)[0]
        if ch is None:
            raise err(404, "channel_not_found")
        tiers = db.execute(select(MembershipTier).where(MembershipTier.channel_id == ch.id, MembershipTier.is_active.is_(True))
                           .order_by(MembershipTier.rank)).scalars().all()
        uid = viewer.user.id if viewer.user else None
        return {"channel": ch.handle, "can_take_money": splits.selling_problem(db, ch) is None,
                "tip_min_minor": settings.TIP_MIN_MINOR, "tip_max_minor": settings.TIP_MAX_MINOR, "currency": "INR",
                "boost_tiers": boost_tiers(), "tiers": [tier_out(t) for t in tiers], "my_rank": my_rank(db, uid, ch.id),
                "commission_bps": splits.commission_bps(db, ch.tenant_id),
                "superchat_tiers": [{"tier": k, **v} for k, v in support.SUPERCHAT_TIERS.items()],
                "gifts": [{"gift": k, **v} for k, v in support.GIFTS.items()],
                "is_owner": bool(viewer.user and viewer.user.tenant_id == ch.tenant_id)}


class SupportIn(BaseModel):
    purpose: str
    amount_minor: int | None = None
    message: str | None = Field(default=None, max_length=200)
    video_id: str | None = None
    channel: str | None = None
    boost_tier: int | None = None
    tier: int | None = None
    text: str | None = Field(default=None, max_length=200)
    t_ms: int | None = Field(default=None, ge=0)
    tier_id: int | None = None
    playlist_id: int | None = None
    stream_id: str | None = None
    gift: str | None = Field(default=None, max_length=20)
    state_code: str | None = Field(default=None, max_length=2)
    idempotency_key: str = Field(default_factory=lambda: secrets.token_hex(12), max_length=80)


@router.post("/support/checkout", status_code=201, dependencies=[Depends(limits.checkout_create)])
def support_checkout(data: SupportIn, ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        try:
            chk = support.create(db, user=ctx.user, purpose=data.purpose, data={**data.model_dump(), "boost_tier": data.boost_tier if data.boost_tier is not None else data.tier},
                                 idempotency_key=data.idempotency_key, state_code=data.state_code)
        except RailError as exc:
            raise err(503, "action_not_allowed") from exc
        db.commit()
        out = checkout_out(chk)
        out.update(purpose=chk.purpose, target={k: v for k, v in (chk.target or {}).items() if k not in ("client", "quote")})
        return out


class BoostCheck(BaseModel):
    text: str = Field(min_length=1, max_length=200)


@router.post("/videos/{public_id}/boost/check")
def boost_check(public_id: str, data: BoostCheck, ctx: Ctx = Depends(signed_in)):
    from app.video.social.filter import clean, has_link

    with platform_session() as db:
        v = db.execute(select(Video).where(Video.public_id == public_id)).scalars().first()
        if not support.hosted(v):
            raise err(409, "money_not_on_embeds")
    ok, text = clean(data.text.strip())
    if len(text) > 60:
        raise err(400, "danmaku_too_long")
    if not ok or has_link(text):
        raise err(400, "danmaku_blocked_words")
    return {"ok": True, "text": text, "tiers": boost_tiers()}


@router.get("/me/memberships")
def my_memberships(ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        subs = db.execute(select(Subscription).where(Subscription.user_id == ctx.user.id, Subscription.audience == "member")
                          .order_by(Subscription.created_at.desc())).scalars().all()
        out = []
        for s in subs:
            t = db.get(MembershipTier, int(s.plan_key.split(":")[1]))
            ch = db.get(Channel, t.channel_id) if t else None
            out.append({"tier": tier_out(t) if t else None, "channel": ch.handle if ch else None,
                        "channel_name": ch.name if ch else None, "status": s.status,
                        "current_period_end": iso(s.current_period_end), "cancel_at_period_end": s.cancel_at_period_end})
        return out


@router.post("/me/memberships/{tier_id}/cancel")
def cancel_membership(tier_id: int, ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        sub = db.execute(select(Subscription).where(Subscription.user_id == ctx.user.id, Subscription.audience == "member",
                                                    Subscription.plan_key == f"tier:{tier_id}",
                                                    Subscription.status == "active")).scalars().first()
        if sub is None:
            raise err(404, "tier_not_found")
        sub.cancel_at_period_end = True
        db.commit()
        return {"status": sub.status, "cancel_at_period_end": True, "current_period_end": iso(sub.current_period_end)}


@router.get("/me/purchases")
def my_purchases(ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        rows = db.execute(select(Entitlement).where(Entitlement.user_id == ctx.user.id, Entitlement.kind == "video",
                                                    Entitlement.revoked_at.is_(None))
                          .order_by(Entitlement.created_at.desc())).scalars().all()
        out = []
        for e in rows:
            if e.ref.startswith("series:"):
                pl = db.get(Playlist, int(e.ref.split(":")[1]))
                out.append({"kind": "series", "id": pl.id if pl else None, "title": pl.title if pl else "", "bought_at": iso(e.created_at)})
            else:
                v = db.execute(select(Video).where(Video.public_id == e.ref)).scalars().first()
                out.append({"kind": "video", "id": e.ref, "title": v.title if v else "", "bought_at": iso(e.created_at)})
        return out
