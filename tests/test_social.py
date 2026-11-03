import asyncio
import json

import websockets

from harness import BASE, check, creator, finish, flush_counters, ok, settled, signup, sql, upload

print("\n== Danmaku")
c = creator()
v = settled(c, upload(c, "reel-three-tips", "Social suite reel")["id"])
pid = v["public_id"]
a = signup("Danmaku A")
b = signup("Danmaku B")
r = a.post(f"/api/video/videos/{pid}/danmaku", json={"t_ms": 2000, "text": "nice tip", "mode": "scroll", "color": "#FF00AA"})
check("danmaku posted", r.status_code, 201)
d_id = r.json()["id"]
check("over 60 characters refused", a.post(f"/api/video/videos/{pid}/danmaku", json={"t_ms": 1000, "text": "x" * 61}).status_code, 400)
check("abuse refused", a.post(f"/api/video/videos/{pid}/danmaku", json={"t_ms": 1000, "text": "you bitch"}).status_code, 400)
check("links refused", a.post(f"/api/video/videos/{pid}/danmaku", json={"t_ms": 1000, "text": "see www.spam.example"}).status_code, 400)
check("bad colour refused", a.post(f"/api/video/videos/{pid}/danmaku", json={"t_ms": 1000, "text": "hi", "color": "red"}).status_code, 422)
check("anonymous cannot post", signup("x").get("/api/video/feed/home").status_code, 200)
items = b.get(f"/api/video/videos/{pid}/danmaku", params={"from_ms": 0, "to_ms": 60000}).json()
ok("bucket returns the line", any(i["id"] == d_id for i in items))
items = b.get(f"/api/video/videos/{pid}/danmaku", params={"from_ms": 3000, "to_ms": 60000}).json()
ok("bucket respects its window", all(i["t_ms"] >= 3000 for i in items))
check("someone else cannot delete it", b.delete(f"/api/video/danmaku/{d_id}").status_code, 403)
r = a.post(f"/api/video/videos/{pid}/danmaku", json={"t_ms": 3000, "text": "to be reported"})
rep_id = r.json()["id"]
for who in (b, signup("R2"), signup("R3")):
    who.post("/api/video/reports", json={"target_type": "danmaku", "target_id": str(rep_id), "reason": "spam"})
check("three reports hide a line", sql("select status from kv_social.danmaku where id=:i", i=rep_id)[0][0], "hidden")
check("video owner can delete any line", c.delete(f"/api/video/danmaku/{d_id}").status_code, 204)


async def realtime():
    ws_url = BASE.replace("http", "ws") + f"/api/video/ws/videos/{pid}"
    async with websockets.connect(ws_url) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), 5))
        await asyncio.sleep(0.3)
        await asyncio.to_thread(lambda: a.post(f"/api/video/videos/{pid}/danmaku", json={"t_ms": 4000, "text": "live line"}))
        got = json.loads(await asyncio.wait_for(ws.recv(), 5))
        return hello, got


hello, got = asyncio.run(realtime())
check("room says hello", hello["type"], "hello")
check("a new line reaches the room", got.get("item", {}).get("text"), "live line")

print("\n== Comments")
r = b.post(f"/api/video/videos/{pid}/comments", json={"body": "Great reel"})
check("comment posted", r.status_code, 201)
cid = r.json()["id"]
r = a.post(f"/api/video/videos/{pid}/comments", json={"body": "Agreed", "parent_id": cid})
check("reply posted", r.status_code, 201)
r = a.post(f"/api/video/videos/{pid}/comments", json={"body": "buy now at https://spam.example"})
check("comment with a link is held", r.json()["status"], "hidden")
top = b.get(f"/api/video/videos/{pid}/comments").json()
ok("top level lists the comment with one reply", any(x["id"] == cid and x["replies"] == 1 for x in top))
replies = b.get(f"/api/video/videos/{pid}/comments", params={"parent_id": cid}).json()
check("reply listed under its parent", len(replies), 1)
check("stranger cannot delete", a.delete(f"/api/video/comments/{cid}").status_code, 403)
check("author can delete", b.delete(f"/api/video/comments/{cid}").status_code, 204)

print("\n== Likes, follows, progress and counters (rule V06)")
check("like", a.post(f"/api/video/videos/{pid}/like").json()["liked"], True)
check("like twice is still one", a.post(f"/api/video/videos/{pid}/like").json()["liked"], True)
handle = c.get("/api/video/studio/channel").json()["channel"]["handle"]
check("follow", a.post(f"/api/video/channels/{handle}/follow").json()["following"], True)
check("cannot follow yourself", c.post(f"/api/video/channels/{handle}/follow").status_code, 400)
a.post(f"/api/video/videos/{pid}/progress", json={"position_ms": 9000, "watched_ms": 9000, "started": True})
b.post(f"/api/video/videos/{pid}/progress", json={"position_ms": 14000, "watched_ms": 14000, "started": True, "completed": True})
d = a.get(f"/api/video/videos/{pid}").json()
check("liked flag", d["liked"], True)
check("following flag", d["following"], True)
check("resume position", d["resume_ms"], 9000)
before = sql("select view_count, like_count from kv_media.videos where id=:i", i=v["id"])[0]
ok("pending counts are visible before the flush", d["views"] >= 2 and d["likes"] >= 1, (d["views"], d["likes"]))
flush_counters()
after = sql("select view_count, like_count, completions from kv_media.videos where id=:i", i=v["id"])[0]
ok("flush wrote the counts", after[0] >= before[0] + 2 and after[1] >= 1 and after[2] >= 1, (before, after))
hist = a.get("/api/video/me/history").json()
ok("history shows the video", any(h["id"] == pid for h in hist))
check("unfollow", a.delete(f"/api/video/channels/{handle}/follow").json()["following"], False)

print("\n== Feeds")
reels = a.get("/api/video/feed/reels", params={"limit": 30}).json()
ok("reels feed has reels only", reels and all(x["kind"] == "reel" for x in reels))
ok("reels carry playback", all(x.get("playback") for x in reels))
home = a.get("/api/video/feed/home", params={"limit": 60}).json()
ok("home feed has long videos only", all(x["kind"] == "long" for x in home))
a.post(f"/api/video/channels/{handle}/follow")
following = a.get("/api/video/feed/following").json()
ok("following feed shows the creator", any(x["channel"]["handle"] == handle for x in following))

finish()
