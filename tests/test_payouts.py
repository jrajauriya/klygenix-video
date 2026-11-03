from harness import (PAYOUT_ACCOUNT, admin_login, check, creator, finish, ok, settled, signup, sql, support_pay, upload,
                     wait_for)

ACCOUNT = PAYOUT_ACCOUNT
pay = support_pay


def sales(c):
    return c.get("/api/video/studio/earnings/sales").json()


def balanced(tenant_id):
    rows = sql("""SELECT count(*) FROM (SELECT j.id FROM kv_ledger.journals j JOIN kv_ledger.journal_lines l ON l.journal_id = j.id
                  WHERE j.tenant_id = :t GROUP BY j.id HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)) x""", t=tenant_id)
    return rows[0][0] == 0


print("\n== Selling is blocked until payouts are set up (S11)")
c = creator("Payout Creator")
tenant = c.user["tenant_id"]
v = settled(c, upload(c, "reel-chai", "Tip jar reel")["id"])
fan = signup("Payout Fan")
r = fan.post("/api/video/support/checkout", json={"purpose": "tip", "amount_minor": 10000, "video_id": v["public_id"]})
check("tip refused before the creator's payouts are active", r.status_code, 409)
e = c.get("/api/video/studio/earnings").json()
check("studio earnings says money is off", e["can_take_money"], False)
check("commission on the free creator plan is 20%", e["commission_bps"], 2000)
r = c.post("/api/video/studio/earnings/account/submit")
check("submitting with no details is refused", r.status_code, 404)
r = c.put("/api/video/studio/earnings/account", json={"legal_name": "A", "pan": "BAD", "account_number": "12ab"})
check("a bank number with letters is refused", r.status_code, 400)
r = c.put("/api/video/studio/earnings/account", json={"legal_name": "A", "pan": "BAD"})
ok("incomplete details list what is missing", len(r.json()["problems"]) >= 5, r.json()["problems"])
check("incomplete details cannot be submitted", c.post("/api/video/studio/earnings/account/submit").status_code, 400)
r = c.put("/api/video/studio/earnings/account", json=ACCOUNT)
check("full details saved", (r.status_code, r.json()["problems"]), (200, []))
check("only the last four digits come back", r.json()["account"]["account_last4"], "9012")
stored = sql("SELECT account_number FROM kv_commerce.payout_accounts WHERE tenant_id = :t", t=tenant)[0][0]
ok("the bank number is sealed at rest", stored.startswith("enc:") and "123456789012" not in stored, stored[:12])
r = c.post("/api/video/studio/earnings/account/submit")
check("sandbox Route activates the linked account", r.json()["account"]["status"], "activated")
check("a submitted account is locked for edits", c.put("/api/video/studio/earnings/account", json={"phone": "9999999999"}).status_code, 409)
check("studio earnings now says money is on", c.get("/api/video/studio/earnings").json()["can_take_money"], True)
bad = creator("Clarify Creator")
bad.put("/api/video/studio/earnings/account", json={**ACCOUNT, "pan": "AAAAA1234A"})
r = bad.post("/api/video/studio/earnings/account/submit")
check("a PAN the gateway questions needs clarification", r.json()["account"]["status"], "needs_clarification")
ok("the gateway's reason is shown", r.json()["account"]["requirements"], r.json())

print("\n== Guard rails on the checkout")
check("a tip below the minimum is refused", fan.post("/api/video/support/checkout", json={
    "purpose": "tip", "amount_minor": 500, "video_id": v["public_id"]}).status_code, 400)
check("a creator cannot tip their own channel", c.post("/api/video/support/checkout", json={
    "purpose": "tip", "amount_minor": 10000, "video_id": v["public_id"]}).status_code, 409)
abroad = signup("Abroad Fan", country="US")
check("creator money is India-only for now", abroad.post("/api/video/support/checkout", json={
    "purpose": "tip", "amount_minor": 10000, "video_id": v["public_id"]}).status_code, 409)
check("a linked message is refused", fan.post("/api/video/support/checkout", json={
    "purpose": "tip", "amount_minor": 10000, "video_id": v["public_id"], "message": "visit http://spam.example"}).status_code, 400)

print("\n== A tip is split and held (S10, S11)")
chk = pay(fan, {"purpose": "tip", "amount_minor": 10000, "video_id": v["public_id"], "message": "Loved the chai tip!"})
s = wait_for(lambda: (sales(c) or [None])[0], 30)
check("one sale recorded", (s["purpose"], s["gross_minor"]), ("tip", 10000))
check("commission 20% of the tip", s["commission_minor"], 2000)
check("GST on the commission is 18%", s["commission_tax_minor"], 360)
check("no TCS on a tip from an unregistered creator", s["tcs_minor"], 0)
check("no TDS under the individual threshold", s["tds_minor"], 0)
check("net to the creator", s["net_minor"], 7640)
check("reserve is 5% of net", s["reserve_minor"], 382)
tr = c.get("/api/video/studio/earnings/transfers").json()
check("a sale and a reserve transfer, both held", sorted((t["kind"], t["status"], t["amount_minor"]) for t in tr),
      [("reserve", "held", 382), ("sale", "held", 7258)])
ok("the sale is held for the refund window", all(t["hold_until"] for t in tr))
b = c.get("/api/video/studio/earnings").json()["balances"]
check("balances show held and reserve", (b["held_minor"], b["reserve_minor"], b["released_minor"]), (7258, 382, 0))
comments = fan.get(f"/api/video/videos/{v['public_id']}/comments").json()
rows = comments if isinstance(comments, list) else comments.get("comments", comments.get("items", []))
tip = next((x for x in rows if x.get("paid_minor")), None)
check("the tip shows as a highlighted comment", (tip or {}).get("paid_minor"), 10000)
ok("the creator's books balance", balanced(tenant))
adm = admin_login()
owed = next(x for x in adm.get("/api/video/admin/money/creators").json() if x["tenant_id"] == tenant)
check("the platform owes the creator exactly the net", owed["ledger_owed_minor"], 7640)
check("a fan does not see the admin money screens", fan.get("/api/video/admin/money/summary").status_code in (401, 403), True)

print("\n== Release after the window")
check("nothing is due yet", adm.post("/api/video/admin/money/release-due").json()["released"], 0)
sql("UPDATE kv_commerce.route_transfers SET hold_until = now() - interval '1 day' WHERE tenant_id = :t AND kind = 'sale'", t=tenant)
check("the sale releases once due", adm.post("/api/video/admin/money/release-due").json()["released"], 1)
b = c.get("/api/video/studio/earnings").json()["balances"]
check("released and reserve after release", (b["held_minor"], b["reserve_minor"], b["released_minor"]), (0, 382, 7258))
owed = next(x for x in adm.get("/api/video/admin/money/creators").json() if x["tenant_id"] == tenant)
check("the ledger still owes the reserve", owed["ledger_owed_minor"], 382)
ok("the creator's books still balance", balanced(tenant))

print("\n== Refund after payout is recovered from the next sale")
pay_id = next(p["id"] for p in adm.get("/api/video/admin/payments?purpose=tip").json() if p["checkout_id"] == chk["id"])
r = adm.post(f"/api/video/admin/payments/{pay_id}/refund", json={"reason": "Fan asked for it back"})
check("refund processed", (r.status_code, r.json()["status"]), (201, "processed"))
check("nothing left to refund", r.json()["payment"]["refundable_minor"], 0)
r2 = adm.post(f"/api/video/admin/payments/{pay_id}/refund", json={"reason": "again"})
check("a second refund is refused", r2.status_code, 400)
tr = c.get("/api/video/studio/earnings/transfers").json()
check("the reserve is reversed", next(t["status"] for t in tr if t["kind"] == "reserve"), "reversed")
rec = next(t for t in tr if t["kind"] == "recovery")
check("the rest is owed back", (rec["status"], rec["amount_minor"]), ("pending", 7258))
check("balances show the debt", c.get("/api/video/studio/earnings").json()["balances"]["owed_back_minor"], 7258)
comments = fan.get(f"/api/video/videos/{v['public_id']}/comments").json()
rows = comments if isinstance(comments, list) else comments.get("comments", comments.get("items", []))
check("the refunded tip is no longer highlighted", max((x.get("paid_minor") or 0) for x in rows), 0)
pay(fan, {"purpose": "tip", "amount_minor": 20000, "video_id": v["public_id"]})
wait_for(lambda: len(sales(c)) == 2, 30)
tr = c.get("/api/video/studio/earnings/transfers").json()
check("the debt is netted from the next sale", next(t["status"] for t in tr if t["kind"] == "recovery"), "recovered")
new_sale = max((t for t in tr if t["kind"] == "sale"), key=lambda t: t["id"])
check("the next sale pays only what is left", (new_sale["amount_minor"], new_sale["open_minor"]), (14516, 7258))
owed = next(x for x in adm.get("/api/video/admin/money/creators").json() if x["tenant_id"] == tenant)
b = c.get("/api/video/studio/earnings").json()["balances"]
check("ledger owed equals open transfers", owed["ledger_owed_minor"],
      b["held_minor"] + b["reserve_minor"] + b["pending_minor"] - b["owed_back_minor"])
ok("the creator's books balance after a refund", balanced(tenant))

print("\n== Partial refund while held")
p2 = max((p for p in adm.get("/api/video/admin/payments?purpose=tip").json() if p["channel"]), key=lambda p: p["id"])
r = adm.post(f"/api/video/admin/payments/{p2['id']}/refund", json={"reason": "Half back", "amount_minor": 5000})
check("partial refund processed", r.json()["payment"]["refundable_minor"], 15000)
tr = c.get("/api/video/studio/earnings/transfers").json()
check("no new debt when the money is still held", sum(1 for t in tr if t["kind"] == "recovery"), 1)
owed = next(x for x in adm.get("/api/video/admin/money/creators").json() if x["tenant_id"] == tenant)
b = c.get("/api/video/studio/earnings").json()["balances"]
check("ledger owed still equals open transfers", owed["ledger_owed_minor"],
      b["held_minor"] + b["reserve_minor"] + b["pending_minor"] - b["owed_back_minor"])
ok("every platform journal balances", balanced(sql("SELECT id FROM kv_admin.tenants WHERE slug = 'klygenix-video-admin'")[0][0]))

print("\n== TDS for a company")
co = creator("Company Creator")
co.put("/api/video/studio/earnings/account", json={**ACCOUNT, "business_type": "private_limited", "legal_name": "Chai Media Pvt Ltd",
                                                   "email": "co@example.com", "pan": "ABCPE1234F"})
co.post("/api/video/studio/earnings/account/submit")
cv = settled(co, upload(co, "reel-git-mistake", "Company reel")["id"])
pay(fan, {"purpose": "tip", "amount_minor": 10000, "video_id": cv["public_id"]})
cs = wait_for(lambda: (sales(co) or [None])[0], 30)
check("194-O TDS of 0.1% applies to a company", cs["tds_minor"], 10)
check("net after TDS", cs["net_minor"], 10000 - 2000 - 360 - 10)

print("\n== Statements, commission invoices, tax files")
st = c.get("/api/video/studio/earnings/statement").json()
check("the month's statement lists both sales", len(st["sales"]), 2)
check("statement totals add up", st["totals"]["gross_minor"], 30000)
csv_r = c.get("/api/video/studio/earnings/statement?format=csv")
ok("statement downloads as CSV", csv_r.status_code == 200 and csv_r.text.startswith("paid_at,"), csv_r.text[:60])
r = adm.post("/api/video/admin/money/commission-invoices")
ok("commission invoices issued", r.json()["issued"] >= 2, r.json())
inv = c.get("/api/video/studio/earnings/commission-invoices").json()
check("the creator sees one commission invoice for the month", len(inv), 1)
check("it bills the commission on both sales", inv[0]["taxable_minor"], 6000)
check("issuing again adds nothing", adm.post("/api/video/admin/money/commission-invoices").json()["issued"], 0)
g = adm.get("/api/video/admin/money/reports/gstr8.csv")
ok("GSTR-8 file downloads", g.status_code == 200 and g.text.startswith("supplier_gstin"), g.text[:40])
t = adm.get("/api/video/admin/money/reports/tds-194o.csv")
ok("194-O file lists the company's PAN", "ABCPE1234F" in t.text, t.text)

print("\n== Tenancy")
other = creator("Nosy Creator")
check("another creator sees none of these sales", other.get("/api/video/studio/earnings/sales").json(), [])
check("nor their transfers", other.get("/api/video/studio/earnings/transfers").json(), [])
check("a viewer without a channel is sent to open one first", fan.get("/api/video/studio/earnings").status_code, 409)

finish()
