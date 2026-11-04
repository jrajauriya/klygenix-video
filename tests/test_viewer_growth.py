"""Run 5 viewer growth: Premium offline downloads, the notification inbox and digests, the Subscriptions feed, card labels."""

from __future__ import annotations

import time

import httpx

from harness import admin_login, check, client, creator, finish, ok, premium, settled, signup, sql, upload, wait_for

from app.video.services import inbox
from app.video.sessions import platform_session

admin = admin_login()

print("\n== Premium offline downloads")
host = creator("Growth Host")
fan = signup("Growth Fan")
fan.post(f"/api/video/channels/{host.get('/api/video/studio/channel').json()['channel']['handle']}/follow")
v = settled(host, upload(host, "reel-chai", "Downloadable chai")["id"])
check("free viewers are asked for Premium", fan.post(f"/api/video/videos/{v['public_id']}/download").status_code, 402)
premium(fan)
r = fan.post(f"/api/video/videos/{v['public_id']}/download")
check("Premium gets a download", r.status_code, 200)
d = r.json()
ok("a 30-day licence and a short-lived link", 29 * 86400 < d["license_expires_at"] - time.time() <= 30 * 86400
   and d["url_expires_at"] - time.time() <= 6 * 3600 + 5, d)
f = httpx.get(d["url"], timeout=60)
check("the link serves the MP4", (f.status_code, f.headers.get("content-type"), f.content[4:8]), (200, "video/mp4", b"ftyp"))
check("a tampered link is refused", httpx.get(d["url"].replace(".mp4", "").rstrip("0123456789abcdef") + "00.mp4").status_code in (403, 404), True)
chk = fan.post("/api/video/me/downloads/check", json={"licenses": [d["license"], "1.2.forged", "garbage"]}).json()
check("licence check", (chk["licenses"][d["license"]], chk["licenses"]["1.2.forged"], chk["licenses"]["garbage"]),
      ("ok", "invalid", "invalid"))
other = signup("Growth Other")
check("a licence is bound to its viewer", other.post("/api/video/me/downloads/check", json={"licenses": [d["license"]]}).json()
      ["licenses"][d["license"]], "invalid")
sql("UPDATE kv_commerce.entitlements SET ends_at = now() - interval '1 minute' WHERE user_id = :u AND kind = 'plan'", u=fan.user["id"])
check("when Premium ends the app is told to delete", fan.post("/api/video/me/downloads/check", json={"licenses": [d["license"]]}).json()
      ["licenses"][d["license"]], "premium_ended")
premium(fan)
host.delete(f"/api/video/studio/videos/{v['id']}")
check("a removed video is withdrawn", fan.post("/api/video/me/downloads/check", json={"licenses": [d["license"]]}).json()
      ["licenses"][d["license"]], "removed")

print("\n== notification inbox")
v2 = settled(host, upload(host, "reel-three-tips", "Inbox tips")["id"])
items = wait_for(lambda: [n for n in fan.get("/api/video/me/inbox").json()["items"] if n["kind"] == "new_video"
                          and n["url"] == f"/watch/{v2['public_id']}"], 60)
ok("followers get the new video in their inbox", bool(items), items)
check("with the channel and title", items[0]["title"].endswith("posted a new video") and items[0]["body"] == "Inbox tips", True)
ok("published notice for the uploader too", any(n["kind"] == "published" for n in host.get("/api/video/me/inbox").json()["items"]))
studio_items = host.get("/api/video/me/inbox", params={"app": "studio"}).json()["items"]
web_items = host.get("/api/video/me/inbox", params={"app": "web"}).json()["items"]
check("creator notices go to the studio bell", (any(n["kind"] == "published" for n in studio_items), any(n["kind"] == "published" for n in web_items)),
      (True, False))
ok("viewer notices go to the web bell", all(n["app"] in ("viewer", "all") for n in fan.get("/api/video/me/inbox", params={"app": "web"}).json()["items"]))
check("the app counts differ", host.get("/api/video/me/inbox/count", params={"app": "web"}).json()["unread"] <=
      host.get("/api/video/me/inbox/count").json()["unread"], True)
c = host.post(f"/api/video/videos/{v2['public_id']}/comments", json={"body": "Thanks for watching, ask me anything"}).json()
fan.post(f"/api/video/videos/{v2['public_id']}/comments", json={"body": "Lovely tips, thank you", "parent_id": c["id"]})
rep = wait_for(lambda: [n for n in host.get("/api/video/me/inbox").json()["items"] if n["kind"] == "reply"], 20)
ok("a reply notifies the comment's author", rep and "replied to your comment" in rep[0]["title"], rep)
check("replying to yourself does not", [n for n in fan.get("/api/video/me/inbox").json()["items"] if n["kind"] == "reply"], [])
n_before = fan.get("/api/video/me/inbox/count").json()["unread"]
ok("unread count", n_before >= 1, n_before)
r = fan.post("/api/video/me/inbox/read", json={"ids": [items[0]["id"]]}).json()
check("mark one read", (r["marked"], r["unread"]), (1, n_before - 1))
check("mark all read", fan.post("/api/video/me/inbox/read", json={}).json()["unread"], 0)
check("another viewer sees none of it", [n for n in other.get("/api/video/me/inbox").json()["items"] if n["url"] == f"/watch/{v2['public_id']}"], [])

print("\n== digests")
check("weekly by default", fan.get("/api/video/me/digest").json()["frequency"], "weekly")
check("a bad frequency is refused", fan.put("/api/video/me/digest", json={"frequency": "hourly"}).status_code, 400)
quiet = signup("Digest Off")
quiet.post(f"/api/video/channels/{host.get('/api/video/studio/channel').json()['channel']['handle']}/follow")
quiet.put("/api/video/me/digest", json={"frequency": "off"})
fan.put("/api/video/me/digest", json={"frequency": "daily"})
v3 = settled(host, upload(host, "reel-git-mistake", "Digest worthy")["id"])
wait_for(lambda: [n for n in fan.get("/api/video/me/inbox").json()["items"] if n["url"] == f"/watch/{v3['public_id']}"], 60)
sql("UPDATE kv_social.notifications SET created_at = now() - interval '2 hours' WHERE user_id IN (:a, :b) AND digest_sent_at IS NULL",
    a=fan.user["id"], b=quiet.user["id"])
with platform_session() as db:
    sent = inbox.digest(db, force="daily")
    db.commit()
ok("digests went out", sent >= 1, sent)
mails = admin.get(f"/api/video/admin/beta/outbox?to={fan.email}&template=digest").json()
ok("the fan's digest lists the new video", mails and "Digest worthy" in mails[0]["body_text"], mails[:1])
check("nobody gets the same items twice", sql("SELECT count(*) FROM kv_social.notifications WHERE user_id = :u AND read_at IS NULL "
                                              "AND digest_sent_at IS NULL", u=fan.user["id"])[0][0], 0)
check("digest off means no mail", admin.get(f"/api/video/admin/beta/outbox?to={quiet.email}&template=digest").json(), [])

print("\n== Subscriptions tab")
sub = signup("Subscriber")
check("no follows, nothing", sub.get("/api/video/feed/subscriptions").json()["items"], [])
sub.post(f"/api/video/channels/{host.get('/api/video/studio/channel').json()['channel']['handle']}/follow")
s1 = sub.get("/api/video/feed/subscriptions?mark_seen=false").json()
ids = [x["id"] for x in s1["items"]]
check("newest first", ids[:2], [v3["public_id"], v2["public_id"]])
check("recent uploads are new", (s1["items"][0]["new"], s1["new_count"] >= 2), (True, True))
sub.get("/api/video/feed/subscriptions")
s2 = sub.get("/api/video/feed/subscriptions").json()
check("after a visit nothing is new", (s2["new_count"], any(x["new"] for x in s2["items"])), (0, False))
check("cards carry the partnership field", "paid_partnership" in s2["items"][0], True)

print("\n== TV approval shows the device")
d = client().post("/api/auth/device/start", json={"client": "tv"},
                  headers={"User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 SamsungBrowser/5.0 TV Safari/537.36"}).json()
info = fan.get(f"/api/auth/device/{d['user_code']}").json()
check("named from the browser", (info["name"], bool(info["requested_at"])), ("Samsung TV", True))
named = client().post("/api/auth/device/start", json={"client": "tv", "name": "Living room TV"}).json()
check("or as the TV app names itself", fan.get(f"/api/auth/device/{named['user_code']}").json()["name"], "Living room TV")

finish()
