"""V5.3 TV sign-in with a device code (RFC 8628 shape): start, approve on the web, poll once for the token."""

from __future__ import annotations

import httpx

from harness import BASE, check, client, finish, ok, signup

anon = client()
print("\n== the TV asks for a code")
r = anon.post("/api/auth/device/start", json={"client": "tv"})
check("code issued", r.status_code, 200)
d = r.json()
ok("an 8-character code in two halves, a link and a 10-minute expiry", len(d["user_code"]) == 9 and d["user_code"][4] == "-"
   and d["verification_uri"].endswith("/activate") and d["expires_in"] == 600 and d["interval"] == 5, d)
ok("no confusable letters", not set(d["user_code"].replace("-", "")) & set("AEIOU01"), d["user_code"])
r = anon.post("/api/auth/device/poll", json={"device_code": d["device_code"]})
check("pending until approved", (r.status_code, r.json()["error"]), (400, "authorization_pending"))
r = anon.post("/api/auth/device/poll", json={"device_code": d["device_code"]})
check("polling too fast is told to slow down", r.json()["error"], "slow_down")

print("\n== the viewer approves on the web")
check("approval needs a signed-in viewer", anon.post("/api/auth/device/approve", json={"user_code": d["user_code"]}).status_code in (401, 403), True)
viewer = signup("TV Viewer")
info = viewer.get(f"/api/auth/device/{d['user_code'].lower()}").json()
check("the activate page can describe the request (any case, dash optional)", (info["client"], info["status"]), ("tv", "pending"))
check("unknown codes", viewer.get("/api/auth/device/ZZZZ-ZZZZ").status_code, 404)
check("approved", viewer.post("/api/auth/device/approve", json={"user_code": d["user_code"].replace("-", "")}).json(), {"status": "approved"})
check("twice is refused", viewer.post("/api/auth/device/approve", json={"user_code": d["user_code"]}).status_code, 409)
r = anon.post("/api/auth/device/poll", json={"device_code": d["device_code"]})
check("the TV gets a token for that viewer", (r.status_code, r.json()["user"]["email"]), (200, viewer.email))
tv = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {r.json()['access_token']}"})
check("and it works", tv.get("/api/video/me").status_code, 200)
r = anon.post("/api/auth/device/poll", json={"device_code": d["device_code"]})
check("the device code works once", r.json()["error"], "expired_token")

print("\n== denied and forged")
d2 = anon.post("/api/auth/device/start", json={}).json()
viewer.post("/api/auth/device/deny", json={"user_code": d2["user_code"]})
check("denied", anon.post("/api/auth/device/poll", json={"device_code": d2["device_code"]}).json()["error"], "access_denied")
check("a forged device code", anon.post("/api/auth/device/poll", json={"device_code": "x" * 40}).json()["error"], "expired_token")

finish()
