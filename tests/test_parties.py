import asyncio
import json
import time

import httpx
import websockets

from harness import BASE, check, creator, finish, ok, settled, signup, upload

print("\n== Watch parties")
c = creator("Party creator")
v = settled(c, upload(c, "reel-three-tips", "Party reel")["id"])
host = signup("Party host")
guest = signup("Party guest")
stranger = signup("Party stranger")

r = host.post("/api/video/parties", json={"video_id": v["public_id"]})
check("host starts a party", r.status_code, 201)
party = r.json()
code = party["code"]
ok("six-character code", len(code) == 6 and code.isalnum())
check("host is host", party["is_host"], True)
check("anonymous cannot start one", httpx.post(f"{BASE}/api/video/parties", json={"video_id": v["public_id"]}).status_code in (401, 403), True)
check("unknown video refused", host.post("/api/video/parties", json={"video_id": "zzzzzzzzzzz"}).status_code, 404)
private = settled(c, upload(c, "reel-chai", "Private party reel", visibility="private")["id"])
check("someone else's private video refused", host.post("/api/video/parties", json={"video_id": private["public_id"]}).status_code, 404)

g = guest.get(f"/api/video/parties/{code.lower()}")
check("guest joins by code (any case)", g.status_code, 200)
check("guest is not host", g.json()["is_host"], False)
check("guest cannot drive the playhead", guest.post(f"/api/video/parties/{code}/state", json={"playing": True, "position_ms": 0}).status_code, 403)
check("unknown code", guest.get("/api/video/parties/ZZZZZZ").status_code, 404)


async def room():
    ws_url = BASE.replace("http", "ws") + f"/api/video/ws/parties/{code}"
    async with websockets.connect(ws_url) as a, websockets.connect(ws_url) as b:
        hello = json.loads(await asyncio.wait_for(a.recv(), 5))
        check("hello carries the state", (hello["type"], hello["video_id"], hello["playing"]), ("hello", v["public_id"], False))

        async def next_of(ws, kind):
            end = time.time() + 5
            while time.time() < end:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 5))
                if msg["type"] == kind:
                    return msg
            return None

        await asyncio.sleep(0.3)
        await asyncio.to_thread(lambda: host.post(f"/api/video/parties/{code}/state", json={"playing": True, "position_ms": 4000}))
        sa = await next_of(a, "state")
        sb = await next_of(b, "state")
        ok("both watchers get the play", sa and sb and sa["playing"] and sb["position_ms"] == 4000)
        await asyncio.to_thread(lambda: guest.post(f"/api/video/parties/{code}/chat", json={"text": "here we go"}))
        ca = await next_of(a, "chat")
        ok("chat reaches the room with a position", ca and ca["text"] == "here we go" and ca["name"] == "Party guest" and ca["position_ms"] >= 4000)
        await asyncio.to_thread(lambda: host.delete(f"/api/video/parties/{code}"))
        ended = await next_of(b, "ended")
        ok("ending the party tells the room", ended is not None)


time.sleep(0.2)
s = host.post(f"/api/video/parties/{code}/state", json={"playing": True, "position_ms": 1000}).json()
time.sleep(1.1)
later = guest.get(f"/api/video/parties/{code}").json()
ok("a late joiner sees the playhead moved on", later["position_ms"] >= 1900)
check("host pauses", host.post(f"/api/video/parties/{code}/state", json={"playing": False, "position_ms": 2500}).json()["position_ms"], 2500)
check("links refused in chat", guest.post(f"/api/video/parties/{code}/chat", json={"text": "go to www.spam.example"}).status_code, 400)
check("stranger cannot end it", stranger.delete(f"/api/video/parties/{code}").status_code, 403)
asyncio.run(room())
check("ended party is gone", guest.get(f"/api/video/parties/{code}").status_code, 404)

finish()
