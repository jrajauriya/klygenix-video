"""V5.2 sponsorship marketplace (sandbox rail): briefs, applications, escrowed deals, delivery with disclosure, approval, disputes."""

from __future__ import annotations

import uuid
from datetime import timedelta

from harness import PAYOUT_ACCOUNT, admin_login, check, client, creator, finish, ok, settled, signup, sql, upload, wait_for

from app.video.ads import sponsorships as sp
from app.video.models.ads import SponsorDeal
from app.video.sessions import platform_session

admin = admin_login()


def pay(c, chk_id: int) -> None:
    r = c.post(f"/api/video/sandbox/pay/{chk_id}")
    assert r.status_code == 200, r.text
    wait_for(lambda: c.get(f"/api/video/checkout/{chk_id}").json()["status"] == "paid", 30, 0.2)


def transfers(split_id: int) -> list[tuple]:
    return sql("SELECT kind, status FROM kv_commerce.route_transfers WHERE split_id = :s ORDER BY id", s=split_id)


print("\n== a brand posts a brief")
brand = creator("Sponsor Brand")
check("brand profile first", brand.post("/api/video/studio/sponsorships/briefs", json={
    "title": "Monsoon recipes", "description": "A dedicated video about monsoon snacks with our masala.",
    "deliverable": "dedicated", "budget_min_minor": 500000, "budget_max_minor": 2000000}).status_code, 409)
brand.put("/api/video/studio/brand", json={"name": "Masala Co", "contact_email": "brand@masala.example", "state_code": "MH"})
bad = brand.post("/api/video/studio/sponsorships/briefs", json={
    "title": "Bad", "description": "x" * 30, "deliverable": "tweet", "budget_min_minor": 500000, "budget_max_minor": 2000000})
check("unknown deliverable", bad.status_code, 422 if bad.status_code == 422 else 400)
brief = brand.post("/api/video/studio/sponsorships/briefs", json={
    "title": "Monsoon recipes", "description": "A dedicated video about monsoon snacks with our masala.",
    "deliverable": "dedicated", "budget_min_minor": 500000, "budget_max_minor": 2000000, "languages": ["en"]}).json()
check("brief open", (brief["status"], brief["brand"]["name"]), ("open", "Masala Co"))
check("the public brands page counts it", client().get("/api/video/brands").json()["open_briefs"] >= 1, True)

print("\n== creators browse and apply")
maker = creator("Sponsored Creator")
check("applying needs payouts set up", maker.post(f"/api/video/studio/sponsorships/briefs/{brief['id']}/apply",
                                                   json={"pitch": "I cook monsoon snacks every week for 40k viewers.",
                                                         "quote_minor": 1500000}).status_code, 409)
maker.put("/api/video/studio/earnings/account", json={**PAYOUT_ACCOUNT, "gstin": "27ABCDE1234F1Z5", "email": "sp.maker@example.com"})
check("payouts activated", maker.post("/api/video/studio/earnings/account/submit").json()["account"]["status"], "activated")
listing = maker.get("/api/video/studio/sponsorships/briefs").json()
check("the brief is listed for the creator", [b["id"] for b in listing if b["id"] == brief["id"]], [brief["id"]])
check("the brand does not see its own brief to apply", [b for b in brand.get("/api/video/studio/sponsorships/briefs").json()
                                                       if b["id"] == brief["id"]] if brand.get("/api/video/studio/sponsorships/briefs").status_code == 200 else [], [])
r = maker.post(f"/api/video/studio/sponsorships/briefs/{brief['id']}/apply",
               json={"pitch": "I cook monsoon snacks every week for 40k viewers.", "quote_minor": 1500000})
check("applied", r.status_code, 201)
check("once", maker.post(f"/api/video/studio/sponsorships/briefs/{brief['id']}/apply",
                         json={"pitch": "Again please, I really want this.", "quote_minor": 1000000}).status_code, 409)
apps = brand.get(f"/api/video/studio/sponsorships/briefs/{brief['id']}/applications").json()
check("the brand sees the pitch and channel", (len(apps), apps[0]["quote_minor"], apps[0]["channel"]["handle"]),
      (1, 1500000, maker.get("/api/video/studio/channel").json()["channel"]["handle"]))
check("only the brief's brand", maker.get(f"/api/video/studio/sponsorships/briefs/{brief['id']}/applications").status_code, 404)

print("\n== a deal, funded into escrow")
deal = brand.post(f"/api/video/studio/sponsorships/applications/{apps[0]['id']}/accept",
                  json={"deliverables": "One 8–12 minute dedicated video; product shown for 60 s; link in description."}).json()
check("proposed at the creator's quote", (deal["status"], deal["price_minor"]), ("proposed", 1500000))
check("both sides see it", ([d["role"] for d in brand.get("/api/video/studio/sponsorships/deals").json() if d["id"] == deal["id"]],
                            [d["role"] for d in maker.get("/api/video/studio/sponsorships/deals").json() if d["id"] == deal["id"]]),
      (["brand"], ["creator"]))
check("a stranger does not", creator("Stranger").get(f"/api/video/studio/sponsorships/deals/{deal['id']}").status_code, 404)
chk = brand.post(f"/api/video/studio/sponsorships/deals/{deal['id']}/fund", json={"idempotency_key": uuid.uuid4().hex}).json()
check("the price includes the creator's GST", chk["amount_minor"], 1500000)
pay(brand, chk["id"])
d = brand.get(f"/api/video/studio/sponsorships/deals/{deal['id']}").json()
check("funded", d["status"], "funded")
split = sql("SELECT id, commission_bps, commission_minor, taxable_minor FROM kv_commerce.creator_splits WHERE source_key = :k",
            k=f"sponsorship:{chk['id']}")[0]
check("commission is the sponsorship rate (10%)", (split[1], split[2]), (1000, (split[3] * 1000 * 2 + 10000) // 20000))
wait_for(lambda: transfers(split[0]) and transfers(split[0])[0][1] == "held", 30, 0.5)
held = sql("SELECT status, hold_until > now() + interval '1 year' FROM kv_commerce.route_transfers WHERE split_id = :s AND kind = 'sale'",
           s=split[0])
check("the creator's money is held until approval", held, [("held", True)])
inv = sql("SELECT number, tenant_id FROM kv_tax.tax_invoices WHERE order_id = :o", o=chk["id"])
ok("the creator invoices the brand (KVC series)", inv and inv[0][0].startswith("KVC"), inv)
check("funding twice is refused", brand.post(f"/api/video/studio/sponsorships/deals/{deal['id']}/fund",
                                             json={"idempotency_key": uuid.uuid4().hex}).status_code, 409)

print("\n== delivery and the Paid partnership label")
other = creator("Other Creator")
foreign = settled(other, upload(other, "reel-chai", "Not theirs")["id"])
check("only the creator delivers", brand.post(f"/api/video/studio/sponsorships/deals/{deal['id']}/deliver",
                                              json={"video_id": foreign["public_id"]}).status_code, 404)
check("someone else's video cannot be delivered", maker.post(f"/api/video/studio/sponsorships/deals/{deal['id']}/deliver",
                                                             json={"video_id": foreign["public_id"]}).status_code, 404)
vid = settled(maker, upload(maker, "dal-tadka", "Monsoon pakoras with Masala Co")["id"])
r = maker.post(f"/api/video/studio/sponsorships/deals/{deal['id']}/deliver", json={"video_id": vid["public_id"]})
check("delivered", (r.status_code, r.json()["status"], r.json()["video"]["id"]), (200, "delivered", vid["public_id"]))
w = client().get(f"/api/video/videos/{vid['public_id']}").json()
check("watchers see the disclosure", w["paid_partnership"], {"brand": "Masala Co", "label": "Paid partnership with Masala Co"})
check("other videos carry none", client().get(f"/api/video/videos/{foreign['public_id']}").json()["paid_partnership"], None)
mails = admin.get("/api/video/admin/beta/outbox?template=deal_event&limit=20").json()
ok("both sides are mailed at each step", sum(1 for m in mails if "Monsoon recipes" in m["subject"]) >= 4, len(mails))

print("\n== approval releases the money")
check("the creator cannot approve", maker.post(f"/api/video/studio/sponsorships/deals/{deal['id']}/approve").status_code, 404)
r = brand.post(f"/api/video/studio/sponsorships/deals/{deal['id']}/approve")
check("approved", (r.status_code, r.json()["status"]), (200, "approved"))
check("the held transfer is released", wait_for(lambda: (lambda t: t if t and t[0][1] == "released" else None)(
    sql("SELECT kind, status FROM kv_commerce.route_transfers WHERE split_id = :s AND kind = 'sale'", s=split[0])), 30, 0.5),
      [("sale", "released")])

print("\n== dispute → admin refunds")
brief2 = brand.post("/api/video/studio/sponsorships/briefs", json={
    "title": "Festive gifting", "description": "An integration in your Diwali video, 45 seconds on screen.",
    "deliverable": "integration", "budget_min_minor": 300000, "budget_max_minor": 900000}).json()
maker.post(f"/api/video/studio/sponsorships/briefs/{brief2['id']}/apply", json={"pitch": "Diwali special every year, big audience.",
                                                                             "quote_minor": 600000})
a2 = brand.get(f"/api/video/studio/sponsorships/briefs/{brief2['id']}/applications").json()[0]
deal2 = brand.post(f"/api/video/studio/sponsorships/applications/{a2['id']}/accept",
                   json={"deliverables": "45 s integration with the product in frame.", "price_minor": 700000}).json()
check("the brand can counter the price", deal2["price_minor"], 700000)
chk2 = brand.post(f"/api/video/studio/sponsorships/deals/{deal2['id']}/fund", json={"idempotency_key": uuid.uuid4().hex}).json()
pay(brand, chk2["id"])
v2 = settled(maker, upload(maker, "reel-three-tips", "Diwali tips")["id"])
maker.post(f"/api/video/studio/sponsorships/deals/{deal2['id']}/deliver", json={"video_id": v2["public_id"]})
check("dispute needs a reason", brand.post(f"/api/video/studio/sponsorships/deals/{deal2['id']}/dispute",
                                           json={"reason": "bad"}).status_code, 422)
r = brand.post(f"/api/video/studio/sponsorships/deals/{deal2['id']}/dispute", json={"reason": "The product is never shown on screen."})
check("disputed", r.json()["status"], "disputed")
check("a viewer cannot resolve", signup("Nosy Deals").post(f"/api/video/admin/sponsorships/deals/{deal2['id']}/resolve",
                                                            json={"decision": "refund", "note": "x" * 5}).status_code, 403)
r = admin.post(f"/api/video/admin/sponsorships/deals/{deal2['id']}/resolve",
               json={"decision": "refund", "note": "Deliverable missing the product."})
check("refunded by admin", r.json()["status"], "refunded")
split2 = sql("SELECT id FROM kv_commerce.creator_splits WHERE source_key = :k", k=f"sponsorship:{chk2['id']}")[0][0]
rows = transfers(split2)
ok("the held creator transfer is reversed, not paid", all(s in ("reversed", "recovered") for k, s in rows if k == "sale"), rows)
check("the brand got its money back", sql("SELECT sum(amount_minor) FROM kv_commerce.refunds WHERE checkout_id = :c", c=chk2["id"])[0][0],
      700000)

print("\n== auto-approval after the review window")
brief3 = brand.post("/api/video/studio/sponsorships/briefs", json={
    "title": "Reel shout-out", "description": "A 30-second reel shout-out for our new pack.",
    "deliverable": "reel", "budget_min_minor": 100000, "budget_max_minor": 300000}).json()
maker.post(f"/api/video/studio/sponsorships/briefs/{brief3['id']}/apply", json={"pitch": "Quick reel, I can post this week.",
                                                                             "quote_minor": 200000})
a3 = brand.get(f"/api/video/studio/sponsorships/briefs/{brief3['id']}/applications").json()[0]
deal3 = brand.post(f"/api/video/studio/sponsorships/applications/{a3['id']}/accept", json={"deliverables": "One reel, 30 seconds."}).json()
chk3 = brand.post(f"/api/video/studio/sponsorships/deals/{deal3['id']}/fund", json={"idempotency_key": uuid.uuid4().hex}).json()
pay(brand, chk3["id"])
v3 = settled(maker, upload(maker, "reel-git-mistake", "Shout-out reel")["id"])
maker.post(f"/api/video/studio/sponsorships/deals/{deal3['id']}/deliver", json={"video_id": v3["public_id"]})
with platform_session() as db:
    d3 = db.query(SponsorDeal).filter(SponsorDeal.public_id == deal3["id"]).one()
    d3.approve_by = sp.now() - timedelta(minutes=1)
    db.flush()
    ok("the sweep approves it (and any other overdue deal)", sp.auto_approve(db) >= 1)
    db.commit()
r = brand.get(f"/api/video/studio/sponsorships/deals/{deal3['id']}").json()
check("approved automatically", (r["status"], r["auto_approved"]), ("approved", True))

print("\n== cancelling before delivery refunds in full")
brief4 = brand.post("/api/video/studio/sponsorships/briefs", json={
    "title": "Cancelled idea", "description": "This brief will be cancelled after funding.", "deliverable": "post",
    "budget_min_minor": 100000, "budget_max_minor": 200000}).json()
maker.post(f"/api/video/studio/sponsorships/briefs/{brief4['id']}/apply", json={"pitch": "Happy to write a community post.",
                                                                             "quote_minor": 100000})
a4 = brand.get(f"/api/video/studio/sponsorships/briefs/{brief4['id']}/applications").json()[0]
deal4 = brand.post(f"/api/video/studio/sponsorships/applications/{a4['id']}/accept", json={"deliverables": "One community post."}).json()
chk4 = brand.post(f"/api/video/studio/sponsorships/deals/{deal4['id']}/fund", json={"idempotency_key": uuid.uuid4().hex}).json()
pay(brand, chk4["id"])
r = brand.post(f"/api/video/studio/sponsorships/deals/{deal4['id']}/cancel")
check("cancelled with a refund", (r.json()["status"], sql("SELECT sum(amount_minor) FROM kv_commerce.refunds WHERE checkout_id = :c",
                                                          c=chk4["id"])[0][0]), ("refunded", 100000))
check("every journal balances", sql("SELECT count(*) FROM (SELECT journal_id FROM kv_ledger.journal_lines GROUP BY journal_id "
                                     "HAVING sum(debit_minor) <> sum(credit_minor)) x")[0][0], 0)

finish()
