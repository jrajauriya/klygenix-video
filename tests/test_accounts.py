import httpx

from harness import BASE, PASSWORD, admin_login, check, creator, finish, ok, signup, sql, uid


def try_signup(country, birth, handle=None):
    return httpx.post(f"{BASE}/api/auth/signup", json={"name": "Age Test", "email": f"age-{uid()}@example.com",
                                                       "password": PASSWORD, "birth_date": birth, "country": country,
                                                       "handle": handle}, timeout=30)


print("\n== Age gate (rule V13)")
check("India 17 refused", try_signup("IN", "2009-12-31").status_code, 403)
check("India 18 accepted", try_signup("IN", "2008-01-01").status_code, 201)
check("US 12 refused", try_signup("US", "2014-06-01").status_code, 403)
check("US 13 accepted", try_signup("US", "2012-06-01").status_code, 201)
check("Germany 15 refused", try_signup("DE", "2011-01-01").status_code, 403)
r = try_signup("IN", "2012-01-01")
ok("refusal says watching needs no account", "watch" in r.json().get("detail", ""), r.text)

print("\n== Channels and handles")
check("reserved handle refused", try_signup("IN", "1990-01-01", handle="admin").status_code, 400)
h = f"suite-{uid()}"
check("first handle accepted", try_signup("IN", "1990-01-01", handle=h).status_code, 201)
check("taken handle refused", try_signup("IN", "1990-01-01", handle=h).status_code, 409)
viewer = signup("Viewer Only")
check("studio refuses a tenant with no channel", viewer.get("/api/video/studio/videos").status_code, 409)
check("channel endpoint answers null", viewer.get("/api/video/studio/channel").json()["channel"], None)
r = viewer.post("/api/video/studio/channel", json={"name": "Late Channel", "handle": f"late-{uid()}"})
check("channel opened from the studio", r.status_code, 201)
check("second channel refused", viewer.post("/api/video/studio/channel", json={"name": "Again"}).status_code, 409)
check("studio list now answers", viewer.get("/api/video/studio/videos").status_code, 200)

print("\n== Two gates: feature switch and role")
c = creator()
tid = c.user["tenant_id"]
admin = admin_login()
r = admin.put(f"/api/admin/tenants/{tid}/features", json={"features": {"video.clips": False}})
ok("admin switched clips off", r.status_code in (200, 204), r.text[:200])
check("clips refused when the feature is off", c.get("/api/video/studio/clips").status_code, 403)
check("uploads still allowed", c.get("/api/video/studio/videos").status_code, 200)

print("\n== Profile")
me = c.get("/api/video/me").json()
check("profile country", me["profile"]["country"], "IN")
check("free viewer plan by default", me["plans"]["viewer"]["key"], "viewer_free")
check("free creator plan by default", me["plans"]["creator"]["key"], "creator_free")
r = c.patch("/api/video/me", json={"language": "hi", "display_name": "Suite Hindi"})
check("language saved", r.json()["profile"]["language"], "hi")
row = sql("select birth_date from kv_social.profiles where user_id=:u", u=c.user["id"])
ok("birth date stored for the age gate", row and row[0][0] is not None)

finish()
