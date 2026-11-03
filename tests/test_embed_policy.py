import os
import re

from harness import check, creator, finish, ok, signup, sql, wait_for

ROOT = os.path.join(os.path.dirname(__file__), "..", "backend", "app", "video", "channels")
print("\n== No adapter can download someone else's media (rule V02)")
src = "".join(open(os.path.join(ROOT, f)).read() for f in os.listdir(ROOT) if f.endswith(".py"))
for pattern in (r"yt[-_]dlp", r"youtube[-_]dl", r"pytube", r"googlevideo", r"/videos/download", r"fetch_source", r"ffmpeg"):
    ok(f"channels code never uses {pattern}", not re.search(pattern, src, re.I))

print("\n== Embeds: AI only from owned captions; nothing over the player (rule V04)")
c = creator()
r = c.post("/api/video/studio/embeds", json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Pasted", "rights_declared": False})
check("rights declaration required", r.status_code, 400)
check("unsupported host refused", c.post("/api/video/studio/embeds", json={"url": "https://vimeo.com/1", "title": "x", "rights_declared": True}).status_code, 400)
r = c.post("/api/video/studio/embeds", json={"url": "https://www.bilibili.com/video/BV1xx411c7mD", "title": "Bili", "rights_declared": True})
check("bilibili embed added", r.status_code, 201)
e = r.json()
check("published without AI", (e["status"], e["ai_status"]), ("published", "no_captions"))
check("no transcript was made for it", sql("select count(*) from kv_ai.transcripts where video_id=:v", v=e["id"])[0][0], 0)
check("no AI job ran for it", sql("select count(*) from kv_ai.ai_jobs where video_id=:v and status='done'", v=e["id"])[0][0], 0)
viewer = signup("Embed Viewer")
d = viewer.get(f"/api/video/videos/{e['public_id']}").json()
check("player is the platform's own", d["playback"]["type"], "bilibili")
check("overlay never allowed on an embed", d["playback"]["overlay_allowed"], False)
ok("source credited and linked", d["playback"]["credit"] == "Bilibili" and d["playback"]["source_url"].startswith("https://www.bilibili.com/"))
check("Ask refused without captions", viewer.post(f"/api/video/videos/{e['public_id']}/ask", json={"question": "what is this"}).status_code, 409)
vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nWelcome to my Bilibili lesson about dumplings.\n\n00:00:04.000 --> 00:00:09.000\nFold the dumpling edges tightly so they do not open.\n"
r = c.post(f"/api/video/studio/videos/{e['id']}/captions", files={"file": ("cap.vtt", vtt, "text/vtt")}, data={"language": "en"})
check("creator captions accepted", r.status_code, 200)
ok("AI runs from the creator's own captions",
   wait_for(lambda: c.get(f"/api/video/studio/videos/{e['id']}").json()["ai_status"] == "ready", 60))
a = viewer.post(f"/api/video/videos/{e['public_id']}/ask", json={"question": "How should I fold the dumpling edges?"}).json()
check("Ask now answers from the captions", a["status"], "answered")

print("\n== Connected YouTube channel (sandbox)")
start = c.get("/api/video/studio/connected/youtube/start").json()
import httpx  # noqa: E402

r = httpx.get(start["url"], follow_redirects=False)
check("OAuth round trip redirects to the studio", r.status_code, 307)
ok("three own videos imported", wait_for(lambda: len([v for v in c.get("/api/video/studio/videos", params={"q": "YouTube copy"}).json()
                                                      if v["ai_status"] == "ready"]) == 3, 90))
yt = c.get("/api/video/studio/videos", params={"q": "YouTube copy"}).json()
ok("imported as owner-verified embeds", all(v["source"] == "embed" and v["embed_platform"] == "youtube" for v in yt))
check("tampered OAuth state refused", httpx.get(start["url"].replace("state=", "state=9"), follow_redirects=False).status_code, 400)

finish()
