import httpx

from harness import BASE, check, creator, finish, ok, settled, signup, upload

print("\n== Playlists and series")
c = creator("Playlist creator")
handle = c.get("/api/video/studio/channel").json()["channel"]["handle"]
a = settled(c, upload(c, "reel-chai", "Series part one")["id"])
b = settled(c, upload(c, "reel-three-tips", "Series part two")["id"])
hidden = settled(c, upload(c, "reel-git-mistake", "Private part", visibility="private")["id"])

r = c.post("/api/video/studio/playlists", json={"title": "Starter series", "kind": "series", "visibility": "public"})
check("create series", r.status_code, 201)
pl = r.json()["id"]
check("bad kind refused", c.post("/api/video/studio/playlists", json={"title": "x", "kind": "album"}).status_code, 400)
for v in (a, b, hidden):
    check(f"add {v['title']}", c.post(f"/api/video/studio/playlists/{pl}/items", json={"video_id": v["id"]}).status_code, 201)
check("adding twice is harmless", c.post(f"/api/video/studio/playlists/{pl}/items", json={"video_id": a["id"]}).status_code, 201)
studio_list = c.get("/api/video/studio/playlists").json()
check("studio sees all three", next(p for p in studio_list if p["id"] == pl)["video_count"], 3)

outsider = creator("Playlist outsider")
check("another creator cannot add to it", outsider.post(f"/api/video/studio/playlists/{pl}/items", json={"video_id": a["id"]}).status_code, 404)
other_video = settled(outsider, upload(outsider, "reel-chai", "Outsider reel")["id"])
check("cannot add someone else's video", c.post(f"/api/video/studio/playlists/{pl}/items", json={"video_id": other_video["id"]}).status_code, 404)

public = httpx.get(f"{BASE}/api/video/playlists/{pl}").json()
check("public sees two (private video hidden)", [v["id"] for v in public["videos"]], [a["public_id"], b["public_id"]])
check("public series kind", public["kind"], "series")
listed = httpx.get(f"{BASE}/api/video/channels/{handle}/playlists").json()
ok("listed on the channel with a cover", any(p["id"] == pl and p["video_count"] == 2 and p["cover"] for p in listed))

check("reorder", c.put(f"/api/video/studio/playlists/{pl}/order", json={"video_ids": [b["id"], hidden["id"], a["id"]]}).status_code, 200)
check("new order shows", [v["id"] for v in httpx.get(f"{BASE}/api/video/playlists/{pl}").json()["videos"]], [b["public_id"], a["public_id"]])
check("reorder must name every item", c.put(f"/api/video/studio/playlists/{pl}/order", json={"video_ids": [a["id"]]}).status_code, 400)

viewer = signup("Series viewer")
viewer.post(f"/api/video/videos/{b['public_id']}/progress", json={"position_ms": 9000, "completed": True})
prog = viewer.get(f"/api/video/me/playlists/{pl}/progress").json()
check("progress counts the finished part", prog["completed"], 1)
check("progress points at the next part", prog["next"], a["public_id"])
check("progress percent", prog["percent"], 50)
ok("progress needs sign-in", httpx.get(f"{BASE}/api/video/me/playlists/{pl}/progress").status_code in (401, 403))

check("make it private", c.patch(f"/api/video/studio/playlists/{pl}", json={"visibility": "private"}).status_code, 200)
check("private playlist is 404 to the public", httpx.get(f"{BASE}/api/video/playlists/{pl}").status_code, 404)
check("owner still sees it", c.get(f"/api/video/playlists/{pl}").status_code, 200)
ok("not listed on the channel", all(p["id"] != pl for p in httpx.get(f"{BASE}/api/video/channels/{handle}/playlists").json()))
check("remove an item", c.delete(f"/api/video/studio/playlists/{pl}/items/{a['id']}").status_code, 204)
check("delete", c.delete(f"/api/video/studio/playlists/{pl}").status_code, 204)
check("gone", c.get(f"/api/video/playlists/{pl}").status_code, 404)
check("unknown channel", httpx.get(f"{BASE}/api/video/channels/no-such-handle-zz/playlists").status_code, 404)

finish()
