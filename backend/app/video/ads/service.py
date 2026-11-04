from __future__ import annotations

import hashlib
import json
import random
import secrets
import time
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.core.models.user import User
from app.core.redis_client import get_redis
from app.video.clock import IST, ist_today
from app.video.ledger.posting import Entry, post
from app.video.models.ads import AdCampaign, AdDaily, AdPayout, BrandProfile
from app.video.models.commerce import Checkout, Payment
from app.video.models.media import Video
from app.video.models.social import Channel, Profile

CREATIVE_MAX_MS = 60_000
MIDROLL_MIN_MS = 8 * 60 * 1000
EVENTS = ("start", "q0", "q1", "mid", "q3", "complete", "skip", "click")
VIEWABLE_MS = 2000
IVT_KEY = "kv:ads:ivt"
TOTALS_KEY = "kv:ads:totals"
IVT_DAYS_KEPT = 400
IMP_TTL = 3 * 3600
_cache: tuple[float, list[dict]] = (0.0, [])


def now() -> datetime:
    return datetime.now(timezone.utc)


def public_id(db: Session, model) -> str:
    while True:
        pid = "A" + secrets.token_urlsafe(8).replace("-", "x").replace("_", "y")[:10]
        if not db.execute(select(model.id).where(model.public_id == pid)).first():
            return pid


def brand_of(db: Session, tenant_id: int) -> BrandProfile | None:
    return db.execute(select(BrandProfile).where(BrandProfile.tenant_id == tenant_id)).scalars().first()


def premium(db: Session, user: User | None) -> bool:
    if user is None:
        return False
    from app.video.commerce.quotas import active_plan

    try:
        return active_plan(db, user.id, "viewer").price_inr_minor > 0
    except RuntimeError:
        return False


def why_not(db: Session, video: Video | None, channel: Channel | None, user: User | None) -> str | None:
    from app.video.commerce.support import hosted

    if not settings.ADS_ENABLED:
        return "ads_off"
    if not hosted(video) or channel is None:
        return "not_hosted"
    if video.kind != "long":
        return "reel"
    if video.made_for_kids:
        return "made_for_kids"
    if video.access != "free":
        return "members_or_paid"
    if video.visibility not in ("public", "unlisted"):
        return "not_public"
    if not (channel.ads_enabled and video.ads_enabled) or channel.is_suspended:
        return "creator_opted_out"
    if user is not None and user.tenant_id == channel.tenant_id:
        return "own_video"
    if premium(db, user):
        return "premium"
    return None


def breaks(db: Session, video: Video) -> list[int]:
    if video.duration_ms < MIDROLL_MIN_MS:
        return []
    from app.video.models.ai import Insight

    chapters = []
    row = db.execute(select(Insight.chapters).where(Insight.video_id == video.id).order_by(Insight.id.desc())).scalars().first()
    for c in row or []:
        try:
            chapters.append(int(c.get("start_ms", c.get("t_ms", 0)) if isinstance(c, dict) else 0))
        except (TypeError, ValueError):
            continue
    out: list[int] = []
    for frac in (1 / 3, 2 / 3):
        want = int(video.duration_ms * frac)
        near = [c for c in chapters if abs(c - want) <= 90_000 and c > 60_000]
        at = min(near, key=lambda c: abs(c - want)) if near else want
        if not out or at - out[-1] >= 4 * 60 * 1000:
            out.append(at)
    return out


def _active(db: Session) -> list[dict]:
    global _cache
    at, rows = _cache
    if time.monotonic() - at < 15:
        return rows
    t = now()
    found = db.execute(select(AdCampaign).where(AdCampaign.status == "active", AdCampaign.creative_video_id.is_not(None),
                                                (AdCampaign.start_at.is_(None)) | (AdCampaign.start_at <= t),
                                                (AdCampaign.end_at.is_(None)) | (AdCampaign.end_at > t),
                                                AdCampaign.spent_minor < AdCampaign.budget_minor)).scalars().all()
    rows = [{"id": c.id, "tenant_id": c.tenant_id, "public_id": c.public_id, "cpm": c.cpm_minor, "budget": c.budget_minor,
             "spent": c.spent_minor, "daily_cap": c.daily_cap_minor, "targeting": c.targeting or {}, "video_id": c.creative_video_id,
             "click_url": c.click_url, "skip": c.skip_after_seconds, "name": c.name,
             "exclude": list(c.exclude_categories or [])} for c in found]
    _cache = (time.monotonic(), rows)
    return rows


def forget_cache() -> None:
    global _cache
    _cache = (0.0, [])


def _milli(r, campaign_id: int) -> int:
    return int(r.get(f"kv:ads:pending:{campaign_id}") or 0)


def _matches(c: dict, *, country: str, language: str, device: str) -> bool:
    t = c["targeting"]
    if t.get("countries") and country not in t["countries"]:
        return False
    if t.get("languages") and language not in t["languages"]:
        return False
    if t.get("devices") and device not in t["devices"]:
        return False
    return True


def viewer_key(user: User | None, ip: str) -> str:
    return f"u{user.id}" if user else "a" + hashlib.sha256(f"{settings.SECRET_KEY}:{ip}".encode()).hexdigest()[:16]


def pick(db: Session, *, video: Video, channel: Channel, country: str, device: str, vkey: str,
         labels: list[str] | None = None) -> dict | None:
    r = get_redis()
    day = ist_today().isoformat()
    if int(r.get(f"kv:ads:cap:{vkey}:hour") or 0) >= settings.ADS_PER_VIEWER_HOUR:
        return None
    pool = []
    for c in _active(db):
        if c["tenant_id"] == channel.tenant_id or c["video_id"] == video.id:
            continue
        if not _matches(c, country=country, language=video.language, device=device):
            continue
        if labels and set(c.get("exclude") or ()) & set(labels):
            continue
        if c["spent"] * 1000 + _milli(r, c["id"]) + c["cpm"] > c["budget"] * 1000:
            continue
        if c["daily_cap"] and int(r.get(f"kv:ads:dayspend:{c['id']}:{day}") or 0) + c["cpm"] > c["daily_cap"] * 1000:
            continue
        if int(r.get(f"kv:ads:cap:{vkey}:{c['id']}:{day}") or 0) >= settings.ADS_FREQ_CAP:
            continue
        pool.append(c)
    if not pool:
        return None
    return random.choices(pool, weights=[c["cpm"] for c in pool])[0]


def _ivt_day(day: str) -> str:
    return f"kv:ads:ivt:d:{day}"


def note_ivt(reason: str, n: int = 1) -> None:
    try:
        pipe = get_redis().pipeline()
        pipe.hincrby(IVT_KEY, reason, n)
        pipe.hincrby(_ivt_day(ist_today().isoformat()), reason, n)
        pipe.expire(_ivt_day(ist_today().isoformat()), IVT_DAYS_KEPT * 86400)
        pipe.execute()
    except Exception:
        pass


def decide(db: Session, *, video: Video, channel: Channel, user: User | None, slot: str, ip: str, country: str,
           device: str, user_agent: str | None = None) -> dict | None:
    from app.video.ads import integrity

    if why_not(db, video, channel, user):
        return None
    if integrity.is_bot(user_agent):
        note_ivt("bot_ua")
        return None
    vkey = viewer_key(user, ip)
    c = pick(db, video=video, channel=channel, country=country, device=device, vkey=vkey,
             labels=integrity.labels_for(db, video))
    if c is None:
        return None
    creative = db.get(Video, c["video_id"])
    if creative is None or creative.status != "published":
        return None
    from app.video.media.providers import provider

    imp = secrets.token_urlsafe(18)
    get_redis().setex(f"kv:ads:imp:{imp}", IMP_TTL, json.dumps({
        "c": c["id"], "cpm": c["cpm"], "v": video.id, "ct": channel.tenant_id, "bt": c["tenant_id"], "vk": vkey,
        "slot": slot, "day": ist_today().isoformat(), "dev": device, "dur": creative.duration_ms,
        "dc": integrity.datacentre(ip), "ip": ip}))
    brand = brand_of(db, c["tenant_id"])
    return {"token": imp, "campaign": c["public_id"], "brand": brand.name if brand else c["name"], "label": "Ad",
            "slot": slot, "skip_after_seconds": c["skip"], "click_url": c["click_url"], "duration_ms": creative.duration_ms,
            "playback": provider(creative.provider).playback(creative, 3600)}


def burst(ip: str | None, user_id: int | None) -> bool:
    from app.core.services.rate_limit import _exempt

    r = get_redis()
    hot = False
    window = 600
    for key, exempt in ((f"kv:ads:burst:ip:{ip}", _exempt(ip)), (f"kv:ads:burst:u:{user_id}", user_id is None)):
        if exempt:
            continue
        n = r.incr(key)
        if n == 1:
            r.expire(key, window)
        hot = hot or n > settings.ADS_IVT_MAX_PER_10M
    return hot


def _invalid(imp: dict, kind: str, *, ip: str | None, user: User | None, now_ms: int, r) -> str | None:
    if imp.get("dc"):
        return "datacentre"
    if viewer_key(user, ip or "") != imp["vk"]:
        return "viewer_mismatch"
    started = r.get(f"kv:ads:imp:{imp['_t']}:t0")
    if kind != "start" and started is None:
        return "no_start"
    if kind == "q0":
        if now_ms - int(started) < VIEWABLE_MS - 250:
            return "too_fast"
        if burst(ip, user.id if user else None):
            return "burst"
    if kind == "complete" and now_ms - int(started) < max(int(imp.get("dur") or 0) // 2 - 500, 0):
        return "complete_too_fast"
    return None


def event(token: str, kind: str, *, ip: str | None = None, user: User | None = None) -> bool:
    if kind not in EVENTS:
        raise err(400, "action_not_allowed")
    r = get_redis()
    raw = r.get(f"kv:ads:imp:{token}")
    if raw is None:
        return False
    imp = json.loads(raw)
    imp["_t"] = token
    seen = f"kv:ads:imp:{token}:ev"
    if r.sismember(seen, kind):
        return False
    now_ms = int(time.time() * 1000)
    bad = _invalid(imp, kind, ip=ip, user=user, now_ms=now_ms, r=r)
    if kind in ("complete", "click", "q1", "mid", "q3") and r.sismember(seen, "invalid"):
        bad = bad or "after_invalid"
    r.sadd(seen, kind)
    r.expire(seen, IMP_TTL)
    field = f"{imp['c']}:{imp['v']}:{imp['ct']}:{imp['bt']}:{imp['day']}:{imp.get('dev') or 'desktop'}"
    pipe = r.pipeline()
    if bad:
        if kind == "q0":
            pipe.sadd(seen, "invalid")
            pipe.hincrby("kv:ads:counts", f"{field}:invalid", 1)
            pipe.hincrby(TOTALS_KEY, "invalid", 1)
            pipe.hincrby(_ivt_day(imp["day"]), "_invalid", 1)
        pipe.hincrby(IVT_KEY, bad, 1)
        pipe.hincrby(_ivt_day(imp["day"]), bad, 1)
        pipe.expire(_ivt_day(imp["day"]), IVT_DAYS_KEPT * 86400)
        pipe.execute()
        return False
    day = imp["day"]
    if kind == "start":
        pipe.setex(f"kv:ads:imp:{token}:t0", IMP_TTL, now_ms)
        pipe.hincrby("kv:ads:counts", f"{field}:start", 1)
        pipe.incr(f"kv:ads:cap:{imp['vk']}:{imp['c']}:{day}")
        pipe.expire(f"kv:ads:cap:{imp['vk']}:{imp['c']}:{day}", 2 * 86400)
        pipe.incr(f"kv:ads:cap:{imp['vk']}:hour")
        pipe.expire(f"kv:ads:cap:{imp['vk']}:hour", 3600)
    elif kind == "q0":
        pipe.hincrby("kv:ads:counts", f"{field}:q0", 1)
        pipe.hincrby(TOTALS_KEY, "billable", 1)
        pipe.hincrby(_ivt_day(day), "_billable", 1)
        pipe.expire(_ivt_day(day), IVT_DAYS_KEPT * 86400)
        pipe.incrby(f"kv:ads:pending:{imp['c']}", imp["cpm"])
        pipe.incrby(f"kv:ads:dayspend:{imp['c']}:{day}", imp["cpm"])
        pipe.expire(f"kv:ads:dayspend:{imp['c']}:{day}", 2 * 86400)
    elif kind in ("complete", "skip", "click"):
        if not r.sismember(seen, "q0"):
            pipe.execute()
            return False
        pipe.hincrby("kv:ads:counts", f"{field}:{kind}", 1)
    pipe.execute()
    return True


COLS = {"start": "starts", "q0": "impressions", "invalid": "invalid", "complete": "completes", "skip": "skips", "click": "clicks"}


def flush(db: Session) -> int:
    r = get_redis()
    tmp = f"kv:ads:counts:flush:{secrets.token_hex(4)}"
    try:
        if not r.renamenx("kv:ads:counts", tmp):
            return 0
    except Exception:
        return 0
    data = r.hgetall(tmp)
    rows: dict[tuple, dict] = {}
    for k, v in data.items():
        k = k.decode() if isinstance(k, bytes) else k
        parts = k.split(":")
        if len(parts) == 6:
            parts.insert(5, "desktop")
        cid, vid, ct, bt, day, dev, kind = parts
        col = COLS.get(kind)
        if col is None:
            continue
        key = (int(cid), int(vid), int(ct), int(bt), day, dev)
        rows.setdefault(key, {})[col] = rows.get(key, {}).get(col, 0) + int(v)
    touched: dict[int, int] = {}
    for (cid, vid, ct, bt, day, dev), cols in rows.items():
        stmt = insert(AdDaily).values(tenant_id=bt, campaign_id=cid, video_id=vid, channel_tenant_id=ct,
                                      day=date.fromisoformat(day), device=dev[:8], **{c: n for c, n in cols.items()})
        stmt = stmt.on_conflict_do_update(constraint="uq_ad_daily", set_={
            c: getattr(AdDaily, c) + stmt.excluded[c] for c in cols})
        db.execute(stmt)
        touched[cid] = touched.get(cid, 0) + cols.get("impressions", 0)
    for cid, imps in touched.items():
        c = db.get(AdCampaign, cid)
        if c is None:
            continue
        for row in db.execute(select(AdDaily).where(AdDaily.campaign_id == cid)).scalars():
            row.spend_minor = row.impressions * c.cpm_minor // 1000
        total = db.execute(select(func.coalesce(func.sum(AdDaily.impressions), 0)).where(AdDaily.campaign_id == cid)).scalar()
        c.spent_minor = min(int(total) * c.cpm_minor // 1000, c.budget_minor)
        if imps:
            r.decrby(f"kv:ads:pending:{cid}", imps * c.cpm_minor)
        if c.status == "active" and c.spent_minor >= c.budget_minor:
            c.status, c.review_note = "ended", "Budget spent."
    db.flush()
    r.delete(tmp)
    forget_cache()
    return len(rows)


def platform_tenant(db: Session) -> int:
    from app.video.commerce.splits import platform_tenant_id

    return platform_tenant_id(db)


def accrue(db: Session) -> int:
    from app.video.services.provisioning import ensure_books

    pid = platform_tenant(db)
    ensure_books(db, pid)
    n = 0
    for c in db.execute(select(AdCampaign).where(AdCampaign.spent_minor > AdCampaign.accrued_minor)).scalars().all():
        amount = c.spent_minor - c.accrued_minor
        post(db, tenant_id=pid, business_date=ist_today(), source_type="ad_accrual", source_id=c.id,
             idempotency_key=f"ad_accrual:{c.id}:{c.spent_minor}", currency="INR",
             memo=f"Ad delivery {c.public_id}",
             lines=Entry(db, pid).dr("ad_unearned", amount).cr("ad_income", amount))
        c.accrued_minor = c.spent_minor
        n += 1
    db.flush()
    return n


def quote(db: Session, brand: BrandProfile, amount: int) -> dict:
    from app.video.commerce.splits import platform_state
    from app.video.tax.gst import rate_for

    rate, sac = rate_for(db, "PLATFORM", ist_today())
    tax = (amount * rate * 2 + 10_000) // 20_000 if rate else 0
    home = platform_state(db)
    pos = brand.state_code or home
    cg = sg = ig = 0
    if pos and home and pos == home:
        cg = tax // 2
        sg = tax - cg
    else:
        ig = tax
    return {"taxable_minor": amount, "tax_minor": tax, "rate_bps": rate, "sac": sac, "place_of_supply": pos,
            "cgst_minor": cg, "sgst_minor": sg, "igst_minor": ig, "amount_minor": amount + tax}


def create_checkout(db: Session, *, user: User, campaign: AdCampaign, amount: int, idempotency_key: str) -> Checkout:
    from app.video.rails import rail_for

    existing = db.execute(select(Checkout).where(Checkout.tenant_id == user.tenant_id,
                                                 Checkout.idempotency_key == idempotency_key)).scalars().first()
    if existing is not None:
        return existing
    if not settings.ADS_MIN_TOPUP_MINOR <= amount <= settings.ADS_MAX_TOPUP_MINOR:
        raise err(400, "ad_budget_out_of_range", low=settings.ADS_MIN_TOPUP_MINOR // 100, high=settings.ADS_MAX_TOPUP_MINOR // 100)
    brand = brand_of(db, campaign.tenant_id)
    if brand is None or brand.status != "active":
        raise err(409, "brand_profile_needed")
    profile = db.get(Profile, user.id)
    if (profile.country if profile else "IN") != "IN":
        raise err(409, "creator_money_india_only")
    q = quote(db, brand, amount)
    rail = rail_for("IN")
    order = rail.create_order(amount_minor=q["amount_minor"], currency="INR", receipt=f"kvads-{campaign.id}"[:40],
                              notes={"purpose": "ad_budget", "campaign": campaign.id}, prefill={"email": user.email, "name": user.name})
    chk = Checkout(tenant_id=user.tenant_id, user_id=user.id, purpose="ad_budget", plan_key=None,
                   taxable_minor=q["taxable_minor"], tax_minor=q["tax_minor"], amount_minor=q["amount_minor"], currency="INR",
                   country="IN", state_code=brand.state_code, rail=rail.name, gateway_order_id=order.order_id,
                   idempotency_key=idempotency_key,
                   target={"campaign_id": campaign.id, "campaign_public_id": campaign.public_id, "client": order.client, "quote": q})
    db.add(chk)
    db.flush()
    return chk


def _invoice(db: Session, chk: Checkout, brand: BrandProfile, campaign: AdCampaign):
    from app.video.commerce.service import admin_tenant
    from app.video.models.tax import TaxInvoice
    from app.video.services.numbering import next_number

    seller = admin_tenant(db)
    q = (chk.target or {}).get("quote") or {}
    inv = TaxInvoice(
        tenant_id=seller.id, kind="invoice", number=next_number(db, tenant_id=seller.id, series="KVA", day=ist_today()),
        invoice_date=ist_today(), order_id=chk.id,
        seller={"name": seller.name, "address": seller.address, "email": seller.email, "gstin": seller.gst_number,
                "order_number": f"CHK-{chk.id}"},
        buyer={"name": brand.name, "email": brand.contact_email, "gstin": brand.gstin, "country": "IN", "state": brand.state_code},
        place_of_supply=q.get("place_of_supply"),
        lines=[{"title": f"Advertising on Klygenix Play — campaign {campaign.public_id}", "sac": q.get("sac"),
                "taxable_minor": chk.taxable_minor, "tax_rate_bps": q.get("rate_bps", 0), "tax_minor": chk.tax_minor,
                "total_minor": chk.amount_minor}],
        taxable_minor=chk.taxable_minor, cgst_minor=q.get("cgst_minor", 0), sgst_minor=q.get("sgst_minor", 0),
        igst_minor=q.get("igst_minor", 0), total_minor=chk.amount_minor, currency="INR")
    db.add(inv)
    db.flush()
    return inv


def fund(db: Session, chk: Checkout, payment: Payment) -> None:
    from app.video.services.provisioning import ensure_books

    c = db.get(AdCampaign, (chk.target or {}).get("campaign_id"))
    if c is None:
        return
    brand = brand_of(db, c.tenant_id)
    c.budget_minor += chk.taxable_minor
    inv = _invoice(db, chk, brand, c)
    payment.invoice_id = inv.id
    pid = platform_tenant(db)
    ensure_books(db, pid)
    j = post(db, tenant_id=pid, business_date=ist_today(), source_type="ad_budget", source_id=payment.id,
             idempotency_key=f"ad-budget-{payment.id}", currency="INR", memo=f"Ad budget for {c.public_id}",
             lines=Entry(db, pid).dr("gateway_clearing", chk.amount_minor - payment.fee_minor - payment.tax_on_fee_minor)
             .dr("gateway_fees", payment.fee_minor).dr("tax_input", payment.tax_on_fee_minor)
             .cr("ad_unearned", chk.taxable_minor).cr("tax_output_cgst", inv.cgst_minor)
             .cr("tax_output_sgst", inv.sgst_minor).cr("tax_output_igst", inv.igst_minor))
    payment.journal_id = j.id
    forget_cache()
    db.flush()


def on_refund(db: Session, chk: Checkout, payment: Payment, amount: int) -> None:
    c = db.get(AdCampaign, (chk.target or {}).get("campaign_id"))
    if c is None:
        return
    taxable = (amount * chk.taxable_minor * 2 + chk.amount_minor) // (2 * chk.amount_minor) if chk.amount_minor else amount
    tax = amount - taxable
    c.budget_minor = max(c.budget_minor - taxable, c.spent_minor)
    c.refunded_minor += taxable
    pid = platform_tenant(db)
    q = (chk.target or {}).get("quote") or {}
    intra = bool(q.get("cgst_minor"))
    post(db, tenant_id=pid, business_date=ist_today(), source_type="ad_refund", source_id=payment.id,
         idempotency_key=f"ad-refund-{payment.id}-{c.refunded_minor}", currency="INR", memo=f"Unspent ad budget {c.public_id}",
         lines=Entry(db, pid).dr("ad_unearned", taxable).dr("tax_output_cgst", tax // 2 if intra else 0)
         .dr("tax_output_sgst", tax - tax // 2 if intra else 0).dr("tax_output_igst", 0 if intra else tax)
         .cr("gateway_clearing", amount))
    forget_cache()
    db.flush()


def unspent(c: AdCampaign) -> int:
    return max(c.budget_minor - c.spent_minor, 0)


def end(db: Session, c: AdCampaign, actor_user_id: int | None, reason: str) -> int:
    from app.video.commerce import refunds

    c.status = "ended"
    c.review_note = reason[:500]
    flush(db)
    accrue(db)
    left = unspent(c)
    back = 0
    if left > 0:
        pays = db.execute(select(Payment, Checkout).join(Checkout, Checkout.id == Payment.checkout_id)
                          .where(Checkout.purpose == "ad_budget", Checkout.target["campaign_id"].as_integer() == c.id)
                          .order_by(Payment.id.desc())).all()
        for pay, chk in pays:
            if left <= 0:
                break
            room_tax = pay.amount_minor - refunds.refunded(db, pay.id)
            room = room_tax * chk.taxable_minor // chk.amount_minor if chk.amount_minor else room_tax
            take = min(room, left)
            if take <= 0:
                continue
            gross = (take * chk.amount_minor * 2 + chk.taxable_minor) // (2 * chk.taxable_minor) if chk.taxable_minor else take
            gross = min(gross, room_tax)
            refunds.refund(db, payment_id=pay.id, amount_minor=gross, reason="Unspent ad budget",
                           actor_user_id=actor_user_id, idempotency_key=f"ad-unspent-{c.id}-{pay.id}-{c.spent_minor}")
            left -= take
            back += gross
    forget_cache()
    db.flush()
    return back


def share_period(day: date | None = None) -> str:
    d = (day or ist_today()).replace(day=1) - timedelta(days=1)
    return d.strftime("%Y-%m")


def pay_shares(db: Session, period: str) -> list[AdPayout]:
    from app.video.commerce.splits import payout_account
    from app.video.models.payouts import RouteTransfer
    from app.video.rails.base import RailError
    from app.video.rails.route import route_client
    from app.video.services.provisioning import ensure_books

    y, m = (int(x) for x in period.split("-"))
    start = date(y, m, 1)
    stop = date(y + (m == 12), m % 12 + 1, 1)
    flush(db)
    accrue(db)
    pid = platform_tenant(db)
    ensure_books(db, pid)
    out = []
    rows = db.execute(select(AdDaily.channel_tenant_id, func.sum(AdDaily.impressions), func.sum(AdDaily.spend_minor))
                      .where(AdDaily.day >= start, AdDaily.day < stop).group_by(AdDaily.channel_tenant_id)).all()
    for ct, imps, spend in rows:
        if db.execute(select(AdPayout.id).where(AdPayout.tenant_id == ct, AdPayout.period == period,
                                                AdPayout.kind == "ad_share")).first():
            continue
        share = int(spend) * settings.ADS_CREATOR_SHARE_BPS // 10_000
        p = AdPayout(tenant_id=ct, period=period, impressions=int(imps), spend_minor=int(spend),
                     share_bps=settings.ADS_CREATOR_SHARE_BPS, share_minor=share, status="pending")
        db.add(p)
        db.flush()
        acct = payout_account(db, ct)
        if share <= 0:
            p.status, p.note = "skipped", "Nothing to share."
            out.append(p)
            continue
        party = {"party_type": "tenant", "party_id": ct}
        post(db, tenant_id=pid, business_date=ist_today(), source_type="ad_share", source_id=p.id,
             idempotency_key=f"ad-share:{ct}:{period}", currency="INR", memo=f"Creator ad share {period} (tenant {ct})",
             lines=Entry(db, pid).dr("ad_share_expense", share).cr("seller_payable", share, **party))
        ensure_books(db, ct)
        post(db, tenant_id=ct, business_date=ist_today(), source_type="ad_share", source_id=p.id,
             idempotency_key=f"ad-share-in:{ct}:{period}", currency="INR", memo=f"Ad revenue share {period}",
             lines=Entry(db, ct).dr("payout_clearing", share).cr("ad_share_income", share))
        t = RouteTransfer(tenant_id=ct, payout_account_id=acct.id if acct else None, split_id=None, kind="ad_share",
                          amount_minor=share, status="pending", note=f"Ad revenue share {period}")
        db.add(t)
        db.flush()
        p.route_transfer_id = t.id
        if acct is None or acct.status != "activated":
            p.note = "Waiting for an activated payout account."
            out.append(p)
            continue
        try:
            t.gateway_transfer_id = route_client().direct_transfer(account_id=acct.gateway_account_id, amount_minor=share,
                                                                   notes={"kind": "ad_share", "period": period, "tenant": ct})
            t.status, t.released_at = "released", now()
            post(db, tenant_id=pid, business_date=ist_today(), source_type="ad_share_paid", source_id=p.id,
                 idempotency_key=f"ad-share-paid:{ct}:{period}", currency="INR", memo=f"Ad share paid {period}",
                 lines=Entry(db, pid).dr("seller_payable", share, **party).cr("bank", share))
            p.status = "released"
        except RailError as exc:
            t.error = p.note = str(exc)[:300]
            p.status = "failed"
        out.append(p)
    db.flush()
    return out


def report(db: Session, campaign_id: int) -> dict:
    rows = db.execute(select(AdDaily.day, func.sum(AdDaily.impressions), func.sum(AdDaily.completes), func.sum(AdDaily.skips),
                             func.sum(AdDaily.clicks), func.sum(AdDaily.spend_minor), func.sum(AdDaily.starts),
                             func.sum(AdDaily.invalid))
                      .where(AdDaily.campaign_id == campaign_id).group_by(AdDaily.day).order_by(AdDaily.day)).all()
    days = [{"day": d.isoformat(), "impressions": int(i), "completes": int(c), "skips": int(s), "clicks": int(k),
             "spend_minor": int(sp), "starts": int(st), "invalid": int(iv)} for d, i, c, s, k, sp, st, iv in rows]
    tot = {k: sum(d[k] for d in days) for k in ("impressions", "completes", "skips", "clicks", "spend_minor", "starts", "invalid")}
    tot["invalid_bps"] = tot["invalid"] * 10_000 // (tot["invalid"] + tot["impressions"]) if tot["invalid"] + tot["impressions"] else 0
    tot["ctr_bps"] = tot["clicks"] * 10_000 // tot["impressions"] if tot["impressions"] else 0
    tot["completion_bps"] = tot["completes"] * 10_000 // tot["impressions"] if tot["impressions"] else 0
    return {"days": days, "totals": tot}


def first_of_month_ist() -> bool:
    t = datetime.now(IST)
    return t.day == 1 and t.hour == 6 and t.minute == 0


def export_rows(db: Session, campaign_id: int, by: str) -> list[list]:
    from app.video.models.media import Video as V

    if by == "device":
        rows = db.execute(select(AdDaily.device, func.sum(AdDaily.impressions), func.sum(AdDaily.completes), func.sum(AdDaily.clicks),
                                 func.sum(AdDaily.invalid), func.sum(AdDaily.spend_minor))
                          .where(AdDaily.campaign_id == campaign_id).group_by(AdDaily.device).order_by(AdDaily.device)).all()
        return [["device", "impressions", "completes", "clicks", "invalid", "spend_minor"]] + [list(map(_cell, r)) for r in rows]
    if by == "category":
        acc: dict[str, list[int]] = {}
        for vid, i, c, k, iv, sp in db.execute(select(AdDaily.video_id, func.sum(AdDaily.impressions), func.sum(AdDaily.completes),
                                                      func.sum(AdDaily.clicks), func.sum(AdDaily.invalid), func.sum(AdDaily.spend_minor))
                                               .where(AdDaily.campaign_id == campaign_id).group_by(AdDaily.video_id)).all():
            v = db.get(V, vid)
            for cat in (v.safety_labels or ["uncategorised"]) if v is not None else ["uncategorised"]:
                row = acc.setdefault(cat, [0, 0, 0, 0, 0])
                for n, val in enumerate((i, c, k, iv, sp)):
                    row[n] += int(val)
        return [["category", "impressions", "completes", "clicks", "invalid", "spend_minor"]] + [[k, *v] for k, v in sorted(acc.items())]
    rep = report(db, campaign_id)
    return [["day", "impressions", "starts", "completes", "skips", "clicks", "invalid", "spend_minor"]] + [
        [d["day"], d["impressions"], d["starts"], d["completes"], d["skips"], d["clicks"], d["invalid"], d["spend_minor"]]
        for d in rep["days"]]


def _cell(v):
    return v if isinstance(v, str) else int(v)


def ivt_summary(start: date | None = None, stop: date | None = None) -> dict:
    r = get_redis()
    if start is None and stop is None:
        reasons = {(k.decode() if isinstance(k, bytes) else k): int(v) for k, v in r.hgetall(IVT_KEY).items()}
        totals = {(k.decode() if isinstance(k, bytes) else k): int(v) for k, v in r.hgetall(TOTALS_KEY).items()}
        return {"reasons": reasons, "billable": totals.get("billable", 0), "invalid": totals.get("invalid", 0)}
    stop = stop or ist_today()
    start = max(start or stop - timedelta(days=29), stop - timedelta(days=IVT_DAYS_KEPT - 1))
    pipe = r.pipeline()
    days = [start + timedelta(days=i) for i in range((stop - start).days + 1)]
    for d in days:
        pipe.hgetall(_ivt_day(d.isoformat()))
    merged: dict[str, int] = {}
    for row in pipe.execute():
        for k, v in row.items():
            key = k.decode() if isinstance(k, bytes) else k
            merged[key] = merged.get(key, 0) + int(v)
    billable, invalid = merged.pop("_billable", 0), merged.pop("_invalid", 0)
    return {"reasons": merged, "billable": billable, "invalid": invalid, "from": start.isoformat(), "to": stop.isoformat()}


def _month(period: str) -> tuple[date, date]:
    y, m = (int(x) for x in period.split("-"))
    return date(y, m, 1), date(y + (m == 12), m % 12 + 1, 1)


def view_pool(db: Session, period: str) -> dict:
    from app.video.commerce.splits import payout_account
    from app.video.commerce.support import hosted
    from app.video.models.social import ViewDaily

    start, stop = _month(period)
    spend = db.execute(select(func.coalesce(func.sum(AdDaily.spend_minor), 0))
                       .where(AdDaily.day >= start, AdDaily.day < stop)).scalar() or 0
    share = int(spend) * settings.ADS_CREATOR_SHARE_BPS // 10_000
    net = int(spend) - share
    pool = net * settings.ADS_VIEW_POOL_BPS // 10_000
    rows = db.execute(select(ViewDaily.tenant_id, ViewDaily.video_id, func.sum(ViewDaily.watch_ms), func.sum(ViewDaily.views),
                             func.sum(ViewDaily.completions))
                      .where(ViewDaily.day >= start, ViewDaily.day < stop)
                      .group_by(ViewDaily.tenant_id, ViewDaily.video_id)).all()
    per: dict[int, int] = {}
    vids = {v.id: v for v in db.execute(select(Video).where(Video.id.in_({r[1] for r in rows}))).scalars()} if rows else {}
    for tid, vid, ms, views, done in rows:
        v = vids.get(vid)
        if v is None or not hosted(v) or v.access != "free" or v.kind not in ("long", "reel"):
            continue
        quality = min(1.0, 0.5 + (int(done) / int(views) if views else 0))
        per[tid] = per.get(tid, 0) + int(int(ms) * quality)
    floor = settings.VIEW_POOL_MIN_MINUTES * 60_000
    eligible = {t: ms for t, ms in per.items() if ms >= floor}
    total = sum(eligible.values())
    creators = []
    paid = 0
    for t, ms in sorted(eligible.items(), key=lambda kv: -kv[1]):
        amount = pool * ms // total if total else 0
        paid += amount
        acct = payout_account(db, t)
        ch = db.execute(select(Channel).where(Channel.tenant_id == t)).scalars().first()
        creators.append({"tenant_id": t, "channel": {"handle": ch.handle, "name": ch.name} if ch else None, "qualified_ms": ms, "share_bps": ms * 10_000 // total if total else 0,
                         "amount_minor": amount, "payouts_ready": bool(acct and acct.status == "activated")})
    return {"period": period, "ad_spend_minor": int(spend), "creator_ad_share_minor": share, "net_ad_revenue_minor": net,
            "pool_bps": settings.ADS_VIEW_POOL_BPS, "pool_minor": pool, "allocated_minor": paid,
            "min_minutes": settings.VIEW_POOL_MIN_MINUTES, "below_floor": len(per) - len(eligible), "creators": creators}


def pay_view_pool(db: Session, period: str) -> list[AdPayout]:
    from app.video.commerce.splits import payout_account
    from app.video.models.payouts import RouteTransfer
    from app.video.rails.base import RailError
    from app.video.rails.route import route_client
    from app.video.services.provisioning import ensure_books

    flush(db)
    accrue(db)
    plan = view_pool(db, period)
    pid = platform_tenant(db)
    ensure_books(db, pid)
    out = []
    for c in plan["creators"]:
        ct, amount = c["tenant_id"], c["amount_minor"]
        if db.execute(select(AdPayout.id).where(AdPayout.tenant_id == ct, AdPayout.period == period,
                                                AdPayout.kind == "view_pool")).first():
            continue
        p = AdPayout(tenant_id=ct, period=period, kind="view_pool", watch_ms=c["qualified_ms"], spend_minor=plan["pool_minor"],
                     share_bps=c["share_bps"], share_minor=amount, status="pending")
        db.add(p)
        db.flush()
        if amount <= 0:
            p.status, p.note = "skipped", "Nothing to share."
            out.append(p)
            continue
        party = {"party_type": "tenant", "party_id": ct}
        post(db, tenant_id=pid, business_date=ist_today(), source_type="view_pool", source_id=p.id,
             idempotency_key=f"view-pool:{ct}:{period}", currency="INR", memo=f"View pool {period} (tenant {ct})",
             lines=Entry(db, pid).dr("ad_share_expense", amount).cr("seller_payable", amount, **party))
        ensure_books(db, ct)
        post(db, tenant_id=ct, business_date=ist_today(), source_type="view_pool", source_id=p.id,
             idempotency_key=f"view-pool-in:{ct}:{period}", currency="INR", memo=f"View pool {period}",
             lines=Entry(db, ct).dr("payout_clearing", amount).cr("ad_share_income", amount))
        acct = payout_account(db, ct)
        t = RouteTransfer(tenant_id=ct, payout_account_id=acct.id if acct else None, split_id=None, kind="view_pool",
                          amount_minor=amount, status="pending", note=f"View pool {period}")
        db.add(t)
        db.flush()
        p.route_transfer_id = t.id
        if acct is None or acct.status != "activated":
            p.note = "Waiting for an activated payout account."
            out.append(p)
            continue
        try:
            t.gateway_transfer_id = route_client().direct_transfer(account_id=acct.gateway_account_id, amount_minor=amount,
                                                                   notes={"kind": "view_pool", "period": period, "tenant": ct})
            t.status, t.released_at = "released", now()
            post(db, tenant_id=pid, business_date=ist_today(), source_type="view_pool_paid", source_id=p.id,
                 idempotency_key=f"view-pool-paid:{ct}:{period}", currency="INR", memo=f"View pool paid {period}",
                 lines=Entry(db, pid).dr("seller_payable", amount, **party).cr("bank", amount))
            p.status = "released"
        except RailError as exc:
            t.error = p.note = str(exc)[:300]
            p.status = "failed"
        out.append(p)
    db.flush()
    return out
