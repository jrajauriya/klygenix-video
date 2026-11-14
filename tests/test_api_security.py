"""Calling the API like Postman would: with no token, a forged token, an old token, the wrong kind of token."""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from harness import BASE, PASSWORD, check, client, creator, finish, ok, premium, settled, signup, sql, upload, uid

from app.config import settings
from app.main import app

tc = TestClient(app, client=("127.0.0.1", 50000))

PUBLIC = {
    "GET /health", "GET /metrics",
    "GET /api/auth/region", "GET /api/auth/signup/open",
    "POST /api/auth/login", "POST /api/auth/google", "POST /api/auth/google/complete", "POST /api/auth/signup",
    "POST /api/auth/verify", "POST /api/auth/forgot", "POST /api/auth/reset", "POST /api/auth/invite/accept",
    "POST /api/auth/device/start", "POST /api/auth/device/poll", "POST /api/auth/handoff/redeem",
    "GET /api/video/feed/home", "GET /api/video/feed/reels", "GET /api/video/search", "GET /api/video/search/suggest", "GET /api/video/render",
    "GET /api/video/videos/{public_id}", "GET /api/video/videos/{public_id}/related",
    "GET /api/video/videos/{public_id}/comments", "GET /api/video/videos/{public_id}/comments/summary",
    "GET /api/video/videos/{public_id}/danmaku", "GET /api/video/videos/{public_id}/captions/{lang}.vtt",
    "GET /api/video/videos/{public_id}/transcript", "GET /api/video/videos/{public_id}/study/{kind}",
    "POST /api/video/videos/{public_id}/progress", "POST /api/video/translate",
    "GET /api/video/channels/{handle}", "GET /api/video/channels/{handle}/videos", "GET /api/video/channels/{handle}/live",
    "GET /api/video/channels/{handle}/playlists", "GET /api/video/channels/{handle}/posts", "GET /api/video/channels/{handle}/support",
    "GET /api/video/playlists/{playlist_id}", "GET /api/video/images/{name}",
    "GET /api/video/live", "GET /api/video/live/{public_id}", "GET /api/video/live/{public_id}/chat",
    "GET /api/video/plans", "GET /api/video/beta", "GET /api/video/brands", "GET /api/video/company",
    "GET /api/video/ads/breaks", "GET /api/video/ads/categories", "GET /api/video/ads/decision", "POST /api/video/ads/events",
    "POST /api/video/products/{link_id}/click", "POST /api/video/takedowns", "POST /api/video/feedback",
    "POST /api/video/invites/check", "POST /api/video/waitlist", "POST /api/video/waitlist/confirm",
    "GET /api/video/channels/youtube/callback", "GET /api/video/channels/instagram/callback",
    "POST /api/video/webhooks/cloudflare-live", "POST /api/video/webhooks/media/{provider}", "POST /api/video/webhooks/payments/{rail}",
    "POST /api/observe/tunnel", "POST /api/observe/client-error",
    "GET /api/video/dubs/{video_id}/{language}/{exp}/{sig}.m4a", "GET /api/video/studio/clip-files/{clip_id}/{exp}/{sig}.mp4",
    "GET /api/video/sandbox/download/{video_id}/{exp}/{sig}.mp4", "GET /api/video/sandbox/thumb/{video_id}/{exp}/{sig}.jpg",
    "GET /api/video/sandbox/hls/{video_id}/{exp}/{sig}/{path:path}",
    "GET /api/video/sandbox/hls-preview/{video_id}/{seconds}/{exp}/{sig}/{path:path}",
    "GET /api/video/sandbox/live/{stream_id}/{exp}/{sig}/{name}", "PUT /api/video/sandbox/upload/{video_id}/{exp}/{sig}",
}
GUARDS = ("get_current_user", "signed_in", "studio", "platform", "require", "notices", "get_tenant_db", "get_current_tenant")


def routes(items):
    for r in items:
        if type(r).__name__ == "_IncludedRouter":
            yield from routes(r.effective_candidates())
        elif getattr(r, "methods", None) and (getattr(r, "dependant", None) or getattr(getattr(r, "original_route", None), "dependant", None)):
            yield r


def calls(d, out):
    if d is None:
        return out
    if d.call:
        out.add(getattr(d.call, "__qualname__", str(d.call)))
    for sub in d.dependencies:
        calls(sub, out)
    return out


def guarded(r) -> bool:
    dep = r.dependant or r.original_route.dependant
    names = calls(dep, set()) | {getattr(d.dependency, "__qualname__", "") for d in (r.dependencies or [])}
    return any(g in n for n in names for g in GUARDS)


print("\n== every route needs a login unless it is on the reviewed public list")
public_now, private = set(), []
for r in routes(app.routes):
    for m in r.methods - {"HEAD", "OPTIONS"}:
        if guarded(r):
            private.append((m, r.path))
        else:
            public_now.add(f"{m} {r.path}")
check("no new route without a login check", sorted(public_now - PUBLIC), [])
ok("the private routes were found", len(private) > 300, len(private))

print("\n== with no token, every private route refuses")
leaks = []
for m, path in private:
    url = re.sub(r"\{[^}:]+(:[^}]+)?\}", "1", path)
    status = tc.request(m, url, json={}).status_code
    if status not in (401, 403):
        leaks.append(f"{m} {path} -> {status}")
check("no private route answers without a token", leaks, [])

print("\n== forged and stale tokens")
me = "/api/auth/me"
user = signup("Token Person")
claims = {"user_id": user.user["id"], "tenant_id": user.user["tenant_id"], "role": user.user["role"], "ep": 0}
none_alg = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode().rstrip("=") + "." + \
    base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=") + "."
check("alg none is refused", client(none_alg).get(me).status_code, 401)
check("a token signed with another key is refused",
      client(jwt.encode({**claims, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, "guess", algorithm="HS256")).get(me).status_code, 401)
check("an expired token is refused",
      client(jwt.encode({**claims, "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}, settings.SECRET_KEY, algorithm="HS256")).get(me).status_code, 401)
check("a garbage token is refused", client("not-a-token").get(me).status_code, 401)
ticket = jwt.encode({"aud": "google_signup", "sub": "x", "email": user.email, "user_id": user.user["id"],
                     "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, settings.SECRET_KEY, algorithm="HS256")
check("a Google sign-up ticket is not a session", client(ticket).get(me).status_code, 401)
old = user.headers["Authorization"].split()[1]
other = httpx.post(f"{BASE}/api/auth/login", json={"email": user.email, "password": PASSWORD}).json()["access_token"]
r = user.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "short"})
check("a short new password is refused", r.status_code, 400)
r = user.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "Another@12345"})
check("password changed", r.status_code, 200)
fresh = r.json().get("access_token")
check("the old token stops working", client(old).get(me).status_code, 401)
check("so does the other device", client(other).get(me).status_code, 401)
check("this device gets a fresh token that works", client(fresh).get(me).status_code if fresh else None, 200)

print("\n== Google test tokens only from this machine")
raw = base64.urlsafe_b64encode(json.dumps({"sub": f"s{uid()}", "email": user.email, "email_verified": True}).encode()).decode().rstrip("=")
far = TestClient(app, client=("203.0.113.9", 50000))
check("a sandbox Google token from outside is refused", far.post("/api/auth/google", json={"token": "sandbox." + raw}).status_code in (401, 501), True)
check("and the account was not linked", sql("SELECT google_sub FROM kv_admin.users WHERE email = :e", e=user.email)[0][0], None)

print("\n== the media webhook refuses the sandbox provider when sandbox is off")
from fakehttp import configured  # noqa: E402

with configured(SANDBOX_ENABLED=False):
    check("sandbox provider refused", tc.post("/api/video/webhooks/media/sandbox", content=b"{}").status_code, 404)

print("\n== translate only reads comments anyone could already read")
owner = creator("Private Owner")
vid = upload(owner, "chai-hindi", title="Soon private")
settled(owner, vid["id"])
pid = owner.get(f"/api/video/studio/videos/{vid['id']}").json()["public_id"]
cid = signup("Commenter").post(f"/api/video/videos/{pid}/comments", json={"body": "A secret plan for the launch"}).json()["id"]
check("while public it translates", len(tc.post("/api/video/translate", json={"kind": "comments", "ids": [cid], "lang": "hi"}).json()["items"]), 1)
owner.patch(f"/api/video/studio/videos/{vid['id']}", json={"visibility": "private"})
check("private: nothing comes back", tc.post("/api/video/translate", json={"kind": "comments", "ids": [cid], "lang": "hi"}).json()["items"], [])
check("the owner still can", len(tc.post("/api/video/translate", json={"kind": "comments", "ids": [cid], "lang": "hi"},
                                         headers={"Authorization": owner.headers["Authorization"]}).json()["items"]), 1)
check("summary refuses a made-up language", tc.get(f"/api/video/videos/{pid}/comments/summary", params={"lang": "zz"}).status_code, 400)

print("\n== members-only live chat needs a member")
host = creator("Members Host")
premium(host, "creator_pro")
st = host.post("/api/video/studio/live", json={"title": "Members only", "members_rank": 1})
check("members-only stream made", st.status_code, 201)
spid = st.json()["id"]


def socket(first: dict | None):
    try:
        with tc.websocket_connect(f"/api/video/ws/live/{spid}") as ws:
            if first is not None:
                ws.send_text(json.dumps(first))
            return json.loads(ws.receive_text()).get("type")
    except WebSocketDisconnect as e:
        return e.code


check("a bad token is closed with 4403", socket({"type": "auth", "token": "junk"}), 4403)
check("a signed-in stranger is closed with 4403", socket({"type": "auth", "token": signup("Stranger").headers["Authorization"].split()[1]}), 4403)
check("the host gets in", socket({"type": "auth", "token": host.headers["Authorization"].split()[1]}), "hello")

finish()
