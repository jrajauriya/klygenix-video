import time

from harness import PAYOUT_ACCOUNT, check, creator, finish, ok, premium, settled, signup, sql, support_pay, upload, wait_for
from app.video.sessions import platform_session
from app.video.services.push import notify, notify_followers_live
from app.video.sweeps import membership_reminders


def history(c):
    return c.get("/api/video/me/notifications/history").json()


print("\n== Push notifications (sandbox provider)")
c = creator("Push Creator")
check("defaults are all on", c.get("/api/video/me/notifications").json(),
      {"render_ready": True, "published": True, "live": True, "membership": True})
c.post("/api/video/devices/push-token", json={"token": "ExponentPushToken[suite-creator]", "platform": "ios"})
v = settled(c, upload(c, "reel-chai", "Push reel")["id"])
pub = wait_for(lambda: [m for m in history(c) if m["kind"] == "published"], 30)
check("publishing a video notifies the uploader", (len(pub), pub[0]["status"], pub[0]["data"]["url"]),
      (1, "sent", f"/watch/{v['public_id']}"))
premium(c, "creator_pro")
cl = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "title": "Push clip", "start_ms": 0, "end_ms": 6000,
                                             "caption_style": "none"}).json()
c.post(f"/api/video/studio/clips/{cl['id']}/render")
ready = wait_for(lambda: [m for m in history(c) if m["kind"] == "render_ready"], 120)
check("a finished render notifies the creator", ready[0]["title"], "Your clip is ready")
wait_for(lambda: c.get(f"/api/video/studio/clips/{cl['id']}").json()["status"] == "rendered", 60)
check("turning a kind off", c.put("/api/video/me/notifications", json={"render_ready": False}).json()["render_ready"], False)
check("re-render accepted", c.post(f"/api/video/studio/clips/{cl['id']}/render").status_code, 200)
time.sleep(1)
ok("a turned-off kind is recorded as skipped, not sent",
   wait_for(lambda: any(m["kind"] == "render_ready" and m["status"] == "skipped" for m in history(c)), 120),
   [(m["kind"], m["status"], m["created_at"]) for m in history(c)] + [c.get(f"/api/video/studio/clips/{cl['id']}").json().get("status"),
                                                                       c.get("/api/video/me/notifications").json()])

print("\n== A followed channel goes live")
fan, lazy = signup("Push Fan"), signup("Push Lazy")
handle = sql("SELECT handle FROM kv_social.channels WHERE tenant_id = :t", t=c.user["tenant_id"])[0][0]
for f in (fan, lazy):
    f.post(f"/api/video/channels/{handle}/follow")
fan.post("/api/video/devices/push-token", json={"token": "ExponentPushToken[suite-fan]", "platform": "android"})
s = c.post("/api/video/studio/live", json={"title": "Push live"}).json()
sql("UPDATE kv_media.live_streams SET status = 'live', started_at = now() WHERE public_id = :p", p=s["id"])
notify_followers_live(sql("SELECT id FROM kv_media.live_streams WHERE public_id = :p", p=s["id"])[0][0])
got = [m for m in history(fan) if m["kind"] == "live"]
check("followers hear about it", (len(got), got[0]["status"] if got else None), (1, "sent"))
check("a follower with no device is recorded as skipped", [m["status"] for m in history(lazy) if m["kind"] == "live"], ["skipped"])
again = notify_followers_live(sql("SELECT id FROM kv_media.live_streams WHERE public_id = :p", p=s["id"])[0][0])
check("nobody is told twice", again, 0)
c.post(f"/api/video/studio/live/{s['id']}/end")

print("\n== Membership reminders")
c.put("/api/video/studio/earnings/account", json=PAYOUT_ACCOUNT)
c.post("/api/video/studio/earnings/account/submit")
tier = c.post("/api/video/studio/memberships/tiers", json={"name": "Push club", "rank": 1, "price_minor": 4900}).json()
support_pay(fan, {"purpose": "membership", "tier_id": tier["id"]})
sql("UPDATE kv_commerce.subscriptions SET current_period_end = now() + interval '2 days' WHERE user_id = :u AND audience = 'member'",
    u=fan.user["id"])
membership_reminders()
membership_reminders()
rem = [m for m in history(fan) if m["kind"] == "membership"]
check("one reminder before the period ends", len(rem), 1)
ok("it names the tier", "Push club" in rem[0]["title"], rem[0])

print("\n== Tokens")
check("forgetting a token", c.post("/api/video/devices/push-token/forget", json={"token": "ExponentPushToken[suite-creator]"}).json()["forgotten"], True)
with platform_session() as db:
    m = notify(db, c.user["id"], "published", "x", "y")
    status = m.status
    db.commit()
check("with no device left, sends are skipped", status, "skipped")
check("history is private", all(x["kind"] != "membership" for x in history(c)), True)

finish()
