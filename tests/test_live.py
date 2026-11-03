import asyncio
import json
import os
import subprocess
import time

import httpx
import websockets

from harness import (BASE, PAYOUT_ACCOUNT, admin_login, check, client, creator, finish, ok, settled, signup, sql, support_pay,
                     wait_for)

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "media", "reframe-marker.mp4")


def publish(server: str, key: str, seconds: int | None = None) -> subprocess.Popen:
    args = ["ffmpeg", "-v", "error", "-re", "-stream_loop", "-1", "-i", FIXTURE, "-c:v", "libx264", "-preset", "ultrafast",
            "-tune", "zerolatency", "-g", "30", "-c:a", "aac", "-f", "flv", f"{server}/{key}"]
    if seconds:
        args[args.index("-i"):args.index("-i")] = ["-t", str(seconds)]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


print("\n== Going live from an encoder (V4.1, V4.2)")
c = creator("Live Creator")
handle = sql("SELECT handle FROM kv_social.channels WHERE tenant_id = :t", t=c.user["tenant_id"])[0][0]
r = c.post("/api/video/studio/live", json={"title": "Chai live session", "description": "Making chai live"})
check("a stream is created", r.status_code, 201)
st = r.json()
pid = st["id"]
check("one open stream per channel", c.post("/api/video/studio/live", json={"title": "Second"}).status_code, 409)
key = c.get(f"/api/video/studio/live/{pid}/key").json()
ok("the creator gets an RTMP server and a key", key["server"].startswith("rtmp://") and len(key["stream_key"]) >= 20, key["server"])
check("someone else cannot read the key", creator("Other").get(f"/api/video/studio/live/{pid}/key").status_code, 404)
viewer = signup("Live Viewer")
check("a scheduled stream has no playback yet", viewer.get(f"/api/video/live/{pid}").json()["playback"], None)
bad = publish(key["server"], "wrong-key-123", seconds=3)
bad.wait(20)
time.sleep(1.5)
check("a wrong key never goes live", viewer.get(f"/api/video/live/{pid}").json()["status"], "scheduled")
enc = publish(key["server"], key["stream_key"])
try:
    d = wait_for(lambda: (lambda x: x if x["status"] == "live" else None)(viewer.get(f"/api/video/live/{pid}").json()), 40, 0.5)
    check("the stream goes live once the encoder connects", d and d["status"], "live")
    pb = d["playback"]
    ok("viewers get a live playlist", pb and pb["live"] and pb["url"].endswith("index.m3u8"), pb)
    check("the playback link stays the same between polls", viewer.get(f"/api/video/live/{pid}").json()["playback"]["url"], pb["url"])
    m3u8 = httpx.get(pb["url"], timeout=30).text
    ok("the playlist is live (segments, no end)", "#EXTINF" in m3u8 and "#EXT-X-ENDLIST" not in m3u8, m3u8[:200])
    seg = [x for x in m3u8.splitlines() if x.endswith(".ts")][-1]
    check("a live segment is served", httpx.get(pb["url"].replace("index.m3u8", seg), timeout=30).status_code, 200)
    check("a tampered playback link is refused", httpx.get(pb["url"].replace("/index.m3u8", "x/index.m3u8"), timeout=30).status_code in (403, 404), True)
    check("it is listed as live now", pid in [x["id"] for x in viewer.get("/api/video/live").json()], True)
    check("and on the channel", [x["id"] for x in viewer.get(f"/api/video/channels/{handle}/live").json()], [pid])

    print("\n== Live chat, slow mode, moderators (V4.3)")
    ws_url = BASE.replace("http", "ws") + f"/api/video/ws/live/{pid}"

    async def room():
        async with websockets.connect(ws_url) as a, websockets.connect(ws_url) as b:
            hello = json.loads(await asyncio.wait_for(a.recv(), 5))
            await asyncio.wait_for(b.recv(), 5)
            await asyncio.sleep(0.5)
            t0 = time.time()
            await asyncio.to_thread(lambda: viewer.post(f"/api/video/live/{pid}/chat", json={"body": "Namaste from Pune"}))

            async def next_of(ws, kind):
                end = time.time() + 8
                while time.time() < end:
                    m = json.loads(await asyncio.wait_for(ws.recv(), 8))
                    if m["type"] == kind:
                        return m
                return None

            ma, mb = await next_of(a, "chat"), await next_of(b, "chat")
            return hello, ma, mb, time.time() - t0

    hello, ma, mb, took = asyncio.run(room())
    check("the room says hello with the status", (hello["type"], hello["status"]), ("hello", "live"))
    ok("chat reaches every watcher fast", ma and mb and ma["item"]["body"] == "Namaste from Pune" and took < 1.0, (took, ma))
    check("abuse is refused", viewer.post(f"/api/video/live/{pid}/chat", json={"body": "you bitch"}).status_code, 400)
    check("links are refused", viewer.post(f"/api/video/live/{pid}/chat", json={"body": "go to www.spam.example"}).status_code, 400)
    check("the creator turns on slow mode", c.post(f"/api/video/live/{pid}/moderate", json={"action": "slow_mode", "seconds": 30}).json()["slow_mode_seconds"], 30)
    chatty = signup("Chatty")
    check("first message in slow mode", chatty.post(f"/api/video/live/{pid}/chat", json={"body": "one"}).status_code, 201)
    check("a second message within 30 s is held back", chatty.post(f"/api/video/live/{pid}/chat", json={"body": "two"}).status_code, 429)
    mod = signup("Live Mod")
    c.post("/api/video/studio/moderators", json={"email": mod.email})
    check("a channel moderator times someone out", mod.post(f"/api/video/live/{pid}/moderate", json={"action": "timeout", "user_id": chatty.user["id"], "seconds": 60}).status_code, 200)
    check("the timed-out viewer cannot chat", chatty.post(f"/api/video/live/{pid}/chat", json={"body": "three"}).status_code, 403)
    hist = viewer.get(f"/api/video/live/{pid}/chat").json()
    ok("history marks the viewer's own messages", any(x["mine"] for x in hist) and not all(x["mine"] for x in hist))
    other_msg = next(x for x in hist if not x["mine"])
    check("a moderator can time out the author of a message", mod.post(f"/api/video/live/{pid}/moderate",
          json={"action": "timeout", "message_id": other_msg["id"], "seconds": 30}).status_code, 200)
    ok("anonymous history has no mine flag", all("mine" not in x for x in client().get(f"/api/video/live/{pid}/chat").json()))
    check("the moderator hides a message", mod.post(f"/api/video/live/{pid}/moderate", json={"action": "hide", "message_id": hist[0]["id"]}).json()["ok"], True)
    ok("hidden messages leave the history", all(x["id"] != hist[0]["id"] for x in viewer.get(f"/api/video/live/{pid}/chat").json()))
    check("a stranger cannot moderate", signup("Stranger").post(f"/api/video/live/{pid}/moderate", json={"action": "slow_mode_off"}).status_code, 403)
    c.post(f"/api/video/live/{pid}/moderate", json={"action": "slow_mode_off"})

    print("\n== Super chats and gifts (V4.4)")
    check("no super chat before payouts are set up", viewer.post("/api/video/support/checkout", json={
        "purpose": "superchat", "stream_id": pid, "boost_tier": 1, "message": "hi"}).status_code, 409)
    c.put("/api/video/studio/earnings/account", json=PAYOUT_ACCOUNT)
    c.post("/api/video/studio/earnings/account/submit")
    sc = support_pay(viewer, {"purpose": "superchat", "stream_id": pid, "boost_tier": 2, "message": "Best chai stream!"})
    d = wait_for(lambda: (lambda x: x if x["pinned"] else None)(viewer.get(f"/api/video/live/{pid}").json()), 20)
    pin = d["pinned"][0]
    check("the super chat is pinned with its tier", (pin["kind"], pin["tier"], pin["paid_minor"], pin["body"]),
          ("superchat", "Spotlight", 19900, "Best chai stream!"))
    support_pay(viewer, {"purpose": "gift", "stream_id": pid, "gift": "chai"})
    sales = wait_for(lambda: (lambda x: x if len(x) >= 2 else None)(c.get("/api/video/studio/earnings/sales").json()), 20)
    check("both are split for the creator", sorted(x["purpose"] for x in sales), ["gift", "superchat"])
    check("an unknown gift is refused", viewer.post("/api/video/support/checkout", json={"purpose": "gift", "stream_id": pid, "gift": "yacht"}).status_code, 400)
    r = c.post(f"/api/video/live/{pid}/moderate", json={"action": "hide", "message_id": pin["id"]})
    check("the creator removing a paid message refunds it", r.json()["refunded"], True)
    adm = admin_login()
    p = next(x for x in adm.get("/api/video/admin/payments?purpose=superchat").json() if x["checkout_id"] == sc["id"])
    check("the fan got the money back", p["refundable_minor"], 0)
    gift = next(x for x in viewer.get(f"/api/video/live/{pid}/chat").json() if x["kind"] == "gift")
    r = mod.post(f"/api/video/live/{pid}/moderate", json={"action": "hide", "message_id": gift["id"]})
    check("a channel moderator removing a paid gift refunds it too", r.json()["refunded"], True)
    r = viewer.post("/api/video/support/checkout", json={"purpose": "superchat", "stream_id": pid, "tier": 1, "message": "hello"})
    check("a super chat tier can be sent as tier", (r.status_code, r.json().get("amount_minor")), (201, 4900))
    check("the detail says whether the viewer follows the channel", "following" in viewer.get(f"/api/video/live/{pid}").json(), True)
    exp = viewer.post("/api/video/me/export").json()
    ok("the data export includes the viewer's live chat", any(x["body"] == "Namaste from Pune" for x in exp["live_chat"]))
    ok("and the notifications sent to them", isinstance(exp["notifications"], list))

    print("\n== Members-only live")
    tier = c.post("/api/video/studio/memberships/tiers", json={"name": "Live club", "rank": 1, "price_minor": 4900}).json()
    sql("UPDATE kv_media.live_streams SET members_rank = 1 WHERE public_id = :p", p=pid)
    outsider = signup("Outsider")
    d = outsider.get(f"/api/video/live/{pid}").json()
    check("a non-member sees the lock and no stream", ((d["locked"] or {}).get("access"), d["playback"]), ("members", None))
    check("and cannot chat", outsider.post(f"/api/video/live/{pid}/chat", json={"body": "let me in"}).status_code, 402)
    support_pay(outsider, {"purpose": "membership", "tier_id": tier["id"]})
    check("joining opens the live stream", bool(outsider.get(f"/api/video/live/{pid}").json()["playback"]), True)
    sql("UPDATE kv_media.live_streams SET members_rank = NULL WHERE public_id = :p", p=pid)

    print("\n== Ending and the replay (V4.5)")
    time.sleep(3)
    check("the creator ends the stream", c.post(f"/api/video/studio/live/{pid}/end").json()["status"], "ended")
    end_text = wait_for(lambda: (lambda t: t if "#EXT-X-ENDLIST" in t else None)(httpx.get(pb["url"], timeout=30).text), 20, 0.5)
    ok("the playlist is closed", end_text is not None)
finally:
    enc.terminate()
    enc.wait(10)
replay = wait_for(lambda: c.get(f"/api/video/studio/live/{pid}").json()["replay_video_id"], 60)
ok("a replay video is created", replay)
rv = settled(c, replay, 240)
check("the replay goes through the normal pipeline and publishes", rv["status"], "published")
ok("the replay is labelled", "live replay" in rv["title"], rv["title"])
d = viewer.get(f"/api/video/live/{pid}").json()
check("the stream page points at the replay", (d["status"], d["replay"]["id"]), ("ended", rv["public_id"]))
check("a new stream can be opened after the end", c.post("/api/video/studio/live", json={"title": "Next time"}).status_code, 201)

print("\n== Platform stop")
nxt = c.get("/api/video/studio/live").json()[0]
r = adm.post(f"/api/video/admin/live/{nxt['id']}/stop", json={"reason": "Test stop"})
check("the platform can stop a stream", r.status_code, 200)
check("a stopped stream is ended", viewer.get(f"/api/video/live/{nxt['id']}").json()["status"], "ended")
check("a viewer cannot stop streams", viewer.post(f"/api/video/admin/live/{pid}/stop", json={"reason": "nope"}).status_code in (401, 403), True)

finish()
