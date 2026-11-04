"""Run 6 creator onboarding: bulk YouTube import with progress, handle rename with redirects, the onboarding mail drip."""

from __future__ import annotations

import httpx

from harness import BASE, PASSWORD, PAYOUT_ACCOUNT, check, creator, finish, ok, settled, sql, uid, upload, wait_for

from app.video.services import onboarding
from app.video.sessions import platform_session

c = creator("Onboarding Creator")
tid = c.user["tenant_id"]

print("\n== bulk YouTube import")
start = c.get("/api/video/studio/connected/youtube/start").json()
httpx.get(start["url"], follow_redirects=False, timeout=30)
conn = wait_for(lambda: next((x for x in c.get("/api/video/studio/connected").json() if x["platform"] == "youtube"), None), 30)
cid = conn["id"]
remote = c.get(f"/api/video/studio/connected/{cid}/youtube/videos").json()
check("the channel's videos are listed", len(remote["items"]), 3)
wait_for(lambda: all(x["imported"] for x in c.get(f"/api/video/studio/connected/{cid}/youtube/videos").json()["items"]), 60)
ok("connecting imported them already", True)
r = c.post(f"/api/video/studio/connected/{cid}/imports", json={"external_ids": ["kvSandbox01", "kvSandbox02", "kvMissing99"]})
check("an import job is queued", r.status_code, 202)
jid = r.json()["id"]
job = wait_for(lambda: (lambda j: j if j["status"] in ("done", "failed") else None)(c.get(f"/api/video/studio/imports/{jid}").json()), 120)
check("progress per video", (job["total"], job["done"], job["failed"]), (3, 2, 1))
check("a video that is not on the channel fails with a reason",
      next(i for i in job["items"] if i["external_id"] == "kvMissing99")["error"] is not None, True)
check("importing twice makes no duplicates", sql("SELECT count(*) FROM kv_media.videos WHERE tenant_id = :t AND embed_external_id = "
                                                 "'kvSandbox01' AND is_deleted = false", t=tid)[0][0], 1)
r = c.post(f"/api/video/studio/imports/{jid}/resume")
check("a job can be resumed", r.status_code, 202)
job = wait_for(lambda: (lambda j: j if j["status"] in ("done", "failed") else None)(c.get(f"/api/video/studio/imports/{jid}").json()), 60)
check("resuming retries only the failed video", (job["done"], job["failed"]), (2, 1))
check("the job is listed", c.get("/api/video/studio/imports").json()[0]["id"], jid)
other = creator("Import Snoop")
check("another channel cannot read it", other.get(f"/api/video/studio/imports/{jid}").status_code, 404)
check("nothing to import is refused", c.post(f"/api/video/studio/connected/{cid}/imports", json={"external_ids": []}).status_code, 422)

print("\n== handle rename with redirects")
old = c.get("/api/video/studio/channel").json()["channel"]["handle"]
new = f"renamed-{uid()}"
r = c.post("/api/video/studio/channel/handle", json={"handle": new})
check("renamed", (r.status_code, r.json().get("handle")), (200, new))
d = httpx.get(f"{BASE}/api/video/channels/{old}", timeout=30).json()
check("the old handle still finds the channel", (d["handle"], d["moved_from"]), (new, old))
check("its videos too", httpx.get(f"{BASE}/api/video/channels/{old}/videos", timeout=30).status_code, 200)
r = httpx.get(f"{BASE}/api/video/render", params={"path": f"/@{old}/videos"}, timeout=30, follow_redirects=False)
check("old share links redirect permanently", (r.status_code, r.headers.get("location")), (301, f"/@{new}/videos"))
check("a second rename within 30 days is refused", c.post("/api/video/studio/channel/handle", json={"handle": f"again-{uid()}"}).status_code, 429)
r = httpx.post(f"{BASE}/api/auth/signup", json={"name": "Handle Squatter", "email": f"suite-{uid()}@example.com", "password": PASSWORD,
                                                 "birth_date": "1990-01-01", "country": "IN", "language": "en", "handle": old}, timeout=30)
check("the old handle is reserved for 180 days", r.status_code, 409)
check("an invalid handle is refused", other.post("/api/video/studio/channel/handle", json={"handle": "no spaces!"}).status_code, 400)
check("a taken handle is refused", other.post("/api/video/studio/channel/handle", json={"handle": new}).status_code, 409)
check("the rename is audited", sql("SELECT count(*) FROM kv_admin.audit_log WHERE action = 'channel.handle_rename' AND tenant_id = :t",
                                   t=tid)[0][0], 1)

print("\n== onboarding mails")
fresh = creator("Drip Creator")


def mails(email, template):
    return sql("SELECT count(*) FROM kv_admin.mail_outbox WHERE to_email = :e AND template = :t", e=fresh.email.lower(), t=template)[0][0]


def drip():
    with platform_session() as db:
        onboarding.drip(db)
        db.commit()


drip()
check("day 0: upload your first video", mails(fresh.email, "onboarding_upload"), 1)
drip()
check("never twice", mails(fresh.email, "onboarding_upload"), 1)
settled(fresh, upload(fresh, "reel-three-tips", "Drip first video")["id"])
sql("UPDATE kv_social.channels SET created_at = now() - interval '3 days' WHERE tenant_id = :t", t=fresh.user["tenant_id"])
drip()
check("day 2: make a clip once there is a video", mails(fresh.email, "onboarding_clip"), 1)
check("tips can be turned off", fresh.put("/api/video/studio/onboarding-mails", json={"enabled": False}).json()["enabled"], False)
sql("UPDATE kv_social.channels SET created_at = now() - interval '8 days' WHERE tenant_id = :t", t=fresh.user["tenant_id"])
drip()
check("nothing after opting out", mails(fresh.email, "onboarding_payouts"), 0)
fresh.put("/api/video/studio/onboarding-mails", json={"enabled": True})
fresh.put("/api/video/studio/earnings/account", json={**PAYOUT_ACCOUNT, "email": "drip@example.com"})
drip()
check("a step already done is skipped, not mailed", mails(fresh.email, "onboarding_payouts"), 0)
state = fresh.get("/api/video/studio/onboarding-mails").json()
ok("the studio sees what was sent", {"upload", "clip"} <= set(state["sent"]), state)

finish()
