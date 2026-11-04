"""Run 6 admin support desk: lookup, account timeline, refund and sign-out from one place, read-only support sessions, audit."""

from __future__ import annotations

import httpx

from harness import BASE, admin_login, check, client, creator, finish, ok, premium, signup, sql

admin = admin_login()
buyer = signup("Desk Buyer")
premium(buyer)
maker = creator("Desk Creator")
handle = maker.get("/api/video/studio/channel").json()["channel"]["handle"]

print("\n== lookup")
hits = admin.get("/api/video/admin/support/lookup", params={"q": buyer.email[:14]}).json()
ok("by part of an email", any(h["id"] == buyer.user["id"] for h in hits), hits[:2])
hits = admin.get("/api/video/admin/support/lookup", params={"q": f"@{handle}"}).json()
check("by channel handle", [h["id"] for h in hits if h["channel"]][:1], [maker.user["id"]])
pay = sql("SELECT p.id, c.gateway_order_id FROM kv_commerce.payments p JOIN kv_commerce.checkouts c ON c.id = p.checkout_id "
          "WHERE c.user_id = :u ORDER BY p.id DESC LIMIT 1", u=buyer.user["id"])[0]
hits = admin.get("/api/video/admin/support/lookup", params={"q": pay[1]}).json()
check("by payment order id", [h["id"] for h in hits][:1], [buyer.user["id"]])
check("by user id", admin.get("/api/video/admin/support/lookup", params={"q": str(buyer.user["id"])}).json()[0]["id"], buyer.user["id"])
check("a viewer cannot use the desk", signup("Desk Nosy").get("/api/video/admin/support/lookup", params={"q": "suite"}).status_code, 403)

print("\n== account timeline")
acct = admin.get(f"/api/video/admin/support/users/{buyer.user['id']}").json()
kinds = {e["kind"] for e in acct["events"]}
ok("sign-up, sign-in and the purchase are on it", {"signup", "purchase"} <= kinds, kinds)
purchase = next(e for e in acct["events"] if e["kind"] == "purchase")
check("the purchase links to its payment", purchase["payment_id"], pay[0])

print("\n== actions from the desk")
r = admin.post(f"/api/video/admin/payments/{pay[0]}/refund", json={"reason": "Support desk goodwill"})
check("refund from the desk", r.status_code, 201)
acct = admin.get(f"/api/video/admin/support/users/{buyer.user['id']}").json()
ok("the refund shows on the timeline", any(e["kind"] == "refund" for e in acct["events"]))
check("a sign-out needs a reason", admin.post(f"/api/video/admin/support/users/{buyer.user['id']}/sign-out", json={"reason": ""}).status_code, 422)
check("signed in before", buyer.get("/api/video/me").status_code, 200)
r = admin.post(f"/api/video/admin/support/users/{buyer.user['id']}/sign-out", json={"reason": "Customer asked to sign out everywhere"})
check("sign out everywhere", r.status_code, 200)
check("the old token stops working", buyer.get("/api/video/me").status_code, 401)

unverified = signup("Desk Unverified")
r = admin.post(f"/api/video/admin/support/users/{unverified.user['id']}/verify-email").json()
mail = sql("SELECT template, data->>'link' FROM kv_admin.mail_outbox WHERE to_email = :e ORDER BY id DESC LIMIT 1", e=unverified.email.lower())
check("verification mails go through the outbox", (r["sent"], mail[0][0], "/verify" in (mail[0][1] or "")), (True, "account_verify", True))
r = httpx.post(f"{BASE}/api/auth/forgot", json={"email": unverified.email}, timeout=30)
ok("a password reset link is captured too", sql("SELECT count(*) FROM kv_admin.mail_outbox WHERE to_email = :e AND template = "
                                                "'account_reset'", e=unverified.email.lower())[0][0] == 1, r.status_code)

print("\n== read-only support sessions")
r = admin.post(f"/api/video/admin/support/users/{maker.user['id']}/support-session", json={"reason": "Creator cannot find their clip"})
check("a support session opens", (r.status_code, r.json().get("read_only")), (201, True))
sess = client(r.json()["access_token"])
check("support can see what the creator sees", sess.get("/api/video/studio/videos").status_code, 200)
check("but cannot change anything", sess.patch("/api/video/studio/channel", json={"about": "changed by support"}).status_code, 403)
check("nor the admin's own account", admin.post(f"/api/video/admin/support/users/{admin.get('/api/auth/me').json()['id']}/support-session",
                                                json={"reason": "Trying myself out"}).status_code, 403)
admin.post(f"/api/video/admin/support/sessions/{r.json()['session_id']}/end")
check("ending the session ends the token", sess.get("/api/video/studio/videos").status_code, 401)
actions = {a for (a,) in sql("SELECT action FROM kv_admin.audit_log WHERE action LIKE 'support.%' AND target_id IN (:a, :b, :c)",
                             a=buyer.user["id"], b=maker.user["id"], c=r.json()["session_id"])}
ok("every desk action is audited", {"support.sign_out", "support.session", "support.session_end"} <= actions, actions)

finish()
