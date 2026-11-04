"""V5.1 ads on hosted videos (sandbox rail): eligibility, decisions, events, caps, budget, accrual, creator share, refunds."""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from harness import (PAYOUT_ACCOUNT, admin_login, check, client, creator, finish, ok, premium, settled, signup, sql, upload,
                     wait_for)

import harness  # noqa: E402

BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
_plain_client = harness.client


def _browser_client(token=None):
    c = _plain_client(token)
    c.headers["User-Agent"] = BROWSER
    return c


harness.client = _browser_client

from app.config import settings  # noqa: E402
from app.video.ads import service as ads
from app.video.sessions import platform_session

admin = admin_login()
sql("UPDATE kv_commerce.ad_campaigns SET status = 'ended', review_note = 'closed by a later suite run' WHERE status IN ('active','paused','review')")
IST = timezone(timedelta(hours=5, minutes=30))
MONTH = datetime.now(IST).strftime("%Y-%m")


def pay(c, chk_id: int) -> None:
    r = c.post(f"/api/video/sandbox/pay/{chk_id}")
    assert r.status_code == 200, r.text
    wait_for(lambda: c.get(f"/api/video/checkout/{chk_id}").json()["status"] == "paid", 30, 0.2)


def flush() -> None:
    with platform_session() as db:
        ads.flush(db)
        db.commit()


print("\n== a host channel with a long video")
host = creator("Ads Host")
host.put("/api/video/studio/earnings/account", json={**PAYOUT_ACCOUNT, "email": "ads.host@example.com"})
check("host payouts activated", host.post("/api/video/studio/earnings/account/submit").json()["account"]["status"], "activated")
long_v = settled(host, upload(host, "azure-apim-auth", "Long talk for ads")["id"])
reel_v = settled(host, upload(host, "reel-chai", "A reel")["id"])
check("long video published", (long_v["status"], long_v["kind"]), ("published", "long"))
anon = client()
b = anon.get(f"/api/video/ads/breaks?video={long_v['public_id']}").json()
check("ads are off until the creator opts in", (b["eligible"], b["reason"]), (False, "creator_opted_out"))
check("opt in", host.put("/api/video/studio/ads/settings", json={"ads_enabled": True}).json(), {"ads_enabled": True})
b = anon.get(f"/api/video/ads/breaks?video={long_v['public_id']}").json()
check("eligible: pre-roll, no mid-rolls under 8 min", (b["eligible"], b["pre"], b["mid"]), (True, True, []))
check("never on reels", anon.get(f"/api/video/ads/breaks?video={reel_v['public_id']}").json()["reason"], "reel")
with platform_session() as db:
    fake = SimpleNamespace(id=-1, duration_ms=20 * 60 * 1000)
    check("mid-rolls at about a third and two thirds of a 20-minute video", ads.breaks(db, fake), [400000, 800000])

print("\n== a brand, a creative and a campaign")
brand = creator("Chai Brand")
check("brand profile needed first", brand.post("/api/video/studio/ads/campaigns", json={
    "name": "First try", "click_url": "https://example.com", "cpm_minor": 20000}).status_code, 409)
r = brand.put("/api/video/studio/brand", json={"name": "Chai Point", "contact_email": "ads@chaipoint.example",
                                                "website": "https://chaipoint.example", "gstin": "29ABCDE1234F1Z5"})
check("brand profile with GSTIN sets the state", (r.status_code, r.json()["brand"]["state_code"]), (200, "29"))
creative = settled(brand, upload(brand, "reel-three-tips", "Chai Point ad", visibility="unlisted")["id"])
check("creative scanned and published (unlisted)", (creative["status"], creative["visibility"]), ("published", "unlisted"))
base = {"name": "Monsoon chai", "creative_video_id": creative["public_id"], "click_url": "https://chaipoint.example/monsoon",
        "countries": ["IN"]}
check("CPM floor", brand.post("/api/video/studio/ads/campaigns", json={**base, "cpm_minor": 100}).status_code, 400)
check("http click URLs refused", brand.post("/api/video/studio/ads/campaigns", json={**base, "cpm_minor": 20000,
                                                                                      "click_url": "http://x.example"}).status_code, 422)
check("someone else's video is not a creative", brand.post("/api/video/studio/ads/campaigns", json={
    **base, "cpm_minor": 20000, "creative_video_id": long_v["public_id"]}).status_code, 409)
camp = brand.post("/api/video/studio/ads/campaigns", json={**base, "cpm_minor": 20000}).json()
check("draft campaign", (camp["status"], camp["budget_minor"]), ("draft", 0))
check("submitted for review", brand.post(f"/api/video/studio/ads/campaigns/{camp['id']}/submit").json()["status"], "review")
check("locked while in review", brand.put(f"/api/video/studio/ads/campaigns/{camp['id']}", json={**base, "cpm_minor": 30000}).status_code, 409)
check("a viewer cannot reach ad admin", signup("Nosy Ads").get("/api/video/admin/ads/campaigns").status_code, 403)
r = admin.post(f"/api/video/admin/ads/campaigns/{camp['id']}/review", json={"decision": "approve", "note": "Fine"})
check("approved", r.json()["status"], "active")
check("no budget, no ads yet", anon.get(f"/api/video/ads/decision?video={long_v['public_id']}").json()["ad"], None)

print("\n== funding (₹1,000 + GST on the sandbox rail)")
check("top-up below the minimum", brand.post(f"/api/video/studio/ads/campaigns/{camp['id']}/fund",
                                             json={"amount_minor": 5000, "idempotency_key": uuid.uuid4().hex}).status_code, 400)
chk = brand.post(f"/api/video/studio/ads/campaigns/{camp['id']}/fund",
                 json={"amount_minor": 100000, "idempotency_key": uuid.uuid4().hex}).json()
check("GST added on top", (chk["taxable_minor"], chk["tax_minor"], chk["amount_minor"]), (100000, 18000, 118000))
pay(brand, chk["id"])
c2 = brand.get(f"/api/video/studio/ads/campaigns/{camp['id']}").json()
check("budget credited", (c2["budget_minor"], c2["remaining_minor"]), (100000, 100000))
inv = sql("SELECT number, cgst_minor, sgst_minor, igst_minor, buyer->>'gstin' FROM kv_tax.tax_invoices WHERE order_id = :o", o=chk["id"])
ok("platform invoice in the KVA series to the brand's GSTIN", inv and inv[0][0].startswith("KVA") and inv[0][4] == "29ABCDE1234F1Z5", inv)

print("\n== decisions and events")
viewer = signup("Ad Viewer")
d = viewer.get(f"/api/video/ads/decision?video={long_v['public_id']}").json()["ad"]
ok("an ad with label, skip, click URL and signed playback", d and d["label"] == "Ad" and d["skip_after_seconds"] == 5
   and d["click_url"].startswith("https://") and d["playback"]["url"], d)
check("the brand's name is shown", d["brand"], "Chai Point")
tok = d["token"]


def ev(c, token, event):
    return c.post("/api/video/ads/events", json={"token": token, "event": event}).json()["counted"]


def decision(c, ua=None):
    return c.get(f"/api/video/ads/decision?video={long_v['public_id']}", headers={"User-Agent": ua or BROWSER}).json()["ad"]


check("complete before start is not counted", ev(viewer, tok, "complete"), False)
check("start counted", ev(viewer, tok, "start"), True)
check("a replayed start is not", ev(viewer, tok, "start"), False)
check("viewable after 2 s, not straight away (too fast = invalid, not billed)", ev(viewer, tok, "q0"), False)
check("an invalid impression's click is not counted", ev(viewer, tok, "click"), False)
check("unknown event", viewer.post("/api/video/ads/events", json={"token": tok, "event": "hover"}).status_code, 400)
check("forged token", ev(viewer, "x" * 20, "start"), False)
d2 = decision(viewer)
ev(viewer, d2["token"], "start")
time.sleep(2.2)
check("viewable after 2 s of play: billed", ev(viewer, d2["token"], "q0"), True)
check("a replayed viewable event is not", ev(viewer, d2["token"], "q0"), False)
check("click counted", ev(viewer, d2["token"], "click"), True)
check("complete long before half the ad is invalid", ev(viewer, d2["token"], "complete"), False)
d3 = decision(viewer)
ev(viewer, d3["token"], "start")
time.sleep(2.2)
ev(viewer, d3["token"], "q0")
time.sleep(max(0.0, d3["duration_ms"] / 2000 - 2.0))
check("complete after half the ad", ev(viewer, d3["token"], "complete"), True)
check("frequency cap: 3 a day per campaign", decision(viewer), None)
other = signup("Ad Viewer 2")
d4 = decision(other)
check("events from a different viewer are refused", ev(viewer, d4["token"], "start"), False)
check("declared bots get no ad", decision(signup("Bot Viewer"), "Mozilla/5.0 (compatible; Googlebot/2.1)"), None)
ivt = admin.get("/api/video/admin/ads/ivt").json()
ok("invalid traffic by reason for the admin", all(ivt["reasons"].get(k, 0) >= 1 for k in
                                                   ("too_fast", "complete_too_fast", "viewer_mismatch", "no_start", "bot_ua")), ivt["reasons"])
check("the creator sees no ads on their own video", host.get(f"/api/video/ads/decision?video={long_v['public_id']}").json()["ad"], None)
prem = signup("Premium Viewer")
premium(prem)
check("Premium viewers see no ads", prem.get(f"/api/video/ads/breaks?video={long_v['public_id']}").json()["reason"], "premium")
sql("UPDATE kv_media.videos SET access = 'members', members_rank = 1 WHERE public_id = :p", p=long_v["public_id"])
check("never on members-only videos", anon.get(f"/api/video/ads/breaks?video={long_v['public_id']}").json()["reason"], "members_or_paid")
sql("UPDATE kv_media.videos SET access = 'free', members_rank = NULL WHERE public_id = :p", p=long_v["public_id"])
host.put(f"/api/video/studio/ads/videos/{long_v['public_id']}", json={"ads_enabled": False})
check("a creator can switch one video off", anon.get(f"/api/video/ads/breaks?video={long_v['public_id']}").json()["reason"], "creator_opted_out")
host.put(f"/api/video/studio/ads/videos/{long_v['public_id']}", json={"ads_enabled": True})

print("\n== counters flush (V06), spend and the report")
flush()
row = sql("SELECT sum(impressions), sum(completes), sum(clicks), sum(spend_minor), sum(starts), sum(invalid) FROM kv_commerce.ad_daily d "
          "JOIN kv_commerce.ad_campaigns c ON c.id = d.campaign_id WHERE c.public_id = :p", p=camp["id"])
check("2 viewable, 1 complete, 1 click, spend = 2 × ₹200 / 1000; 3 starts, 1 invalid", tuple(int(x) for x in row[0]) if row else None,
      (2, 1, 1, 40, 3, 1))
rep = brand.get(f"/api/video/studio/ads/campaigns/{camp['id']}").json()
check("brand report totals", (rep["spent_minor"], rep["report"]["totals"]["impressions"], rep["report"]["totals"]["ctr_bps"],
                              rep["report"]["totals"]["invalid_bps"]), (40, 2, 5000, 3333))
for by, head in (("day", "day,impressions,starts"), ("device", "device,impressions"), ("category", "category,impressions")):
    r = brand.get(f"/api/video/studio/ads/campaigns/{camp['id']}/export?by={by}")
    check(f"CSV export by {by}", (r.status_code, r.text.splitlines()[0].startswith(head)), (200, True))
ok("the long video is categorised as tech", "tech" in (brand.get(f"/api/video/studio/ads/campaigns/{camp['id']}/export?by=category").text), "")

print("\n== budget stop")
us = signup("US Viewer", country="US")
big = brand.post("/api/video/studio/ads/campaigns", json={**base, "name": "Expensive", "cpm_minor": 50_000_000,
                                                          "countries": ["US"]}).json()
brand.post(f"/api/video/studio/ads/campaigns/{big['id']}/submit")
admin.post(f"/api/video/admin/ads/campaigns/{big['id']}/review", json={"decision": "approve"})
chk2 = brand.post(f"/api/video/studio/ads/campaigns/{big['id']}/fund", json={"amount_minor": 100000,
                                                                            "idempotency_key": uuid.uuid4().hex}).json()
pay(brand, chk2["id"])
ads.forget_cache()
served = 0
for i in range(4):
    viewer_i = us if i == 0 else signup(f"US Viewer {i}", country="US")
    d = viewer_i.get(f"/api/video/ads/decision?video={long_v['public_id']}").json()["ad"]
    if d and d["campaign"] == big["id"]:
        ev(viewer_i, d["token"], "start")
        time.sleep(2.2)
        served += ev(viewer_i, d["token"], "q0")
check("₹1,000 at ₹500 an impression serves exactly 2", served, 2)
flush()
b2 = brand.get(f"/api/video/studio/ads/campaigns/{big['id']}").json()
check("and the campaign ends when spent", (b2["spent_minor"], b2["status"]), (100000, "ended"))

print("\n== brand safety, kids and invalid-traffic rules (in-process)")
from app.video.ads import integrity  # noqa: E402
from fakehttp import configured  # noqa: E402

with configured(ADS_IVT_CIDRS="203.0.113.0/24, 2001:db8::/32", ADS_IVT_MAX_PER_10M=2):
    check("data-centre ranges", (integrity.datacentre("203.0.113.7"), integrity.datacentre("2001:db8::1"),
                                 integrity.datacentre("49.36.1.1")), (True, True, False))
    ip = f"198.51.100.{int(time.time()) % 250}"
    check("a burst from one IP turns invalid", [ads.burst(ip, None) for _ in range(3)], [False, False, True])
check("bots and empty agents", (integrity.is_bot("curl/8.4"), integrity.is_bot(""), integrity.is_bot(
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")), (True, True, False))
fake_c = {"id": -9, "tenant_id": -9, "public_id": "Afake", "cpm": 5000, "budget": 10**9, "spent": 0, "daily_cap": None,
          "targeting": {}, "video_id": -9, "click_url": "https://x", "skip": 5, "name": "fake", "exclude": ["tech"]}
with platform_session() as db:
    from app.video.models.media import Video  # noqa: E402
    from app.video.models.social import Channel  # noqa: E402

    vv = db.query(Video).filter(Video.public_id == long_v["public_id"]).one()
    chh = db.get(Channel, vv.channel_id)
    ads._cache = (time.monotonic(), [fake_c])
    check("a campaign excluding tech skips a tech video", ads.pick(db, video=vv, channel=chh, country="IN", device="desktop",
                                                                   vkey=f"t{time.time()}", labels=["tech"]), None)
    check("and serves a food video", (ads.pick(db, video=vv, channel=chh, country="IN", device="desktop", vkey=f"u{time.time()}",
                                               labels=["food"]) or {}).get("public_id"), "Afake")
    ads.forget_cache()
host.patch(f"/api/video/studio/videos/{long_v['id']}", json={"made_for_kids": True})
check("never on videos made for kids", anon.get(f"/api/video/ads/breaks?video={long_v['public_id']}").json()["reason"], "made_for_kids")
host.patch(f"/api/video/studio/videos/{long_v['id']}", json={"made_for_kids": False})

print("\n== accrual into the books")
with platform_session() as db:
    n = ads.accrue(db)
    db.commit()
ok("accrual journals posted", n >= 1, n)
bal = sql("SELECT coalesce(sum(l.credit_minor - l.debit_minor), 0) FROM kv_ledger.journal_lines l JOIN kv_ledger.accounts a "
          "ON a.id = l.account_id WHERE a.role = 'ad_income' AND l.journal_id IN (SELECT id FROM kv_ledger.journals "
          "WHERE source_type = 'ad_accrual' AND source_id IN (SELECT id FROM kv_commerce.ad_campaigns WHERE public_id IN (:a, :b)))",
          a=camp["id"], b=big["id"])[0][0]
check("ad income equals delivered spend", bal, 40 + 100000)

print("\n== creator revenue share (monthly, paid as a Route transfer)")
r = admin.post("/api/video/admin/ads/payouts/run", json={"period": MONTH}).json()
mine = next((p for p in r if p["tenant_id"] == host.user["tenant_id"]), None)
check("share = 55% of the spend on the host's videos", (mine["spend_minor"], mine["share_minor"], mine["status"]) if mine else None,
      (100040, 100040 * settings.ADS_CREATOR_SHARE_BPS // 10000, "released"))
check("running it twice pays nothing more", [p for p in admin.post("/api/video/admin/ads/payouts/run", json={"period": MONTH}).json()
                                             if p["tenant_id"] == host.user["tenant_id"]], [])
rev = host.get("/api/video/studio/ads/revenue").json()
check("the creator sees it", [(m["period"], m["status"]) for m in rev["months"]][:1], [(MONTH, "released")])
check("an ad-share transfer, no hold", sql("SELECT kind, status FROM kv_commerce.route_transfers WHERE tenant_id = :t AND kind = 'ad_share'",
                                           t=host.user["tenant_id"]), [("ad_share", "released")])

print("\n== ending a campaign refunds the unspent budget")
r = brand.post(f"/api/video/studio/ads/campaigns/{camp['id']}/state", json={"action": "end"}).json()
check("refund = unspent ₹999.60 + GST", (r["status"], r["refunded_now_minor"]), ("ended", (99960 * 118000 * 2 + 100000) // 200000))
check("budget cut to what was spent", (r["budget_minor"], r["refunded_minor"]), (40, 99960))
cn = sql("SELECT kind, total_minor FROM kv_tax.tax_invoices WHERE kind = 'credit_note' AND order_id = :o", o=chk["id"])
check("a credit note for the refund", [k for k, _ in cn], ["credit_note"])
unearned = sql("SELECT coalesce(sum(l.credit_minor - l.debit_minor), 0) FROM kv_ledger.journal_lines l JOIN kv_ledger.accounts a "
               "ON a.id = l.account_id JOIN kv_ledger.journals j ON j.id = l.journal_id WHERE a.role = 'ad_unearned' "
               "AND ((j.source_type IN ('ad_budget','ad_refund') AND j.source_id IN (SELECT p.id FROM kv_commerce.payments p WHERE p.checkout_id IN (:c1, :c2))) "
               "OR (j.source_type = 'ad_accrual' AND j.source_id IN (SELECT id FROM kv_commerce.ad_campaigns WHERE public_id IN (:a, :b))))",
               c1=chk["id"], c2=chk2["id"], a=camp["id"], b=big["id"])[0][0]
check("nothing left unearned for these campaigns", unearned, 0)
check("an ended campaign cannot be funded", brand.post(f"/api/video/studio/ads/campaigns/{camp['id']}/fund",
                                                       json={"amount_minor": 100000, "idempotency_key": uuid.uuid4().hex}).status_code, 409)
rep = admin.get("/api/video/admin/ads/report")
ok("the admin ads report sums months", rep.status_code == 200 and any(m["period"] == MONTH for m in rep.json()["months"]), rep.text[:200])
check("the studio video payload carries the ads switch", "ads_enabled" in host.get(f"/api/video/studio/videos/{long_v['id']}").json(), True)
check("every platform journal balances", sql("SELECT count(*) FROM (SELECT journal_id FROM kv_ledger.journal_lines GROUP BY journal_id "
                                             "HAVING sum(debit_minor) <> sum(credit_minor)) x")[0][0], 0)

finish()
