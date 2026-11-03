import time

import httpx

from harness import check, creator, finish, ok, premium, settled, signup, upload, wait_for
from app.video.media.ffmpeg import probe

print("\n== Licensed music library for clips (V2.12, rule V11)")
c = creator("Publishing Creator")
premium(c, "creator_pro")
v = settled(c, upload(c, "reel-chai", "Music and publishing")["id"])
lib = c.get("/api/video/studio/music").json()
check("the library has four licensed tracks", len(lib), 4)
ok("every track carries its licence", all(t["licence"] for t in lib))
check("a track can be previewed", c.get(f"/api/video/studio/music/{lib[0]['id']}.m4a").headers.get("content-type"), "audio/mp4")
cl = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "title": "Chai with music", "start_ms": 0,
                                             "end_ms": 8000, "caption_style": "none"}).json()
r = c.patch(f"/api/video/studio/clips/{cl['id']}", json={"music": {"track_id": lib[1]["id"], "volume": 0.4, "duck": True}})
check("music chosen for the clip", (r.json()["music"]["track_id"], r.json()["music"]["volume"]), (lib[1]["id"], 0.4))
check("an unknown track is refused", c.patch(f"/api/video/studio/clips/{cl['id']}", json={"music": {"track_id": 99999}}).status_code, 404)

print("\n== Publish targets need a rendered clip (V2.9)")
check("publishing before the render is refused", c.post(f"/api/video/studio/clips/{cl['id']}/targets",
                                                        json={"platform": "youtube"}).status_code, 409)
c.post(f"/api/video/studio/clips/{cl['id']}/render")
for _ in range(120):
    x = c.get(f"/api/video/studio/clips/{cl['id']}").json()
    if x["status"] in ("rendered", "failed"):
        break
    time.sleep(1)
check("the clip with music rendered", x["status"], "rendered")
open("/tmp/kv-suite-music.mp4", "wb").write(httpx.get(x["download_url"], timeout=60).content)
p = probe("/tmp/kv-suite-music.mp4")
ok("the render keeps an audio track with the music mixed in", p.has_audio and abs(p.duration_ms - 8000) <= 600, p)
check("an unknown platform is refused", c.post(f"/api/video/studio/clips/{cl['id']}/targets", json={"platform": "tiktok"}).status_code, 400)
check("publishing needs a connected account", c.post(f"/api/video/studio/clips/{cl['id']}/targets",
                                                      json={"platform": "instagram"}).status_code, 409)
for platform in ("youtube", "instagram"):
    start = c.get(f"/api/video/studio/connected/{platform}/start").json()
    back = httpx.get(start["url"], follow_redirects=False, timeout=30)
    check(f"{platform} connects (sandbox OAuth round trip)", (back.status_code in (302, 303, 307), "connected=1" in back.headers.get("location", "")), (True, True))
conn = {x["platform"]: x for x in c.get("/api/video/studio/connected").json()}
ok("the Instagram professional account is listed", "instagram" in conn and conn["instagram"]["sandbox"], conn.get("instagram"))
bad = c.get("/api/video/studio/connected/instagram/start").json()["url"].replace("state=", "state=9")
check("a tampered Instagram state is refused", httpx.get(bad, follow_redirects=False, timeout=30).status_code, 400)
for platform in ("youtube", "instagram"):
    r = c.post(f"/api/video/studio/clips/{cl['id']}/targets", json={"platform": platform, "caption": "Chai time #shorts"})
    check(f"{platform} publish accepted", r.status_code, 202)
targets = wait_for(lambda: (lambda ts: ts if all(t["status"] in ("published", "failed") for t in ts.values()) else None)(
    {t["platform"]: t for t in c.get(f"/api/video/studio/clips/{cl['id']}/targets").json()}), 60)
check("published to both on the sandbox", (targets["youtube"]["status"], targets["instagram"]["status"]), ("published", "published"))
ok("each has an external id", targets["youtube"]["external_id"].startswith("sbx-youtube-"), targets["youtube"])
check("publishing twice is refused", c.post(f"/api/video/studio/clips/{cl['id']}/targets", json={"platform": "youtube"}).status_code, 409)
check("another creator cannot publish this clip", creator("Thief").post(f"/api/video/studio/clips/{cl['id']}/targets",
                                                                         json={"platform": "youtube"}).status_code, 404)

print("\n== Product links, disclosed (V2.12)")
check("only https links", c.post(f"/api/video/studio/videos/{v['id']}/products", json={
    "title": "Masala tin", "url": "http://shop.example.com/tin"}).status_code, 400)
links = [c.post(f"/api/video/studio/videos/{v['id']}/products", json={"title": f"Item {i}", "url": f"https://shop.example.com/{i}",
                                                                       "price_text": "₹299", "position": i}) for i in range(5)]
check("five links added", [r.status_code for r in links], [201] * 5)
check("a sixth is refused", c.post(f"/api/video/studio/videos/{v['id']}/products", json={"title": "x", "url": "https://shop.example.com/x"}).status_code, 409)
viewer = signup("Shopper")
d = viewer.get(f"/api/video/videos/{v['public_id']}").json()
ok("the watch page shows the links with a disclosure", d["products"] and "does not sell" in d["products"]["disclosure"], d["products"])
ok("the target URL is not exposed until clicked", all("url" not in i for i in d["products"]["items"]))
first = links[0].json()["id"]
check("a click returns the link", viewer.post(f"/api/video/products/{first}/click").json()["url"], "https://shop.example.com/0")
check("clicks are counted for the creator", next(x["clicks"] for x in c.get(f"/api/video/studio/videos/{v['id']}/products").json() if x["id"] == first), 1)
check("another creator cannot add links here", creator("Linker").post(f"/api/video/studio/videos/{v['id']}/products",
                                                                        json={"title": "x", "url": "https://a.example.com/b"}).status_code, 404)
check("a link can be removed", c.delete(f"/api/video/studio/videos/{v['id']}/products/{first}").status_code, 204)

finish()
