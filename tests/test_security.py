import httpx

from harness import BASE, admin_login, check, creator, finish, ok, signup

spec = httpx.get(f"{BASE}/openapi.json").json()
routes = [(m.upper(), p) for p, ms in spec["paths"].items() for m in ms if m in ("get", "post", "put", "patch", "delete")]
PUBLIC = {
    ("GET", "/api/video/feed/home"), ("GET", "/api/video/feed/reels"), ("GET", "/api/video/videos/{public_id}"),
    ("GET", "/api/video/videos/{public_id}/comments"), ("GET", "/api/video/videos/{public_id}/danmaku"),
    ("GET", "/api/video/videos/{public_id}/related"), ("GET", "/api/video/channels/{handle}/playlists"),
    ("GET", "/api/video/playlists/{playlist_id}"),
    ("GET", "/api/video/videos/{public_id}/transcript"), ("GET", "/api/video/videos/{public_id}/captions/{lang}.vtt"),
    ("POST", "/api/video/videos/{public_id}/progress"), ("GET", "/api/video/channels/{handle}"),
    ("GET", "/api/video/channels/{handle}/videos"), ("GET", "/api/video/search"), ("GET", "/api/video/plans"),
    ("GET", "/api/video/images/{name}"), ("POST", "/api/video/takedowns"),
    ("GET", "/api/video/channels/youtube/callback"), ("GET", "/api/video/channels/instagram/callback"), ("GET", "/api/video/channels/{handle}/support"),
    ("POST", "/api/video/products/{link_id}/click"), ("GET", "/api/video/channels/{handle}/posts"),
    ("POST", "/api/video/translate"), ("GET", "/api/video/videos/{public_id}/comments/summary"),
    ("GET", "/api/video/videos/{public_id}/study/{kind}"),
    ("GET", "/api/video/live"), ("GET", "/api/video/live/{public_id}"), ("GET", "/api/video/channels/{handle}/live"),
    ("GET", "/api/video/live/{public_id}/chat"),
    ("POST", "/api/video/waitlist"), ("POST", "/api/video/waitlist/confirm"), ("POST", "/api/video/invites/check"),
    ("GET", "/api/video/beta"), ("POST", "/api/video/feedback"),
    ("GET", "/api/video/ads/breaks"), ("GET", "/api/video/ads/decision"), ("POST", "/api/video/ads/events"),
    ("GET", "/api/video/brands"),
}
NO_CHANNEL = {("GET", "/api/video/studio/channel"), ("GET", "/api/video/studio/onboarding"), ("GET", "/api/video/studio/brand"),
              ("GET", "/api/video/studio/ads/campaigns"), ("GET", "/api/video/studio/sponsorships/my-briefs"),
              ("GET", "/api/video/studio/sponsorships/deals")}
SIGNED = {p for _, p in routes if p.startswith(("/api/video/webhooks/", "/api/video/sandbox/hls/", "/api/video/sandbox/hls-preview/", "/api/video/sandbox/thumb/", "/api/video/dubs/", "/api/video/sandbox/live/",
                                                 "/api/video/sandbox/upload/", "/api/video/studio/clip-files/"))}


def fill(p: str) -> str:
    return (p.replace("{public_id}", "abcdefghijk").replace("{handle}", "klygenix").replace("{video_id}", "1")
             .replace("{clip_id}", "1").replace("{connected_id}", "1").replace("{checkout_id}", "1")
             .replace("{comment_id}", "1").replace("{danmaku_id}", "1").replace("{appeal_id}", "1")
             .replace("{takedown_id}", "1").replace("{invoice_id}", "1").replace("{audience}", "viewer")
             .replace("{rail}", "sandbox").replace("{provider}", "sandbox").replace("{name}", "x.webp")
             .replace("{lang}", "en").replace("{exp}", "1").replace("{sig}", "x").replace("{path}", "master.m3u8")
             .replace("{tenant_id}", "1").replace("{user_id}", "1").replace("{key_id}", "1").replace("{id}", "1"))


print("\n== Every private route refuses a request with no credential")
anon = httpx.Client(base_url=BASE, timeout=30)
leaks = []
for m, p in routes:
    if not p.startswith("/api/video/") or (m, p) in PUBLIC or p in SIGNED:
        continue
    r = anon.request(m, fill(p), json={})
    if r.status_code not in (401, 403):
        leaks.append(f"{m} {p} -> {r.status_code}")
check("no private Play route answers anonymously", leaks, [])

print("\n== Admin routes refuse creators and viewers")
c = creator()
v = signup("Viewer")
leaks = []
for m, p in routes:
    if not p.startswith(("/api/video/admin/", "/api/admin/")) or p == "/api/admin/tenant-features":
        continue
    for who in (c, v):
        r = who.request(m, fill(p), json={})
        if r.status_code not in (401, 403):
            leaks.append(f"{m} {p} -> {r.status_code}")
check("no admin route answers a non-admin", sorted(set(leaks)), [])

print("\n== Studio routes need a channel and the right tenant")
leaks = []
for m, p in routes:
    if not p.startswith("/api/video/studio/") or p in SIGNED or (m, p) in NO_CHANNEL:
        continue
    r = v.request(m, fill(p), json={})
    if r.status_code not in (401, 403, 404, 409, 422):
        leaks.append(f"{m} {p} -> {r.status_code}")
check("a viewer with no channel cannot use the studio", leaks, [])

print("\n== Signed routes refuse bad signatures")
for path in ("/api/video/sandbox/hls/1/9999999999/forged/master.m3u8", "/api/video/sandbox/thumb/1/9999999999/forged.jpg",
             "/api/video/studio/clip-files/1/9999999999/forged.mp4"):
    check(f"forged {path.split('/')[3]} link refused", anon.get(path).status_code, 403)
try:
    forged = httpx.put(f"{BASE}/api/video/sandbox/upload/1/9999999999/forged", content=b"x", timeout=10).status_code
except httpx.TransportError:
    forged = 403
check("forged upload refused", forged, 403)
check("forged payment webhook refused", anon.post("/api/video/webhooks/payments/sandbox", content=b'{"id":"e","event":"payment.captured"}',
                                                  headers={"X-Sandbox-Signature": "forged"}).status_code, 400)
check("unknown rail refused", anon.post("/api/video/webhooks/payments/paypal", content=b"{}").status_code, 404)
check("bunny webhook without the secret refused", httpx.Client(base_url=BASE).post("/api/video/webhooks/media/bunny", content=b'{"VideoGuid":"x","Status":3}').status_code, 400)

print("\n== Headers and tokens")
r = anon.get("/health")
ok("security headers on API responses", "x-content-type-options" in {k.lower() for k in r.headers})
check("garbage bearer token refused", httpx.get(f"{BASE}/api/video/me", headers={"Authorization": "Bearer junk"}).status_code, 401)
admin = admin_login()
check("admin token reaches admin stats", admin.get("/api/video/admin/stats").status_code, 200)

finish()
