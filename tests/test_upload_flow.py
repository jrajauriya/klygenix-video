import httpx

from harness import BASE, check, creator, finish, ok, settled, signup, sql, upload

print("\n== Upload rules")
c = creator()
r = c.post("/api/video/studio/videos", json={"title": "No rights", "rights_declared": False})
check("rights declaration is required (rule V09)", r.status_code, 400)
r = c.post("/api/video/studio/videos", json={"title": "Too big", "rights_declared": True, "size_bytes": 10 ** 13})
check("oversized upload refused", r.status_code, 413)

print("\n== Upload → encode → publish")
v = upload(c, "reel-git-mistake", "Git mistake reel")
pid = v["public_id"]
check("new video starts uploading", v["status"], "uploading")
viewer = signup("Watcher")
v = settled(c, v["id"])
check("published after the scan", v["status"], "published")
check("vertical and short → reel", v["kind"], "reel")
ok("duration measured", 10_000 < v["duration_ms"] < 15_000, v["duration_ms"])
d = viewer.get(f"/api/video/videos/{pid}").json()
check("playback is HLS", d["playback"]["type"], "hls")
m = httpx.get(d["playback"]["url"], timeout=30)
check("master playlist served", m.status_code, 200)
ok("master lists renditions", "#EXT-X-STREAM-INF" in m.text)
ok("a 240p rung for fast starts", "240p/index.m3u8" in m.text, m.text)
bad = d["playback"]["url"].replace("/master.m3u8", "x/master.m3u8")
parts = d["playback"]["url"].split("/")
parts[-2] = "0" * 32
check("tampered signature refused", httpx.get("/".join(parts), timeout=30).status_code, 403)
seg_list = httpx.get(d["playback"]["url"].replace("master.m3u8", "360p/index.m3u8"), timeout=30)
ok("rendition playlist has segments", ".ts" in seg_list.text)

print("\n== Upload links and webhooks (rule 06)")
again = httpx.put(d["playback"]["url"].replace("/hls/", "/upload/").rsplit("/", 1)[0], content=b"x", timeout=30)
ok("an HLS signature is not an upload signature", again.status_code in (403, 404, 405))
r = c.post("/api/video/studio/videos", json={"title": "Second", "rights_declared": True})
up = r.json()["upload"]
expired = up["url"].replace(f"/{up['expires_at']}/", "/1000/")
check("expired upload link refused", httpx.put(expired, content=b"x", timeout=30).status_code, 403)
r = httpx.post(f"{BASE}/api/video/webhooks/media/sandbox", content=b'{"id":"x","event":"encoded","video":"sbx-1"}',
               headers={"x-sandbox-signature": "nope"}, timeout=30)
check("unsigned media webhook refused", r.status_code, 400)
events = sql("select count(*) from kv_commerce.provider_events where rail='media:sandbox' and signature_ok")
before = events[0][0]
row = sql("select body from kv_commerce.provider_events where rail='media:sandbox' and signature_ok order by id desc limit 1")[0][0]
from app.video.rails.sandbox import sign  # noqa: E402

r = httpx.post(f"{BASE}/api/video/webhooks/media/sandbox", content=row.encode(), headers={"x-sandbox-signature": sign(row.encode())}, timeout=30)
check("replayed signed webhook accepted", r.status_code, 200)
after = sql("select count(*) from kv_commerce.provider_events where rail='media:sandbox' and signature_ok")[0][0]
check("replay filed nothing new", after, before)

print("\n== Visibility")
v2 = upload(c, "reel-chai", "Unlisted chai", visibility="unlisted")
v2 = settled(c, v2["id"])
check("unlisted reachable by link", viewer.get(f"/api/video/videos/{v2['public_id']}").status_code, 200)
home = [x["id"] for x in viewer.get("/api/video/feed/reels", params={"limit": 30}).json()]
ok("unlisted not in the feed", v2["public_id"] not in home)
c.delete(f"/api/video/studio/videos/{v2['id']}")
check("deleted video is gone", viewer.get(f"/api/video/videos/{v2['public_id']}").status_code, 404)

finish()
