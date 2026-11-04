from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.core.models.user import User
from app.video.models.ads import BrandProfile, SponsorDeal
from app.video.models.commerce import Checkout, Payment
from app.video.models.media import Video
from app.video.models.payouts import RouteTransfer
from app.video.models.social import Channel, Profile

FAR = timedelta(days=3650)


def now() -> datetime:
    return datetime.now(timezone.utc)


def public_id(db: Session, model, prefix: str) -> str:
    while True:
        pid = prefix + secrets.token_urlsafe(8).replace("-", "x").replace("_", "y")[:10]
        if not db.execute(select(model.id).where(model.public_id == pid)).first():
            return pid


def create_checkout(db: Session, *, user: User, deal: SponsorDeal, idempotency_key: str) -> Checkout:
    from app.video.commerce import splits
    from app.video.commerce.support import _quote
    from app.video.rails import rail_for

    existing = db.execute(select(Checkout).where(Checkout.tenant_id == user.tenant_id,
                                                 Checkout.idempotency_key == idempotency_key)).scalars().first()
    if existing is not None:
        return existing
    if deal.status != "proposed":
        raise err(409, "deal_not_open")
    profile = db.get(Profile, user.id)
    if (profile.country if profile else "IN") != "IN":
        raise err(409, "creator_money_india_only")
    channel = db.get(Channel, deal.channel_id)
    splits.require_selling(db, channel)
    brand = db.execute(select(BrandProfile).where(BrandProfile.tenant_id == deal.tenant_id)).scalars().first()
    q = _quote(db, channel, deal.price_minor, True, brand.state_code if brand else None)
    rail = rail_for("IN")
    order = rail.create_order(amount_minor=deal.price_minor, currency="INR", receipt=f"kvdeal-{deal.id}"[:40],
                              notes={"purpose": "sponsorship", "deal": deal.id}, prefill={"email": user.email, "name": user.name})
    chk = Checkout(tenant_id=user.tenant_id, user_id=user.id, purpose="sponsorship", plan_key=None,
                   taxable_minor=q["taxable_minor"], tax_minor=q["tax_minor"], amount_minor=deal.price_minor, currency="INR",
                   country="IN", state_code=brand.state_code if brand else None, rail=rail.name,
                   gateway_order_id=order.order_id, idempotency_key=idempotency_key,
                   target={"deal_id": deal.id, "deal_public_id": deal.public_id, "title": deal.title,
                           "channel_id": channel.id, "channel_tenant_id": channel.tenant_id, "channel_handle": channel.handle,
                           "client": order.client, "quote": q})
    db.add(chk)
    db.flush()
    return chk


def fund(db: Session, chk: Checkout, payment: Payment) -> None:
    from app.core.models.user import User as U
    from app.video.commerce import splits
    from app.video.commerce.support import _invoice

    t = chk.target or {}
    deal = db.get(SponsorDeal, t.get("deal_id"))
    if deal is None:
        return
    channel = db.get(Channel, deal.channel_id)
    inv = _invoice(db, chk, db.get(U, chk.user_id), channel)
    if inv is not None:
        payment.invoice_id = inv.id
    q = t.get("quote") or {}
    split = splits.record_split(db, splits.Sale(
        source_key=f"sponsorship:{chk.id}", purpose="sponsorship", tenant_id=channel.tenant_id, checkout_id=chk.id,
        payment_id=payment.id, reference=f"CHK-{chk.id}", paid_at=chk.paid_at or now(), currency="INR",
        total_minor=chk.amount_minor, taxable_minor=chk.taxable_minor, tax_minor=chk.tax_minor,
        buyer_state_code=chk.state_code or q.get("place_of_supply"), taxed=True,
        commission_bps=settings.SPONSORSHIP_COMMISSION_BPS))
    if split is not None:
        for tr in db.execute(select(RouteTransfer).where(RouteTransfer.split_id == split.id,
                                                         RouteTransfer.kind == "sale")).scalars():
            tr.hold_until = now() + FAR
            tr.note = f"Held until {deal.public_id} is approved"
        deal.split_id = split.id
    deal.status, deal.checkout_id, deal.funded_at = "funded", chk.id, now()
    notify(db, deal, "funded")
    db.flush()


def deliver(db: Session, deal: SponsorDeal, video: Video) -> None:
    from app.video.commerce.support import hosted

    if deal.status != "funded":
        raise err(409, "deal_not_open")
    if video.channel_id != deal.channel_id or not hosted(video):
        raise err(409, "deal_video_not_eligible")
    other = db.execute(select(Video.id).where(Video.sponsor_deal_id.is_not(None), Video.id == video.id,
                                              Video.sponsor_deal_id != deal.id)).first()
    if other:
        raise err(409, "deal_video_not_eligible")
    video.sponsor_deal_id = deal.id
    deal.video_id, deal.status, deal.delivered_at = video.id, "delivered", now()
    deal.approve_by = now() + timedelta(days=settings.SPONSORSHIP_AUTO_APPROVE_DAYS)
    notify(db, deal, "delivered")
    db.flush()


def approve(db: Session, deal: SponsorDeal, *, auto: bool = False) -> None:
    if deal.status not in ("delivered", "disputed"):
        raise err(409, "deal_not_open")
    deal.status, deal.approved_at, deal.auto_approved = "approved", now(), auto
    if deal.split_id:
        for tr in db.execute(select(RouteTransfer).where(RouteTransfer.split_id == deal.split_id,
                                                         RouteTransfer.kind == "sale",
                                                         RouteTransfer.status.in_(("pending", "held")))).scalars():
            tr.hold_until = now()
            tr.note = f"Approved {deal.public_id}"
    notify(db, deal, "approved")
    db.flush()


def refund(db: Session, deal: SponsorDeal, actor_user_id: int | None, reason: str) -> None:
    from app.video.commerce import refunds

    if deal.status not in ("funded", "delivered", "disputed"):
        raise err(409, "deal_not_open")
    pay = db.execute(select(Payment).where(Payment.checkout_id == deal.checkout_id)).scalars().first()
    if pay is not None and refunds.refunded(db, pay.id) < pay.amount_minor:
        refunds.refund(db, payment_id=pay.id, amount_minor=None, reason=reason[:200], actor_user_id=actor_user_id,
                       idempotency_key=f"deal-refund-{deal.id}")
    deal.status, deal.resolution_note = "refunded", reason[:500]
    notify(db, deal, "refunded")
    db.flush()


def auto_approve(db: Session) -> int:
    n = 0
    for deal in db.execute(select(SponsorDeal).where(SponsorDeal.status == "delivered",
                                                     SponsorDeal.approve_by <= now())).scalars().all():
        approve(db, deal, auto=True)
        n += 1
    db.flush()
    return n


MESSAGES = {
    "funded": "The brand funded the deal. Deliver the video, then link it to the deal.",
    "delivered": "The creator delivered the video. Approve it, or raise a dispute within the review window.",
    "approved": "The deal is approved and the creator's payment is released.",
    "refunded": "The deal was refunded to the brand.",
    "disputed": "The brand raised a dispute. Klygenix will review it.",
}


def notify(db: Session, deal: SponsorDeal, what: str) -> None:
    from app.core.services import mailer
    from app.video.trust.service import owner_email

    link = f"{settings.STUDIO_APP_URL.rstrip('/')}/sponsorships/deals/{deal.public_id}"
    for tid in (deal.tenant_id, deal.channel_tenant_id):
        to, lang = owner_email(db, tid)
        if to:
            mailer.send(db, "deal_event", to, {"title": deal.title, "message": MESSAGES[what], "link": link}, lang, tenant_id=tid)


def label(db: Session, video: Video) -> dict | None:
    if not video.sponsor_deal_id:
        return None
    deal = db.get(SponsorDeal, video.sponsor_deal_id)
    if deal is None:
        return None
    brand = db.execute(select(BrandProfile).where(BrandProfile.tenant_id == deal.tenant_id)).scalars().first()
    return {"brand": brand.name if brand else "a brand", "label": f"Paid partnership with {brand.name if brand else 'a brand'}"}
