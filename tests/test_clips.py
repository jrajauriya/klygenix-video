import httpx

from harness import check, creator, finish, ok, premium, settled, sql, upload

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

finish()
