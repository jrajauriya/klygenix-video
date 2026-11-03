from harness import admin_login, check, creator, finish, ok, premium, signup, sql

print("\n== Refunding a plan (S03: one revoke)")
adm = admin_login()
v = signup("Refund Viewer")
premium(v)
check("on Premium before the refund", v.get("/api/video/me").json()["plans"]["viewer"]["key"], "viewer_premium")
p = next(x for x in adm.get("/api/video/admin/payments?purpose=plan").json() if x["buyer"] == v.email)
check("the payment is fully refundable", p["refundable_minor"], 14900)
r = adm.post(f"/api/video/admin/payments/{p['id']}/refund", json={"reason": "Bought by mistake", "amount_minor": 4900})
check("a partial refund is processed", (r.status_code, r.json()["payment"]["refundable_minor"]), (201, 10000))
check("a partial refund keeps the plan", v.get("/api/video/me").json()["plans"]["viewer"]["key"], "viewer_premium")
check("a refund larger than what is left is refused", adm.post(f"/api/video/admin/payments/{p['id']}/refund",
                                                               json={"reason": "Too much", "amount_minor": 20000}).status_code, 400)
r = adm.post(f"/api/video/admin/payments/{p['id']}/refund", json={"reason": "The rest", "idempotency_key": f"rest-{p['id']}"})
check("the rest is refunded", r.json()["payment"]["refundable_minor"], 0)
again = adm.post(f"/api/video/admin/payments/{p['id']}/refund", json={"reason": "The rest", "idempotency_key": f"rest-{p['id']}"})
check("the same idempotency key returns the same refund", again.json()["id"], r.json()["id"])
check("a full refund ends the plan", v.get("/api/video/me").json()["plans"]["viewer"]["key"], "viewer_free")
notes = sql("""SELECT count(*), coalesce(sum(total_minor), 0) FROM kv_tax.tax_invoices
               WHERE kind = 'credit_note' AND order_id = :o""", o=p["checkout_id"])[0]
check("one credit note per refund, summing to the payment", (notes[0], notes[1]), (2, 14900))
admin_tenant = sql("SELECT id FROM kv_admin.tenants WHERE slug = 'klygenix-video-admin'")[0][0]
rev = sql("""SELECT coalesce(sum(l.debit_minor), 0) FROM kv_ledger.journals j JOIN kv_ledger.journal_lines l ON l.journal_id = j.id
             WHERE j.tenant_id = :t AND j.source_type = 'plan_refund' AND j.source_id IN
             (SELECT id FROM kv_commerce.refunds WHERE payment_id = :p)""", t=admin_tenant, p=p["id"])[0][0]
check("the refunds are reversed in the books", rev, 14900)
bad = sql("""SELECT count(*) FROM (SELECT j.id FROM kv_ledger.journals j JOIN kv_ledger.journal_lines l ON l.journal_id = j.id
             WHERE j.tenant_id = :t GROUP BY j.id HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)) x""", t=admin_tenant)[0][0]
check("every platform journal balances", bad, 0)
ok("refunds are listed for the admin", any(x["payment_id"] == p["id"] for x in adm.get("/api/video/admin/refunds").json()))
check("refunds need the money permission", v.post(f"/api/video/admin/payments/{p['id']}/refund", json={"reason": "mine"}).status_code in (401, 403), True)
audit = sql("SELECT count(*) FROM kv_admin.audit_log WHERE action = 'money.refund' AND target_id = :p", p=p["id"])
check("each refund is audited", audit[0][0] if audit else 0, 2)

print("\n== Creator Pro refunded")
c = creator("Refunded Creator")
premium(c, "creator_pro")
p = next(x for x in adm.get("/api/video/admin/payments?purpose=plan").json() if x["buyer"] == c.email)
adm.post(f"/api/video/admin/payments/{p['id']}/refund", json={"reason": "Not needed"})
check("the creator is back on the free plan", c.get("/api/video/me").json()["plans"]["creator"]["key"], "creator_free")
check("and the free plan's commission applies again", c.get("/api/video/studio/earnings").json()["commission_bps"], 2000)

finish()
