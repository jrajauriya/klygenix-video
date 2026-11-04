"""Trust & safety gaps (live reports, counter-notices, clocks, compliance report) and the closed beta."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from fakehttp import configured
from harness import PASSWORD, admin_login, check, client, creator, finish, ok, settled, signup, sql, uid, upload, wait_for

from app.main import app
from app.video.live import service as live
from app.video.models.media import LiveStream
from app.video.models.social import Channel
from app.video.sessions import platform_session
from app.video.trust import service as trust

admin = admin_login()
tc = TestClient(app, client=("127.0.0.1", 50000))


def outbox(to: str, template: str | None = None) -> list[dict]:
    q = f"/api/video/admin/beta/outbox?to={to}" + (f"&template={template}" if template else "")
    return admin.get(q).json()


print("\n== report live chat and streams")
host = creator("Live Report Host")
ch = host.get("/api/video/studio/channel").json()["channel"]
with platform_session() as db:
    s = live.create(db, channel=db.get(Channel, ch["id"]), title="Reported live")
    s.status, s.started_at, s.provider, s.provider_ref, s.ingest_port = "live", live.now(), "cloudflare", f"fake-{uid()}", None
    db.commit()
    pid, sid = s.public_id, s.id
talker = signup("Live Talker")
m = talker.post(f"/api/video/live/{pid}/chat", json={"body": "this is a perfectly fine message"})
check("chat posted", m.status_code, 201)
mid = m.json()["id"]
reporters = [signup(f"Reporter {i}") for i in range(3)]
r = reporters[0].post("/api/video/reports", json={"target_type": "live_message", "target_id": str(mid), "reason": "harassment"})
check("a live chat message can be reported", r.status_code, 201)
check("twice is refused", reporters[0].post("/api/video/reports", json={"target_type": "live_message", "target_id": str(mid),
                                                                         "reason": "spam"}).status_code, 409)
for rep in reporters[1:]:
    rep.post("/api/video/reports", json={"target_type": "live_message", "target_id": str(mid), "reason": "harassment"})
check("three reports hide an unpaid message", sql("SELECT status FROM kv_social.live_messages WHERE id = :i", i=mid)[0][0], "hidden")
check("unknown message is 404", reporters[0].post("/api/video/reports", json={"target_type": "live_message", "target_id": "999999999",
                                                                               "reason": "spam"}).status_code, 404)
r = reporters[0].post("/api/video/reports", json={"target_type": "live", "target_id": pid, "reason": "violence"})
check("a live stream can be reported", r.status_code, 201)
q = admin.get("/api/video/admin/queue?limit=200").json()
item = next((x for x in q if x["target_type"] == "live" and x["target_id"] == sid), None)
ok("the stream is in the moderation queue with its title", item and item["target"]["title"] == "Reported live", item)
msg_item = next((x for x in q if x["target_type"] == "live_message" and x["target_id"] == mid), None)
ok("the message is in the queue with its text", msg_item and msg_item["target"]["text"] == "this is a perfectly fine message", msg_item)
r = admin.post("/api/video/admin/actions", json={"target_type": "live_message", "target_id": mid, "action": "restore",
                                                 "reason": "Not abusive"})
check("admin can restore a hidden message", (r.status_code, sql("SELECT status FROM kv_social.live_messages WHERE id = :i", i=mid)[0][0]),
      (201, "visible"))
r = admin.post("/api/video/admin/actions", json={"target_type": "live", "target_id": sid, "action": "remove",
                                                 "reason": "Graphic violence on stream", "strike": True})
check("admin removal ends the stream", sql("SELECT status, error FROM kv_media.live_streams WHERE id = :i", i=sid)[0],
      ("ended", "Stopped by the platform: Graphic violence on stream"))
check("and strikes the channel", sql("SELECT strike_count FROM kv_social.channels WHERE id = :i", i=ch["id"])[0][0], 1)
check("open stream reports are closed", sql("SELECT count(*) FROM kv_trust.reports WHERE target_type='live' AND target_id=:i "
                                            "AND status='open'", i=sid)[0][0], 0)

print("\n== takedown clocks from settings, notice mails")
up = creator("Countered Creator")
v = settled(up, upload(up, "reel-chai", "Countered chai")["id"])
claim_email = f"rights-{uid()}@example.com"
t = client().post("/api/video/takedowns", json={"kind": "copyright", "complainant_name": "Rights Holder", "complainant_email": claim_email,
                                                "target_url": f"https://play.klygenix.com/watch/{v['public_id']}",
                                                "details": "This is my original recording uploaded without licence.", "sworn": True})
check("notice accepted", t.status_code, 201)
got = datetime.fromisoformat(t.json()["resolve_due_at"]) - datetime.fromisoformat(t.json()["ack_due_at"])
check("copyright resolves 14 days after the acknowledge clock (360 h − 24 h)", got, timedelta(hours=336))
check("the complainant gets an acknowledgement mail", [m["template"] for m in outbox(claim_email)], ["takedown_received"])
with configured(TAKEDOWN_SLA_HOURS="copyright:2/48,other:24/360"):
    check("clocks come from settings", trust.sla_table()["copyright"], (timedelta(hours=2), timedelta(hours=48)))
    check("unknown kinds fall back to other", trust.sla_table().get("intimate"), None)
ref = t.json()["reference"]
td = next(x for x in admin.get("/api/video/admin/takedowns").json() if x["reference"] == ref)
admin.post(f"/api/video/admin/takedowns/{td['id']}", json={"status": "actioned", "note": "Matches the claim"})
check("video removed", sql("SELECT status FROM kv_media.videos WHERE public_id = :p", p=v["public_id"])[0][0], "blocked")
mine = up.get("/api/video/me/takedowns").json()
check("the uploader sees the notice and may counter", [(x["reference"], x["can_counter"]) for x in mine], [(ref, True)])
check("the uploader was told by mail", [m["template"] for m in outbox(up.email)][:1], ["takedown_removed"])
check("another tenant cannot see it", creator("Other").get("/api/video/me/takedowns").json(), [])

print("\n== counter-notice")
cn = {"full_name": "Asha Kulkarni", "address": "12 MG Road, Pune 411001, India", "phone": "+91 98200 00000",
      "email": "asha@example.com", "statement": "I recorded this video myself in my kitchen; the claimant has misidentified it.",
      "good_faith": True, "consent_jurisdiction": True, "signature": "Asha Kulkarni"}
check("both statements are required", up.post(f"/api/video/me/takedowns/{ref}/counter-notice", json={**cn, "good_faith": False}).status_code, 400)
check("the signature must be the name", up.post(f"/api/video/me/takedowns/{ref}/counter-notice", json={**cn, "signature": "A K"}).status_code, 400)
check("only the uploader", creator("Stranger").post(f"/api/video/me/takedowns/{ref}/counter-notice", json=cn).status_code, 404)
r = up.post(f"/api/video/me/takedowns/{ref}/counter-notice", json=cn)
check("filed", (r.status_code, r.json()["status"], r.json()["can_counter"]), (200, "countered", False))
due = datetime.fromisoformat(r.json()["restore_due_at"])
ok("restore is 10 business days out (14 calendar days or more)", timedelta(days=13) < due - datetime.now(timezone.utc) <= timedelta(days=15), due)
check("twice is refused", up.post(f"/api/video/me/takedowns/{ref}/counter-notice", json=cn).status_code, 409)
mails = outbox(claim_email, "counter_notice_claimant")
ok("the claimant gets the counter-notice with the uploader's address", mails and "12 MG Road" in mails[0]["body_text"], mails)
sql("UPDATE kv_trust.takedowns SET restore_due_at = now() - interval '1 minute' WHERE reference = :r", r=ref)
with platform_session() as db:
    check("the sweep restores it", trust.restore_countered(db), 1)
    db.commit()
check("video back", wait_for(lambda: (lambda st: st if st == "published" else None)(
    sql("SELECT status FROM kv_media.videos WHERE public_id = :p", p=v["public_id"])[0][0]), 60, 1), "published")
check("notice restored", sql("SELECT status FROM kv_trust.takedowns WHERE reference = :r", r=ref)[0][0], "restored")
check("both sides told", (len(outbox(claim_email, "takedown_restored")), len(outbox(up.email, "takedown_restored"))), (1, 1))

print("\n== claimant files a court action: upheld")
v2 = settled(up, upload(up, "reel-git-mistake", "Upheld clip")["id"])
t2 = client().post("/api/video/takedowns", json={"kind": "copyright", "complainant_name": "Studio Ltd", "complainant_email": claim_email,
                                                 "target_url": f"https://play.klygenix.com/watch/{v2['public_id']}",
                                                 "details": "Our studio owns this clip and has not licensed it.", "sworn": True}).json()
td2 = next(x for x in admin.get("/api/video/admin/takedowns").json() if x["reference"] == t2["reference"])
check("upheld only after a counter-notice", admin.post(f"/api/video/admin/takedowns/{td2['id']}", json={"status": "upheld"}).status_code, 409)
admin.post(f"/api/video/admin/takedowns/{td2['id']}", json={"status": "actioned"})
up.post(f"/api/video/me/takedowns/{t2['reference']}/counter-notice", json=cn)
r = admin.post(f"/api/video/admin/takedowns/{td2['id']}", json={"status": "upheld", "note": "Suit filed in Bombay HC"})
check("upheld", (r.json()["status"], r.json()["legal_action_at"] is not None), ("upheld", True))
sql("UPDATE kv_trust.takedowns SET restore_due_at = now() - interval '1 minute' WHERE reference = :r", r=t2["reference"])
with platform_session() as db:
    trust.restore_countered(db)
    db.commit()
check("an upheld notice is not restored", sql("SELECT status FROM kv_media.videos WHERE public_id = :p", p=v2["public_id"])[0][0], "blocked")

print("\n== overdue metric and the compliance report")
sql("UPDATE kv_trust.takedowns SET ack_due_at = now() - interval '1 hour' WHERE reference = :r", r=t2["reference"])
sql("UPDATE kv_trust.takedowns SET acknowledged_at = NULL WHERE reference = :r", r=t2["reference"])
from app.core.services import metrics  # noqa: E402

metrics._db_cache = (0, [])
text_out = "\n".join(metrics._db_lines())
ok("kv_trust_overdue reports the late acknowledgement", 'kv_trust_overdue{kind="copyright",stage="ack"}' in text_out
   or 'kv_trust_overdue{stage="ack",kind="copyright"}' in text_out, [ln for ln in text_out.splitlines() if "overdue" in ln])
month = datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime("%Y-%m")
rep = admin.get(f"/api/video/admin/compliance/report?month={month}").json()
ok("notices counted by kind", any(n["kind"] == "copyright" and n["received"] >= 2 for n in rep["notices"]), rep["notices"])
ok("actions split automated / moderators", any(a["target_type"] == "live" and a["action"] == "remove" and a["by_moderators"] >= 1
                                                for a in rep["actions"]), rep["actions"])
csv = admin.get(f"/api/video/admin/compliance/report?month={month}&format=csv")
check("CSV download", (csv.status_code, csv.headers["content-type"].split(";")[0], csv.text.splitlines()[0]),
      (200, "text/csv", "section,key,metric,value"))
check("a viewer cannot read it", signup("Nosy").get(f"/api/video/admin/compliance/report?month={month}").status_code, 403)

print("\n== waitlist")
wl = f"wait-{uid()}@example.com"
r = client().post("/api/video/waitlist", json={"email": wl, "name": "Meera", "role": "creator", "language": "hi",
                                               "channel_url": "https://youtube.com/@meera"})
check("joined (202, no hint whether the address is known)", r.status_code, 202)
mail = outbox(wl, "waitlist_confirm")
ok("confirmation mailed in Hindi", mail and mail[0]["language"] == "hi" and "/waitlist/confirm?token=" in mail[0]["body_text"], mail)
token = mail[0]["body_text"].split("token=")[1].split()[0]
check("bad token", client().post("/api/video/waitlist/confirm", json={"token": "x" * 30}).status_code, 404)
check("confirmed", client().post("/api/video/waitlist/confirm", json={"token": token}).json()["status"], "confirmed")
check("the link works once", client().post("/api/video/waitlist/confirm", json={"token": token}).status_code, 404)
client().post("/api/video/waitlist", json={"email": wl, "name": "Meera again"})
check("joining again keeps the confirmed place", sql("SELECT status FROM kv_admin.waitlist WHERE email = :e", e=wl)[0][0], "confirmed")
lst = admin.get(f"/api/video/admin/beta/waitlist?q={wl}").json()
check("admin sees it", [x["status"] for x in lst["items"]], ["confirmed"])
r = admin.post("/api/video/admin/beta/waitlist/invite", json={"ids": [lst["items"][0]["id"]]})
check("invited", r.json()["invited"], 1)
inv = outbox(wl, "invite")[0]
code = inv["body_text"].split("invite code: ")[1].split()[0] if "invite code: " in inv["body_text"] else inv["body_text"].split(": ")[1].split()[0]
check("a creator code", client().post("/api/video/invites/check", json={"code": code}).json(), {"valid": True, "role": "creator"})
check("a made-up code", client().post("/api/video/invites/check", json={"code": "AAAA-BBBB-CCCC"}).json()["valid"], False)
check("viewers cannot reach the beta admin", signup("Nosy 2").get("/api/video/admin/beta/codes").status_code, 403)

print("\n== sign-up modes (in-process)")


def try_signup(email: str, **extra):
    return tc.post("/api/auth/signup", json={"name": "Beta Person", "email": email, "password": PASSWORD, "birth_date": "1990-01-01",
                                             "country": "IN", "language": "en", **extra})


with configured(SIGNUP_MODE="closed"):
    check("closed refuses everyone", try_signup(f"c-{uid()}@example.com").status_code, 403)
    check("and says so", tc.get("/api/auth/signup/open").json()["open"], False)
with configured(SIGNUP_MODE="invite", CREATOR_SIGNUP="invite"):
    check("invite mode without a code", try_signup(f"n-{uid()}@example.com").status_code, 403)
    check("a code for another address is refused", try_signup(f"x-{uid()}@example.com", invite=code).status_code, 403)
    vc = admin.post("/api/video/admin/beta/codes", json={"role": "viewer", "max_uses": 2}).json()
    check("viewer code made", (vc["role"], vc["max_uses"], len(vc["code"])), ("viewer", 2, 14))
    check("a viewer code cannot open a channel", try_signup(f"v-{uid()}@example.com", invite=vc["code"],
                                                             handle=f"vh-{uid()}").status_code, 403)
    check("viewer code works", try_signup(f"v1-{uid()}@example.com", invite=vc["code"]).status_code, 201)
    check("second use works", try_signup(f"v2-{uid()}@example.com", invite=vc["code"]).status_code, 201)
    check("third use is refused", try_signup(f"v3-{uid()}@example.com", invite=vc["code"]).status_code, 403)
    r = try_signup(wl, invite=code, handle=f"meera-{uid()}")
    check("the waitlisted creator signs up and opens a channel", r.status_code, 201)
    check("waitlist marked joined", sql("SELECT status FROM kv_admin.waitlist WHERE email = :e", e=wl)[0][0], "joined")
    rc = admin.post("/api/video/admin/beta/codes", json={"role": "creator"}).json()
    admin.post(f"/api/video/admin/beta/codes/{rc['id']}/revoke")
    check("a revoked code is refused", try_signup(f"r-{uid()}@example.com", invite=rc["code"]).status_code, 403)
    vtok = try_signup(f"late-{uid()}@example.com", invite=admin.post("/api/video/admin/beta/codes", json={"role": "viewer"}).json()["code"])
    hdr = {"Authorization": f"Bearer {vtok.json()['access_token']}"}
    check("a viewer opening a channel later needs a creator code",
          tc.post("/api/video/studio/channel", json={"name": "Late", "handle": f"late-{uid()}"}, headers=hdr).status_code, 403)
    cc = admin.post("/api/video/admin/beta/codes", json={"role": "creator"}).json()["code"]
    check("with one it opens", tc.post("/api/video/studio/channel", json={"name": "Late", "handle": f"late-{uid()}", "invite": cc},
                                       headers=hdr).status_code, 201)
with configured(SIGNUP_MODE="open", CREATOR_SIGNUP="closed"):
    check("creators closed, viewers open", (try_signup(f"o-{uid()}@example.com").status_code,
                                            try_signup(f"o2-{uid()}@example.com", handle=f"oh-{uid()}").status_code), (201, 403))

print("\n== feedback")
png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()
r = client().post("/api/video/feedback", json={"kind": "bug", "body": "The player froze on reels", "page": "/reels", "app": "web",
                                               "email": f"fb-{uid()}@example.com", "screenshot": f"data:image/png;base64,{png}"})
check("anonymous bug with a screenshot", r.status_code, 201)
fid = r.json()["id"]
check("not an image", client().post("/api/video/feedback", json={"kind": "bug", "body": "x" * 10,
                                                                  "screenshot": "data:image/png;base64," + base64.b64encode(b"hello").decode()}
                                    ).status_code, 400)
signed = signup("Feedback Giver")
r = signed.post("/api/video/feedback", json={"kind": "idea", "body": "Add a sleep timer", "app": "tv", "app_version": "1.0.0"})
check("signed-in idea from the TV", r.status_code, 201)
fb = admin.get("/api/video/admin/feedback?limit=200").json()
mine = next(f for f in fb if f["id"] == fid)
check("admin sees it with the screenshot flag", (mine["kind"], mine["has_screenshot"], mine["page"]), ("bug", True, "/reels"))
shot = admin.get(f"/api/video/admin/feedback/{fid}/screenshot")
check("screenshot served to admin only", (shot.status_code, shot.content[:4]), (200, b"\x89PNG"))
check("triaged", admin.patch(f"/api/video/admin/feedback/{fid}", json={"status": "triaged", "admin_note": "Repro on Android"}).json()["status"],
      "triaged")

print("\n== creator onboarding")
fresh = signup("Fresh Viewer")
o = fresh.get("/api/video/studio/onboarding").json()
check("a viewer starts at channel", [s["key"] for s in o["steps"] if not s["done"]][:1], ["channel"])
o = up.get("/api/video/studio/onboarding").json()
done = {s["key"]: s["done"] for s in o["steps"]}
check("a creator with a published video", (done["channel"], done["upload"], done["publish"]), (True, True, True))
ok("progress counts required steps only", o["total"] == 4 and o["done"] >= 3, o)

finish()
