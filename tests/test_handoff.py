"""One sign-in across Play and Studio: a one-time handoff code, and the client crash report."""

from __future__ import annotations

import hashlib

import httpx

from harness import BASE, PASSWORD, check, client, finish, ok, signup

from app.core.redis_client import get_redis

me = "/api/auth/me"
redeem = f"{BASE}/api/auth/handoff/redeem"

print("\n== a signed-in user gets a code that signs them in once")
user = signup("Handoff Person")
r = user.post("/api/auth/handoff")
check("code issued", r.status_code, 200)
code = r.json()["code"]
ok("code is long and random", len(code) >= 40, len(code))
ok("only its hash is stored", get_redis().ttl("kv:handoff:" + hashlib.sha256(code.encode()).hexdigest()) > 0)
ok("the code itself is not a key", not get_redis().exists(f"kv:handoff:{code}"))
r = httpx.post(redeem, json={"code": code})
check("redeemed", r.status_code, 200)
token = r.json()["access_token"]
check("the new token works", client(token).get(me).json()["email"], user.email)
check("same user", r.json()["user"]["id"], user.user["id"])
r = httpx.post(redeem, json={"code": code})
check("second use refused", (r.status_code, r.json().get("code")), (401, "handoff_invalid"))

print("\n== refusals")
check("no token, no code", httpx.post(f"{BASE}/api/auth/handoff").status_code in (401, 403), True)
check("unknown code", httpx.post(redeem, json={"code": "x" * 43}).status_code, 401)
check("too short to be a code", httpx.post(redeem, json={"code": "short"}).status_code, 422)
code = user.post("/api/auth/handoff").json()["code"]
get_redis().delete("kv:handoff:" + hashlib.sha256(code.encode()).hexdigest())
check("expired code", httpx.post(redeem, json={"code": code}).status_code, 401)

print("\n== a password change in between voids the code")
code = user.post("/api/auth/handoff").json()["code"]
r = user.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "Another@12345"})
check("password changed", r.status_code, 200)
check("old code refused", httpx.post(redeem, json={"code": code}).status_code, 401)

print("\n== client crash reports")
report = f"{BASE}/api/observe/client-error"
check("small report accepted", httpx.post(report, json={"app": "web", "path": "/", "name": "TypeError", "message": "x is undefined"}).status_code, 204)
check("large report refused", httpx.post(report, content=b'{"message":"' + b"a" * 3000 + b'"}', headers={"Content-Type": "application/json"}).status_code, 413)
check("garbage refused", httpx.post(report, content=b"not json", headers={"Content-Type": "application/json"}).status_code, 400)
check("a list refused", httpx.post(report, json=[1, 2]).status_code, 400)

finish()
