import asyncio
import json

import httpx
import websockets

from harness import (BASE, PAYOUT_ACCOUNT, admin_login, check, creator, finish, ok, settled, signup, sql, support_pay,
                     upload, wait_for)
from app.video.commerce.service import lapse_due
from app.video.sessions import platform_session

ACCOUNT = PAYOUT_ACCOUNT
pay = support_pay

GST_ACCOUNT = {**ACCOUNT, "gstin": "29ABCDE1234F1Z5", "email": "gst.creator@example.com"}


def activated(name, account=GST_ACCOUNT):
    c = creator(name)
    c.put("/api/video/studio/earnings/account", json=account)
    assert c.post("/api/video/studio/earnings/account/submit").json()["account"]["status"] == "activated"
    return c


print("\n== Boost danmaku (V2.3)")
c = activated("Boost Creator")
tenant = c.user["tenant_id"]
v = settled(c, upload(c, "reel-chai", "Boost me")["id"])
pid = v["public_id"]
fan = signup("Boost Fan")
check("a boost with a banned word is refused before payment", fan.post(f"/api/video/videos/{pid}/boost/check",
                                                                       json={"text": "you bitch"}).status_code, 400)
r = fan.post(f"/api/video/videos/{pid}/boost/check", json={"text": "Best chai ever"})
check("a clean boost passes the check", (r.status_code, len(r.json()["tiers"])), (200, 3))
check("a boost longer than 60 characters is refused", fan.post("/api/video/support/checkout", json={
    "purpose": "boost", "boost_tier": 2, "video_id": pid, "text": "x" * 61}).status_code, 400)


async def boosted():
    ws_url = BASE.replace("http", "ws") + f"/api/video/ws/videos/{pid}"
    async with websockets.connect(ws_url) as ws:
        await asyncio.wait_for(ws.recv(), 5)
        await asyncio.sleep(0.3)
        chk = await asyncio.to_thread(lambda: pay(fan, {"purpose": "boost", "boost_tier": 2, "video_id": pid,
                                                        "text": "Best chai ever", "t_ms": 3000}))
        while True:
            got = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if got.get("type") == "danmaku":
                return chk, got["item"]


chk, item = asyncio.run(boosted())
check("the paid boost reaches everyone watching", (item["text"], item["boost_tier"], item["pin_ms"], item["mode"]),
      ("Best chai ever", 2, 10000, "top"))
lines = fan.get(f"/api/video/videos/{pid}/danmaku?from_ms=0&to_ms=60000").json()
boost = next(d for d in lines if d["boost_tier"])
check("the boost is stored with its tier colour and price", (boost["color"], boost["paid_minor"]), ("#F472B6", 9900))
s = c.get("/api/video/studio/earnings/sales").json()[0]
check("a boost from a GST-registered creator carries their GST", (s["purpose"], s["seller_tax_minor"]), ("boost", 1510))
check("TCS of 0.5% is collected on the taxable value", s["tcs_minor"], 42)
inv = sql("SELECT total_minor, cgst_minor + sgst_minor, kind FROM kv_tax.tax_invoices WHERE tenant_id = :t AND order_id = :o",
          t=tenant, o=chk["id"])
check("the creator's tax invoice is issued", tuple(inv[0]) if inv else None, (9900, 1510, "invoice"))
check("the creator removes the boost", c.delete(f"/api/video/danmaku/{boost['id']}").status_code, 204)
adm = admin_login()
p = next(x for x in adm.get("/api/video/admin/payments?purpose=boost").json() if x["checkout_id"] == chk["id"])
check("removing a paid boost refunds the fan", p["refundable_minor"], 0)
check("a credit note is issued", sql("SELECT count(*) FROM kv_tax.tax_invoices WHERE tenant_id = :t AND kind = 'credit_note'",
                                     t=tenant)[0][0], 1)
ok("the boost is gone from the overlay", all(not d["boost_tier"] for d in fan.get(
    f"/api/video/videos/{pid}/danmaku?from_ms=0&to_ms=60000").json()))

print("\n== Memberships (V2.4)")
check("a tier above the price limit is refused", c.post("/api/video/studio/memberships/tiers", json={
    "name": "Too much", "rank": 1, "price_minor": 99_000_000}).status_code, 400)
t1 = c.post("/api/video/studio/memberships/tiers", json={"name": "Supporter", "rank": 1, "price_minor": 4900,
                                                          "perks": "Badge", "badge": "Chai Club"}).json()
t2 = c.post("/api/video/studio/memberships/tiers", json={"name": "Superfan", "rank": 2, "price_minor": 14900,
                                                          "perks": "Members-only recipes"}).json()
check("a second tier at the same rank is refused", c.post("/api/video/studio/memberships/tiers", json={
    "name": "Dup", "rank": 2, "price_minor": 5000}).status_code, 409)
mv = settled(c, upload(c, "reel-three-tips", "Members-only tips")["id"])
r = c.put(f"/api/video/studio/videos/{mv['id']}/access", json={"access": "members", "members_rank": 2, "preview_seconds": 4})
check("video made members-only (rank 2)", (r.status_code, r.json()["access"]), (200, "members"))
mpid = mv["public_id"]
d = fan.get(f"/api/video/videos/{mpid}").json()
check("a non-member sees it locked", (d["locked"] or {}).get("access"), "members")
ok("the lock offers the tiers that open it", [t["rank"] for t in d["locked"]["tiers"]] == [2], d["locked"])
ok("a non-member gets a preview stream", d["playback"] and "hls-preview" in d["playback"]["url"], d["playback"])
idx = httpx.get(d["playback"]["url"].replace("master.m3u8", "240p/index.m3u8"), timeout=30).text
seconds = sum(float(x.split(":")[1].split(",")[0]) for x in idx.splitlines() if x.startswith("#EXTINF"))
ok("the preview stops near the preview length", 0 < seconds <= 6.5 and "#EXT-X-ENDLIST" in idx, seconds)
full_idx = c.get(f"/api/video/videos/{mpid}").json()["playback"]["url"]
last_seg = [x for x in httpx.get(full_idx.replace("master.m3u8", "240p/index.m3u8"), timeout=30).text.splitlines() if x.endswith(".ts")][-1]
check("segments past the preview are refused", httpx.get(d["playback"]["url"].replace("master.m3u8", f"240p/{last_seg}"),
                                                         timeout=30).status_code, 403)
check("the transcript is locked", fan.get(f"/api/video/videos/{mpid}/transcript").status_code, 402)
check("captions are locked", fan.get(f"/api/video/videos/{mpid}/captions/en.vtt").status_code, 402)
check("Ask is locked", fan.post(f"/api/video/videos/{mpid}/ask", json={"question": "How do I speak with confidence?"}).status_code, 402)
anon = httpx.Client(base_url=BASE, timeout=30)
check("anonymous viewers see the lock too", anon.get(f"/api/video/videos/{mpid}").json()["locked"]["signed_in"], False)
check("the owner is never locked out", c.get(f"/api/video/videos/{mpid}").json()["locked"], None)
leaks = []
for off in range(0, 600, 30):
    page = anon.get(f"/api/video/feed/reels?limit=30&offset={off}").json()
    leaks += [x["id"] for x in page if x.get("access", "free") != "free" and (x.get("playback") or {}).get("url")
              and "hls-preview" not in x["playback"]["url"]]
    if len(page) < 30:
        break
check("the reels feed never hands out a full stream for a locked reel", leaks, [])
res = fan.get("/api/video/search", params={"q": "slow down fast speech sounds nervous"}).json()["results"]
ok("search never shows a members-only transcript", all(not (x["id"] == mpid and x.get("moment")) for x in res), res[:2])
pay(fan, {"purpose": "membership", "tier_id": t1["id"]})
check("rank 1 does not open a rank 2 video", (fan.get(f"/api/video/videos/{mpid}").json()["locked"] or {}).get("access"), "members")
pay(fan, {"purpose": "membership", "tier_id": t2["id"]})
d = wait_for(lambda: (lambda x: x if x["locked"] is None else None)(fan.get(f"/api/video/videos/{mpid}").json()), 30)
ok("the upgrade opens it with the full stream", d and "hls-preview" not in d["playback"]["url"], d and d["playback"])
check("the transcript opens", fan.get(f"/api/video/videos/{mpid}/transcript").status_code, 200)
mine = fan.get("/api/video/me/memberships").json()
check("one active membership, the old tier cancelled", sorted((m["tier"]["rank"], m["status"]) for m in mine),
      [(1, "cancelled"), (2, "active")])
handle = sql("SELECT handle FROM kv_social.channels WHERE tenant_id = :t", t=tenant)[0][0]
check("the channel page knows my rank", fan.get(f"/api/video/channels/{handle}/support").json()["my_rank"], 2)
r = fan.post(f"/api/video/me/memberships/{t2['id']}/cancel")
check("cancelling keeps access to the period end", (r.json()["cancel_at_period_end"], fan.get(f"/api/video/videos/{mpid}").json()["locked"]),
      (True, None))
sql("UPDATE kv_commerce.subscriptions SET current_period_end = now() - interval '1 hour' WHERE user_id = :u AND audience = 'member'",
    u=fan.user["id"])
with platform_session() as db:
    lapse_due(db)
    db.commit()
check("at the period end the membership lapses and the video locks", (fan.get(f"/api/video/videos/{mpid}").json()["locked"] or {}).get("access"),
      "members")
ms = c.get("/api/video/studio/earnings/sales?purpose=membership").json()
check("both membership payments were split", len(ms), 2)

print("\n== Paid videos and series (V2.5)")
pv = settled(c, upload(c, "reel-git-mistake", "Paid git lesson")["id"])
check("a paid video needs a price", c.put(f"/api/video/studio/videos/{pv['id']}/access", json={"access": "paid"}).status_code, 400)
check("price set", c.put(f"/api/video/studio/videos/{pv['id']}/access", json={"access": "paid", "price_minor": 9900}).status_code, 200)
buyer = signup("Video Buyer")
d = buyer.get(f"/api/video/videos/{pv['public_id']}").json()
check("the lock shows the price", (d["locked"]["access"], d["locked"]["price_minor"]), ("paid", 9900))
card = next((x for x in anon.get(f"/api/video/channels/{handle}/videos").json() if x["id"] == pv["public_id"]), {})
check("cards show the price", (card.get("access"), card.get("price_minor")), ("paid", 9900))
pay(buyer, {"purpose": "video", "video_id": pv["public_id"]})
check("bought: the video opens", wait_for(lambda: buyer.get(f"/api/video/videos/{pv['public_id']}").json()["locked"] is None, 30), True)
check("buying twice is refused", buyer.post("/api/video/support/checkout", json={"purpose": "video", "video_id": pv["public_id"]}).status_code, 409)
check("purchases list it", [p["id"] for p in buyer.get("/api/video/me/purchases").json()], [pv["public_id"]])
p = next(x for x in adm.get("/api/video/admin/payments?purpose=video").json() if x["buyer"] == buyer.email)
adm.post(f"/api/video/admin/payments/{p['id']}/refund", json={"reason": "Changed mind"})
check("a refund locks it again (one revoke, S03)", (buyer.get(f"/api/video/videos/{pv['public_id']}").json()["locked"] or {}).get("access"), "paid")
sv = settled(c, upload(c, "dal-tadka", "Series lesson one")["id"])
c.put(f"/api/video/studio/videos/{sv['id']}/access", json={"access": "paid", "price_minor": 4900})
pl = c.post("/api/video/studio/playlists", json={"title": "Paid kitchen series", "kind": "series", "visibility": "public"}).json()
c.post(f"/api/video/studio/playlists/{pl['id']}/items", json={"video_id": sv["id"]})
check("a playlist that is not a series cannot be priced", c.put(f"/api/video/studio/playlists/{c.post('/api/video/studio/playlists', json={'title': 'Plain', 'kind': 'playlist', 'visibility': 'public'}).json()['id']}/price",
                                                                  json={"price_minor": 9900}).status_code, 400)
check("series priced", c.put(f"/api/video/studio/playlists/{pl['id']}/price", json={"price_minor": 19900}).json()["price_minor"], 19900)
sfan = signup("Series Fan")
lk = sfan.get(f"/api/video/videos/{sv['public_id']}").json()["locked"]
check("the lock offers the series too", [x["id"] for x in lk["series"]], [pl["id"]])
pay(sfan, {"purpose": "series", "playlist_id": pl["id"]})
check("buying the series opens its videos", wait_for(lambda: sfan.get(f"/api/video/videos/{sv['public_id']}").json()["locked"] is None, 30), True)
check("back to free clears the price", c.put(f"/api/video/studio/videos/{pv['id']}/access", json={"access": "free"}).json()["price_minor"], None)

print("\n== Creators without payouts cannot charge")
plain = creator("No Payouts Creator")
check("no tiers without payouts", plain.post("/api/video/studio/memberships/tiers", json={"name": "x", "rank": 1, "price_minor": 4900}).status_code, 409)
nv = settled(plain, upload(plain, "reel-chai", "Unpriced")["id"])
check("no paid videos without payouts", plain.put(f"/api/video/studio/videos/{nv['id']}/access", json={"access": "paid", "price_minor": 4900}).status_code, 409)

print("\n== Books")
bad = sql("""SELECT count(*) FROM (SELECT j.id FROM kv_ledger.journals j JOIN kv_ledger.journal_lines l ON l.journal_id = j.id
             GROUP BY j.id HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)) x""")[0][0]
check("every journal in the database balances", bad, 0)

finish()
