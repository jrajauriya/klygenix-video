import httpx

from harness import BASE, check, finish, ok, signup, sql, wait_for

print("\n== Plans")
plans = httpx.get(f"{BASE}/api/video/plans").json()
keys = [p["key"] for p in plans]
check("five plans seeded", keys, ["viewer_free", "viewer_premium", "creator_free", "creator_pro", "creator_business"])
us = {p["key"]: p for p in httpx.get(f"{BASE}/api/video/plans", params={"country": "US"}).json()}
check("US prices in dollars", (us["viewer_premium"]["currency"], us["viewer_premium"]["price_minor"]), ("USD", 499))

print("\n== Checkout → verified payment → entitlement (S02)")
u = signup("Payer")
check("a free plan cannot be bought", u.post("/api/video/checkout", json={"plan_key": "viewer_free"}).status_code, 404)
r = u.post("/api/video/checkout", json={"plan_key": "creator_pro", "idempotency_key": "suite-key-1"})
check("checkout created", r.status_code, 201)
chk = r.json()
check("server priced it", chk["amount_minor"], 49900)
r2 = u.post("/api/video/checkout", json={"plan_key": "creator_pro", "idempotency_key": "suite-key-1"})
check("same idempotency key returns the same checkout", r2.json()["id"], chk["id"])
check("nothing granted before payment", u.get("/api/video/me").json()["plans"]["creator"]["key"], "creator_free")
u.post(f"/api/video/sandbox/pay/{chk['id']}")
ok("plan granted after the verified callback",
   wait_for(lambda: u.get("/api/video/me").json()["plans"]["creator"]["key"] == "creator_pro", 30))
pays = sql("select count(*) from kv_commerce.payments where checkout_id=:c", c=chk["id"])[0][0]
check("one payment row", pays, 1)
row = sql("select body from kv_commerce.provider_events where rail='sandbox' order by id desc limit 1")[0][0]
from app.video.rails.sandbox import sign  # noqa: E402

httpx.post(f"{BASE}/api/video/webhooks/payments/sandbox", content=row.encode(), headers={"X-Sandbox-Signature": sign(row.encode())})
import time  # noqa: E402

time.sleep(2)
check("a replayed callback pays nothing twice", sql("select count(*) from kv_commerce.payments where checkout_id=:c", c=chk["id"])[0][0], 1)
r = httpx.post(f"{BASE}/api/video/webhooks/payments/sandbox", content=b'{"id":"forged","event":"payment.captured"}',
               headers={"X-Sandbox-Signature": "forged"})
check("an unsigned callback is refused", r.status_code, 400)
inv = u.get("/api/video/me/invoices").json()
check("one invoice issued", len(inv), 1)
ok("invoice numbered in its series", inv[0]["number"].startswith("PLY/"), inv[0]["number"])
pdf = u.get(f"/api/video/me/invoices/{inv[0]['id']}.pdf")
check("invoice PDF served", (pdf.status_code, pdf.headers.get("content-type")), (200, "application/pdf"))
bal = sql("select sum(debit_minor) - sum(credit_minor) from kv_ledger.journal_lines jl join kv_ledger.journals j on j.id = jl.journal_id "
          "where j.source_type='plan_payment'")[0][0]
check("ledger balances (debits = credits)", int(bal or 0), 0)

print("\n== Failure, cancel and lapse")
v = signup("Failer")
chk2 = v.post("/api/video/checkout", json={"plan_key": "viewer_premium"}).json()
v.post(f"/api/video/sandbox/pay/{chk2['id']}", params={"outcome": "failed"})
ok("failed payment marks the checkout failed", wait_for(lambda: v.get(f"/api/video/checkout/{chk2['id']}").json()["status"] == "failed", 20))
check("failed payment grants nothing", v.get("/api/video/me").json()["plans"]["viewer"]["key"], "viewer_free")
r = u.post("/api/video/me/plans/creator/cancel").json()
check("cancel at period end", r["cancelled"], True)
uid_ = u.get("/api/video/me").json()["user"]["id"]
sql("update kv_commerce.subscriptions set current_period_end = now() - interval '1 hour' where user_id=:u", u=uid_)
from app.video.commerce.service import lapse_due  # noqa: E402
from app.video.sessions import platform_session  # noqa: E402

with platform_session() as db:
    lapse_due(db)
    db.commit()
check("cancelled plan ends at period end", u.get("/api/video/me").json()["plans"]["creator"]["key"], "creator_free")
check("subscription marked cancelled", sql("select status from kv_commerce.subscriptions where user_id=:u", u=uid_)[0][0], "cancelled")
check("other users cannot read a checkout", v.get(f"/api/video/checkout/{chk['id']}").status_code, 404)

finish()
