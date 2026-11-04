from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.core.models.user import User
from app.video.commerce import splits
from app.video.jobs import job
from app.video.models.commerce import Checkout, Entitlement, Payment, Subscription
from app.video.models.media import Video
from app.video.models.payouts import MembershipTier
from app.video.models.social import Channel, Comment, Danmaku, Playlist, Profile
from app.video.models.tax import TaxInvoice
from app.video.rails import rail_for
from app.video.services.numbering import next_number
from app.video.tax.gst import split_amount, treatment
from app.video.clock import ist_today

PURPOSES = ("tip", "boost", "membership", "video", "series", "superchat", "gift")
SUPERCHAT_TIERS = {
    1: {"price_minor": 4900, "pin_seconds": 30, "color": "#FACC15", "label": "Highlight"},
    2: {"price_minor": 19900, "pin_seconds": 120, "color": "#F472B6", "label": "Spotlight"},
    3: {"price_minor": 49900, "pin_seconds": 300, "color": "#38BDF8", "label": "Headline"},
}
GIFTS = {"chai": {"price_minor": 1900, "label": "Chai"}, "rose": {"price_minor": 4900, "label": "Rose"},
         "trophy": {"price_minor": 19900, "label": "Trophy"}}
BOOST_TIERS = {
    1: {"price_minor": 2900, "pin_ms": 5000, "color": "#FACC15", "label": "Glow"},
    2: {"price_minor": 9900, "pin_ms": 10000, "color": "#F472B6", "label": "Spotlight"},
    3: {"price_minor": 19900, "pin_ms": 20000, "color": "#38BDF8", "label": "Headline"},
}
MEMBER_DAYS = 30


def now() -> datetime:
    return datetime.now(timezone.utc)


def hosted(v: Video | None) -> bool:
    return v is not None and v.source != "embed" and v.status == "published" and not v.is_deleted


def _quote(db: Session, channel: Channel, amount: int, taxed: bool, state_code: str | None) -> dict:
    acct = splits.payout_account(db, channel.tenant_id)
    gstin = acct.gstin if acct and taxed else None
    t = treatment(db, code="OIDAR" if taxed else "NONE", on=ist_today(), seller_gstin=gstin,
                  seller_state=(gstin or "")[:2] or None, buyer_country="IN", buyer_state=state_code)
    parts = split_amount(amount, t, inclusive=True)
    return {"amount_minor": amount, "currency": "INR", "taxable_minor": parts["taxable_minor"],
            "tax_minor": parts["tax_minor"], "cgst_minor": parts["cgst_minor"], "sgst_minor": parts["sgst_minor"],
            "igst_minor": parts["igst_minor"], "rate_bps": t.rate_bps, "sac": t.sac, "split": t.split,
            "place_of_supply": t.place_of_supply, "seller_gstin": gstin}


def price(db: Session, *, user: User, purpose: str, data: dict) -> tuple[Channel, int, dict]:
    from app.video.social.filter import clean, has_link

    target: dict = {}
    if purpose == "tip":
        amount = int(data.get("amount_minor") or 0)
        if not settings.TIP_MIN_MINOR <= amount <= settings.TIP_MAX_MINOR:
            raise err(400, "tip_amount_out_of_range", low=settings.TIP_MIN_MINOR // 100, high=settings.TIP_MAX_MINOR // 100)
        message = (data.get("message") or "").strip()
        if message:
            ok, message = clean(message[:200])
            if not ok or has_link(message):
                raise err(400, "danmaku_blocked_words")
        video = None
        if data.get("video_id"):
            video = db.execute(select(Video).where(Video.public_id == data["video_id"])).scalars().first()
            if not hosted(video):
                raise err(409, "money_not_on_embeds")
            channel = db.get(Channel, video.channel_id)
            target.update(video_id=video.id, video_public_id=video.public_id)
        else:
            channel = db.execute(select(Channel).where(Channel.handle == (data.get("channel") or ""))).scalars().first()
        target["message"] = message
        return _need(channel), amount, target
    if purpose == "boost":
        tier = BOOST_TIERS.get(int(data.get("boost_tier") or 0))
        if tier is None:
            raise err(400, "action_not_allowed")
        video = db.execute(select(Video).where(Video.public_id == (data.get("video_id") or ""))).scalars().first()
        if not hosted(video):
            raise err(409, "money_not_on_embeds")
        ok, text = clean((data.get("text") or "").strip())
        if not text or len(text) > 60:
            raise err(400, "danmaku_too_long")
        if not ok or has_link(text):
            raise err(400, "danmaku_blocked_words")
        t_ms = max(0, min(int(data.get("t_ms") or 0), max(video.duration_ms, 0)))
        target.update(video_id=video.id, video_public_id=video.public_id, text=text, t_ms=t_ms,
                      boost_tier=int(data["boost_tier"]))
        return _need(db.get(Channel, video.channel_id)), tier["price_minor"], target
    if purpose in ("superchat", "gift"):
        from app.video.live import service as live
        from app.video.models.media import LiveStream

        s = db.execute(select(LiveStream).where(LiveStream.public_id == (data.get("stream_id") or ""))).scalars().first()
        if s is None or s.status != "live":
            raise err(409, "live_not_live")
        if not live.allowed(db, user, s):
            raise err(402, "video_locked")
        target.update(stream_id=s.id, stream_public_id=s.public_id)
        if purpose == "superchat":
            tier = SUPERCHAT_TIERS.get(int(data.get("boost_tier") or 0))
            if tier is None:
                raise err(400, "action_not_allowed")
            ok, text = clean((data.get("message") or "").strip()[:200])
            if not ok or has_link(text):
                raise err(400, "danmaku_blocked_words")
            target.update(tier=int(data["boost_tier"]), message=text)
            return _need(db.get(Channel, s.channel_id)), tier["price_minor"], target
        gift = GIFTS.get(str(data.get("gift") or ""))
        if gift is None:
            raise err(400, "action_not_allowed")
        target.update(gift=data["gift"])
        return _need(db.get(Channel, s.channel_id)), gift["price_minor"], target
    if purpose == "membership":
        tier = db.get(MembershipTier, int(data.get("tier_id") or 0))
        if tier is None or not tier.is_active:
            raise err(404, "tier_not_found")
        target.update(tier_id=tier.id, rank=tier.rank, tier_name=tier.name)
        return _need(db.get(Channel, tier.channel_id)), tier.price_inr_minor, target
    if purpose == "video":
        video = db.execute(select(Video).where(Video.public_id == (data.get("video_id") or ""))).scalars().first()
        if not hosted(video) or video.access != "paid" or not video.price_inr_minor:
            raise err(404, "video_not_for_sale")
        target.update(video_id=video.id, video_public_id=video.public_id, title=video.title)
        return _need(db.get(Channel, video.channel_id)), video.price_inr_minor, target
    if purpose == "series":
        pl = db.get(Playlist, int(data.get("playlist_id") or 0))
        if pl is None or pl.kind != "series" or not pl.price_inr_minor or pl.visibility != "public":
            raise err(404, "video_not_for_sale")
        target.update(playlist_id=pl.id, title=pl.title)
        return _need(db.get(Channel, pl.channel_id)), pl.price_inr_minor, target
    raise err(400, "action_not_allowed")


def _need(channel: Channel | None) -> Channel:
    if channel is None:
        raise err(404, "channel_not_found")
    return channel


def create(db: Session, *, user: User, purpose: str, data: dict, idempotency_key: str,
           state_code: str | None) -> Checkout:
    existing = db.execute(select(Checkout).where(Checkout.tenant_id == user.tenant_id,
                                                 Checkout.idempotency_key == idempotency_key)).scalars().first()
    if existing is not None:
        return existing
    if purpose not in PURPOSES:
        raise err(400, "action_not_allowed")
    profile = db.get(Profile, user.id)
    if (profile.country if profile else "IN") != "IN":
        raise err(409, "creator_money_india_only")
    channel, amount, target = price(db, user=user, purpose=purpose, data=data)
    if channel.tenant_id == user.tenant_id:
        raise err(409, "cannot_pay_yourself")
    splits.require_selling(db, channel)
    if purpose in ("video", "series"):
        ref = target["video_public_id"] if purpose == "video" else f"series:{target['playlist_id']}"
        if db.execute(select(Entitlement.id).where(Entitlement.user_id == user.id, Entitlement.kind == "video",
                                                   Entitlement.ref == ref, Entitlement.revoked_at.is_(None))).first():
            raise err(409, "already_bought")
    q = _quote(db, channel, amount, purpose != "tip", state_code)
    rail = rail_for("IN")
    order = rail.create_order(amount_minor=amount, currency="INR", receipt=f"kv{purpose}-{user.id}"[:40],
                              notes={"purpose": purpose, "user": user.id, "channel": channel.id},
                              prefill={"email": user.email, "name": user.name})
    chk = Checkout(tenant_id=user.tenant_id, user_id=user.id, purpose=purpose, plan_key=None,
                   taxable_minor=q["taxable_minor"], tax_minor=q["tax_minor"], amount_minor=amount, currency="INR",
                   country="IN", state_code=state_code, rail=rail.name, gateway_order_id=order.order_id,
                   idempotency_key=idempotency_key,
                   target={**target, "channel_id": channel.id, "channel_tenant_id": channel.tenant_id,
                           "channel_handle": channel.handle, "client": order.client, "quote": q})
    db.add(chk)
    db.flush()
    return chk


def _invoice(db: Session, chk: Checkout, buyer: User, channel: Channel) -> TaxInvoice | None:
    if chk.purpose == "tip":
        return None
    q = (chk.target or {}).get("quote") or {}
    acct = splits.payout_account(db, channel.tenant_id)
    title = {"superchat": "Super chat", "gift": f"Live gift — {(chk.target or {}).get('gift', '')}",
             "boost": "Boosted danmaku", "membership": f"Membership — {chk.target.get('tier_name', '')} (30 days)",
             "video": f"Video — {chk.target.get('title', '')}", "series": f"Series — {chk.target.get('title', '')}",
             "sponsorship": f"Sponsored content — {chk.target.get('title', '')}"}[chk.purpose]
    inv = TaxInvoice(
        tenant_id=channel.tenant_id, kind="invoice",
        number=next_number(db, tenant_id=channel.tenant_id, series="KVC", day=ist_today()),
        invoice_date=ist_today(), order_id=chk.id,
        seller={"name": acct.legal_name if acct else channel.name, "gstin": q.get("seller_gstin"),
                "channel": channel.handle, "order_number": f"CHK-{chk.id}",
                "note": None if q.get("seller_gstin") else "Bill of supply — supplier not registered for GST"},
        buyer={"name": buyer.name, "email": buyer.email, "country": "IN", "state": chk.state_code},
        place_of_supply=q.get("place_of_supply"),
        lines=[{"title": title[:160], "sac": q.get("sac"), "taxable_minor": chk.taxable_minor,
                "tax_rate_bps": q.get("rate_bps", 0), "tax_minor": chk.tax_minor, "total_minor": chk.amount_minor}],
        taxable_minor=chk.taxable_minor, cgst_minor=q.get("cgst_minor", 0), sgst_minor=q.get("sgst_minor", 0),
        igst_minor=q.get("igst_minor", 0), total_minor=chk.amount_minor, currency="INR",
    )
    db.add(inv)
    db.flush()
    return inv


def grant_membership(db: Session, *, user_id: int, tenant_id: int, tier: MembershipTier, rail: str,
                     source_id: int | None) -> Subscription:
    key = f"tier:{tier.id}"
    start = now()
    subs = db.execute(select(Subscription).where(Subscription.user_id == user_id, Subscription.audience == "member",
                                                 Subscription.status.in_(("active", "grace")))).scalars().all()
    sub = next((s for s in subs if s.plan_key == key), None)
    for other in subs:
        other_tier = db.get(MembershipTier, int(other.plan_key.split(":")[1]))
        if other is not sub and other_tier is not None and other_tier.channel_id == tier.channel_id:
            from app.video.commerce import entitlements

            other.status = "cancelled"
            entitlements.revoke(db, user_id=user_id, kind="membership", ref=other.plan_key, reason="tier_changed")
    if sub is not None and sub.current_period_end > start:
        start = sub.current_period_end
    end = start + timedelta(days=MEMBER_DAYS)
    if sub is None:
        sub = Subscription(tenant_id=tenant_id, user_id=user_id, plan_key=key, audience="member", status="active",
                           rail=rail, current_period_start=now(), current_period_end=end)
        db.add(sub)
    else:
        sub.status, sub.current_period_end, sub.cancel_at_period_end = "active", end, False
    db.add(Entitlement(tenant_id=tenant_id, user_id=user_id, kind="membership", ref=key, source="payment",
                       source_id=source_id, starts_at=now(), ends_at=end))
    db.flush()
    return sub


def fulfil(db: Session, chk: Checkout, payment: Payment) -> None:
    from app.video.after_commit import later

    t = chk.target or {}
    buyer = db.get(User, chk.user_id)
    channel = db.get(Channel, t["channel_id"])
    profile = db.get(Profile, chk.user_id)
    name = (profile.display_name if profile and profile.display_name else None) or buyer.name or "Viewer"
    if chk.purpose == "tip" and t.get("video_id"):
        db.add(Comment(tenant_id=chk.tenant_id, video_id=t["video_id"], user_id=chk.user_id, author_name=name[:80],
                       body=t.get("message") or "Sent a tip", status="visible", paid_minor=chk.amount_minor,
                       checkout_id=chk.id))
    elif chk.purpose == "boost":
        tier = BOOST_TIERS[int(t["boost_tier"])]
        d = Danmaku(tenant_id=chk.tenant_id, video_id=t["video_id"], user_id=chk.user_id, t_ms=int(t.get("t_ms") or 0),
                    text=t["text"], mode="top", color=tier["color"], status="visible", paid_minor=chk.amount_minor,
                    boost_tier=int(t["boost_tier"]), pin_ms=tier["pin_ms"], checkout_id=chk.id)
        db.add(d)
        db.flush()
        later(db, announce_boost, d.id)
    elif chk.purpose in ("superchat", "gift"):
        from app.video.models.community import LiveMessage

        if chk.purpose == "superchat":
            tier = SUPERCHAT_TIERS[int(t["tier"])]
            body, label, pin = t.get("message") or "", tier["label"], tier["pin_seconds"]
        else:
            g = GIFTS[t["gift"]]
            body, label, pin = f"sent a {g['label']}", g["label"], 15
        m = LiveMessage(tenant_id=chk.tenant_id, stream_id=t["stream_id"], user_id=chk.user_id, author_name=name[:80],
                        kind=chk.purpose, body=body[:300], paid_minor=chk.amount_minor, tier=label,
                        pinned_until=now() + timedelta(seconds=pin), checkout_id=chk.id)
        db.add(m)
        db.flush()
        later(db, announce_live, m.id)
    elif chk.purpose == "membership":
        tier = db.get(MembershipTier, t["tier_id"])
        grant_membership(db, user_id=chk.user_id, tenant_id=chk.tenant_id, tier=tier, rail=chk.rail,
                         source_id=payment.id)
    elif chk.purpose in ("video", "series"):
        ref = t["video_public_id"] if chk.purpose == "video" else f"series:{t['playlist_id']}"
        db.add(Entitlement(tenant_id=chk.tenant_id, user_id=chk.user_id, kind="video", ref=ref, source="payment",
                           source_id=payment.id, starts_at=now(), ends_at=None))
    inv = _invoice(db, chk, buyer, channel)
    if inv is not None:
        payment.invoice_id = inv.id
    q = t.get("quote") or {}
    splits.record_split(db, splits.Sale(
        source_key=f"{chk.purpose}:{chk.id}", purpose=chk.purpose, tenant_id=channel.tenant_id, checkout_id=chk.id,
        payment_id=payment.id, reference=f"CHK-{chk.id}", paid_at=chk.paid_at or now(), currency="INR",
        total_minor=chk.amount_minor, taxable_minor=chk.taxable_minor, tax_minor=chk.tax_minor,
        buyer_state_code=chk.state_code or q.get("place_of_supply"), taxed=chk.purpose != "tip"))
    db.flush()


@job
def announce_boost(danmaku_id: int) -> None:
    from app.video.realtime.rooms import publish
    from app.video.routers.social import danmaku_out
    from app.video.sessions import platform_session

    with platform_session() as db:
        d = db.get(Danmaku, danmaku_id)
        if d is not None and d.status == "visible":
            publish(d.video_id, {"type": "danmaku", "item": danmaku_out(d)})


@job
def announce_live(message_id: int) -> None:
    from app.video.models.community import LiveMessage
    from app.video.models.media import LiveStream
    from app.video.routers.live import emit, message_out
    from app.video.sessions import platform_session

    with platform_session() as db:
        m = db.get(LiveMessage, message_id)
        if m is not None and m.status == "visible":
            emit(db.get(LiveStream, m.stream_id), {"type": m.kind, "item": message_out(m)})
