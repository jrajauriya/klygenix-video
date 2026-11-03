import os
import time

import httpx

from harness import check, creator, finish, ok, premium, settled, sql, upload
from app.video.studio import faces, reframe

print("\n== Clip maker")
c = creator()
v = settled(c, upload(c, "azure-apim-auth", "Clip suite lesson")["id"])
sug = c.get(f"/api/video/studio/videos/{v['id']}/suggestions").json()
s = sug[0]
r = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "title": "Too long", "start_ms": 0, "end_ms": 95_000})
check("clip over 90 s refused", r.status_code, 400)
r = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "title": "Outside", "start_ms": 80_000, "end_ms": 500_000})
check("clip outside the video refused", r.status_code, 400)
r = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "suggestion_id": s["id"], "title": s["title"],
                                            "start_ms": s["start_ms"], "end_ms": s["end_ms"], "caption_style": "bold"})
check("clip created", r.status_code, 201)
clip = r.json()
check("free plan clips are watermarked", clip["watermark"], True)
r = c.post(f"/api/video/studio/clips/{clip['id']}/render")
check("render queued", r.status_code, 200)


def rendered(cid):
    import time
    for _ in range(120):
        x = c.get(f"/api/video/studio/clips/{cid}").json()
        if x["status"] in ("rendered", "failed"):
            return x
        time.sleep(1)
    return x


clip = rendered(clip["id"])
check("render finished", clip["status"], "rendered")
mp4 = httpx.get(clip["download_url"], timeout=60)
check("download works", mp4.status_code, 200)
open("/tmp/kv-suite-clip.mp4", "wb").write(mp4.content)
from app.video.media.ffmpeg import probe  # noqa: E402

p = probe("/tmp/kv-suite-clip.mp4")
check("rendered vertical 720x1280", (p.width, p.height), (720, 1280))
ok("rendered length matches the range", abs(p.duration_ms - (s["end_ms"] - s["start_ms"])) <= 600, p.duration_ms)
ok("audio kept", p.has_audio)
r = c.post(f"/api/video/studio/clips/{clip['id']}/publish", json={"title": "Suite reel from clip"})
check("publish accepted", r.status_code, 200)
new_id = r.json()["video_id"]
reel = settled(c, new_id)
check("published as a reel", (reel["status"], reel["kind"], reel["source"]), ("published", "reel", "clip"))
check("the clip links to its reel", c.get(f"/api/video/studio/clips/{clip['id']}").json()["status"], "published")

print("\n== Render quota (free: 3 a month)")
f = creator("Free renderer")
v2 = settled(f, upload(f, "dal-tadka", "Quota dal")["id"])
codes = []
for i in range(4):
    cl = f.post("/api/video/studio/clips", json={"source_video_id": v2["id"], "title": f"q{i}", "start_ms": 0, "end_ms": 15_000,
                                                 "caption_style": "none"}).json()
    codes.append(f.post(f"/api/video/studio/clips/{cl['id']}/render").status_code)
check("three renders allowed, the fourth refused", codes, [200, 200, 200, 402])

print("\n== Creator Pro removes the watermark")
premium(c, "creator_pro")
cl = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "title": "Pro clip", "start_ms": 1000, "end_ms": 17_000}).json()
check("no watermark on Creator Pro", cl["watermark"], False)
check("editing a rendered clip resets it", c.patch(f"/api/video/studio/clips/{clip['id']}", json={"title": "x"}).status_code, 409)

print("\n== Reframe: keyframes and tracking")

ok("no detections fill to centre", reframe.fill([(0, None), (250, None)]) == [(0, 0.5), (250, 0.5)])
jitter = reframe.smooth([(i * 250, 0.5 + (0.02 if i % 2 else -0.02)) for i in range(12)])
ok("jitter inside the dead zone does not move the frame", max(abs(c - 0.5) for _, c in jitter) < 0.03, jitter[-1])
expr = reframe.x_expr([{"t_ms": 1000, "cx": 0.2}, {"t_ms": 5000, "cx": 0.8}], 1000, 1280, 404)
ok("track becomes a clamped piecewise crop expression", expr.startswith("clip(if(lt(t,0.000)") and expr.endswith(",0,876)"), expr)
fixture = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "media", "reframe-marker.mp4")
ok("opencv face detector finds no face in a test card", sum(faces.OpenCvDetector().centre(i) is not None
                                                          for _, i in faces.frames(fixture, 0, 4000)) == 0)
m = settled(c, upload(c, "reframe-marker", "Reframe walk")["id"])
cl = c.post("/api/video/studio/clips", json={"source_video_id": m["id"], "title": "Tracked", "start_ms": 0,
                                             "end_ms": m["duration_ms"], "caption_style": "none"}).json()
r = c.post(f"/api/video/studio/clips/{cl['id']}/track")
check("tracking accepted", r.status_code, 202)
for _ in range(60):
    cl = c.get(f"/api/video/studio/clips/{cl['id']}").json()
    if cl["reframe"].get("status") != "tracking":
        break
    time.sleep(1)
rf = cl["reframe"]
check("track ready", (rf.get("mode"), rf.get("status")), ("track", "ready"))
ok("subject found in most samples", rf["found"] >= rf["samples"] * 0.8, rf)
ok("track follows the subject left to right", rf["track"][0]["cx"] < 0.3 and rf["track"][-1]["cx"] > 0.7, rf["track"])
ok("track is simplified", 2 <= len(rf["track"]) <= 60, len(rf["track"]))
check("render with a track", c.post(f"/api/video/studio/clips/{cl['id']}/render").status_code, 200)
cl = rendered(cl["id"])
check("tracked render finished", cl["status"], "rendered")
open("/tmp/kv-suite-track.mp4", "wb").write(httpx.get(cl["download_url"], timeout=60).content)
check("tracked render is vertical", (probe("/tmp/kv-suite-track.mp4").width, probe("/tmp/kv-suite-track.mp4").height), (720, 1280))
marker = faces.MarkerDetector()
seen = [marker.centre(img) for _, img in faces.frames("/tmp/kv-suite-track.mp4", 500, 7000, width=180, fps=1)]
ok("the subject stays inside the vertical frame", seen and all(x is not None and 0.15 < x < 0.85 for x in seen), seen)
r = c.patch(f"/api/video/studio/clips/{cl['id']}", json={"keyframes": [{"t_ms": 0, "cx": 0.1}, {"t_ms": 7000, "cx": 0.9}]})
check("manual keyframes saved", (r.status_code, r.json()["reframe"]["mode"], len(r.json()["reframe"]["track"])), (200, "manual", 2))
check("editing resets the render", r.json()["status"], "draft")
r = c.patch(f"/api/video/studio/clips/{cl['id']}", json={"keyframes": [{"t_ms": 60_000, "cx": 0.5}]})
check("keyframe outside the clip refused", r.status_code, 400)
r = c.patch(f"/api/video/studio/clips/{cl['id']}", json={"keyframes": []})
check("empty keyframes go back to centre", r.json()["reframe"]["mode"], "center")

finish()
