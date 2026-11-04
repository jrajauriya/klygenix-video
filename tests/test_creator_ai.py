"""Run 5 creator AI v2: AI thumbnails, five more Indian languages, chapter editing, the repurpose pack, the content calendar."""

from __future__ import annotations

import io
import time
from datetime import datetime, timedelta, timezone

import httpx
from PIL import Image

from harness import check, client, creator, finish, ok, settled, sql, upload, wait_for

c = creator("Creator AI v2")
v = settled(c, upload(c, "azure-apim-auth", "Azure API Management auth explained")["id"])
pid = v["public_id"]

print("\n== AI thumbnails (sandbox designs, quota-metered, labelled)")
r = c.post(f"/api/video/studio/videos/{v['id']}/thumbnails/ai")
check("three designs", (r.status_code, len(r.json()["ideas"])), (200, 3))
ideas = r.json()["ideas"]
img = Image.open(io.BytesIO(httpx.get(ideas[0]["url"], timeout=30).content))
check("a 1280×720 image", (img.format in ("JPEG", "WEBP"), img.size), (True, (1280, 720)))
check("quota counts them", r.json()["usage"]["used"], 3)
detail = c.get(f"/api/video/studio/videos/{v['id']}").json()
check("the studio lists them as AI ideas", sum(1 for i in detail["thumbnail_ideas"] if i["ai"]), 3)
c.post(f"/api/video/studio/videos/{v['id']}/thumbnail/pick", json={"key": ideas[1]["key"]})
check("picking one marks the thumbnail as AI-made (V12)", (c.get(f"/api/video/studio/videos/{v['id']}").json()["thumbnail_ai"],
                                                           client().get(f"/api/video/videos/{pid}").json()["ai_thumbnail"]), (True, True))
c.delete(f"/api/video/studio/videos/{v['id']}/thumbnail")
check("resetting clears the label", client().get(f"/api/video/videos/{pid}").json()["ai_thumbnail"], False)
r2 = c.post(f"/api/video/studio/videos/{v['id']}/thumbnails/ai")
check("a second batch replaces the first", sum(1 for i in c.get(f"/api/video/studio/videos/{v['id']}").json()["thumbnail_ideas"]
                                               if i["ai"]), 3)
c.post(f"/api/video/studio/videos/{v['id']}/thumbnails/ai")
r4 = c.post(f"/api/video/studio/videos/{v['id']}/thumbnails/ai")
check("the free plan's 10 a month stops the fourth batch", r4.status_code, 402)
check("a stranger cannot make them", creator("Thumb thief").post(f"/api/video/studio/videos/{v['id']}/thumbnails/ai").status_code, 404)

print("\n== five more Indian languages")
caps = client().get(f"/api/video/videos/{pid}").json()["captions"]
ok("Gujarati, Kannada, Malayalam, Punjabi and Odia are offered", {"gu", "kn", "ml", "pa", "or"} <= set(caps["translatable"]), caps)
vtt = client().get(f"/api/video/videos/{pid}/captions/kn.vtt")
check("Kannada subtitles", (vtt.status_code, vtt.text.startswith("WEBVTT")), (200, True))
check("profiles accept the new languages", c.patch("/api/video/me/profile", json={"language": "pa"}).status_code in (200, 404), True)

print("\n== chapter editing")
ch = c.get(f"/api/video/studio/videos/{v['id']}/chapters").json()
ok("AI chapters to start from", ch["version"] >= 1 and ch["chapters"], ch)
check("must start at 0:00", c.put(f"/api/video/studio/videos/{v['id']}/chapters",
                                  json={"chapters": [{"start_ms": 2000, "title": "Late"}]}).status_code, 400)
check("not 2 s apart", c.put(f"/api/video/studio/videos/{v['id']}/chapters",
                             json={"chapters": [{"start_ms": 0, "title": "A"}, {"start_ms": 2000, "title": "B"}]}).status_code, 400)
new = [{"start_ms": 0, "title": "Why APIM auth matters"}, {"start_ms": 20000, "title": "Subscription keys"},
       {"start_ms": 45000, "title": "OAuth and JWT validation"}]
r = c.put(f"/api/video/studio/videos/{v['id']}/chapters", json={"chapters": list(reversed(new))})
check("saved in order as a new version", ([x["title"] for x in r.json()["chapters"]], r.json()["version"]),
      ([x["title"] for x in new], ch["version"] + 1))
check("history keeps who changed it", r.json()["history"][0]["by"], "creator")
check("viewers see the edited chapters", [x["title"] for x in client().get(f"/api/video/videos/{pid}").json()["insight"]["chapters"]],
      [x["title"] for x in new])
hist = c.get(f"/api/video/studio/videos/{v['id']}/chapters").json()["history"]
check("history keeps the old chapters", [x["title"] for x in hist[1]["chapters"]], [x["title"] for x in ch["chapters"]])
r = c.post(f"/api/video/studio/videos/{v['id']}/chapters/restore", json={"version": ch["version"]})
check("an old version can be restored as a new one", ([x["title"] for x in r.json()["chapters"]], r.json()["version"]),
      ([x["title"] for x in ch["chapters"]], ch["version"] + 2))
check("restoring a version that never existed", c.post(f"/api/video/studio/videos/{v['id']}/chapters/restore",
                                                         json={"version": 999}).status_code, 404)

print("\n== repurpose pack")
r = c.post(f"/api/video/studio/videos/{v['id']}/repurpose", json={"language": "en"})
check("made", r.status_code, 201)
p = r.json()
ok("blog post, social posts and a newsletter", all(p.get(k) for k in ("blog_post", "x_post", "linkedin_post", "instagram_caption",
                                                                     "newsletter")), list(p))
ok("every claim points at a timestamp", p["citations"] and all(":" in x["label"] for x in p["citations"]), p["citations"][:2])
check("an X post fits", len(p["x_post"]) <= 280, True)
check("latest pack", c.get(f"/api/video/studio/videos/{v['id']}/repurpose").json()["pack"]["id"], p["id"])
p2 = c.post(f"/api/video/studio/videos/{v['id']}/repurpose", json={"language": "hi"}).json()
packs = c.get(f"/api/video/studio/videos/{v['id']}/repurpose/packs").json()
check("every pack is listed, newest first", [x["id"] for x in packs][:2], [p2["id"], p["id"]])
check("an older pack can be opened", c.get(f"/api/video/studio/repurpose/{p['id']}").json()["blog_post"], p["blog_post"])
md = c.get(f"/api/video/studio/repurpose/{p['id']}.md")
check("Markdown export", (md.status_code, "## LinkedIn" in md.text, md.text.startswith("# ")), (200, True, True))
check("another tenant cannot read it", creator("Pack thief").get(f"/api/video/studio/repurpose/{p['id']}.md").status_code, 404)

print("\n== content calendar")
cl = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "title": "Calendar clip", "start_ms": 0, "end_ms": 8000,
                                             "caption_style": "none"}).json()
c.post(f"/api/video/studio/clips/{cl['id']}/render")
wait_for(lambda: c.get(f"/api/video/studio/clips/{cl['id']}").json()["status"] in ("rendered", "failed"), 120)
start = c.get("/api/video/studio/connected/youtube/start").json()
httpx.get(start["url"], follow_redirects=False, timeout=30)
when = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
check("in the past is refused", c.post(f"/api/video/studio/clips/{cl['id']}/targets", json={
    "platform": "youtube", "scheduled_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}).status_code, 400)
r = c.post(f"/api/video/studio/clips/{cl['id']}/targets", json={"platform": "youtube", "caption": "Later #shorts",
                                                                  "scheduled_at": when.isoformat()})
check("scheduled, not published yet", (r.status_code, r.json()["status"]), (202, "scheduled"))
tid = r.json()["id"]
cal = c.get("/api/video/studio/calendar").json()
item = next((x for x in cal["items"] if x["type"] == "clip" and x["id"] == tid), None)
ok("on the calendar with its time", item and item["status"] == "scheduled" and item["target"] == "youtube", item)
ok("published videos are on it too", any(x["type"] == "video" and x["public_id"] == pid for x in cal["items"]))
later = (when + timedelta(days=1)).isoformat()
check("rescheduled", c.patch(f"/api/video/studio/calendar/targets/{tid}", json={"scheduled_at": later}).json()["status"], "scheduled")
sql("UPDATE kv_studio.publish_targets SET scheduled_at = now() - interval '1 minute' WHERE id = :i", i=tid)
from app.video.sweeps import scheduled_targets  # noqa: E402

scheduled_targets()
done = wait_for(lambda: (lambda t: t if t["status"] in ("published", "failed") else None)(
    next(x for x in c.get(f"/api/video/studio/clips/{cl['id']}/targets").json() if x["id"] == tid)), 60)
check("published when due (sandbox YouTube)", done["status"] if done else None, "published")
cl2 = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "title": "Cancel me", "start_ms": 8000, "end_ms": 14000,
                                              "caption_style": "none"}).json()
c.post(f"/api/video/studio/clips/{cl2['id']}/render")
wait_for(lambda: c.get(f"/api/video/studio/clips/{cl2['id']}").json()["status"] in ("rendered", "failed"), 120)
t2 = c.post(f"/api/video/studio/clips/{cl2['id']}/targets", json={"platform": "youtube", "scheduled_at": later}).json()
check("a scheduled post can be cancelled", c.patch(f"/api/video/studio/calendar/targets/{t2['id']}", json={"cancel": True}).json()["status"],
      "cancelled")
time.sleep(0.1)

finish()
