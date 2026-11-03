import argparse
import asyncio
import json
import ssl
import statistics
import sys
import time
import uuid

import httpx
import websockets


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]


async def watcher(url: str, ctx, sent: dict, got: list, ready: asyncio.Event, stop: asyncio.Event, opened: list) -> None:
    try:
        async with websockets.connect(url, ssl=ctx, max_queue=None, open_timeout=30) as ws:
            opened.append(1)
            await asyncio.wait_for(ws.recv(), 30)
            ready.set()
            while not stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), 1)
                except asyncio.TimeoutError:
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "chat":
                    marker = msg["item"]["body"].split("#")[-1]
                    if marker in sent:
                        got.append(time.time() - sent[marker])
    except Exception:
        opened.append(0)


async def hls_poller(client: httpx.AsyncClient, url: str, stop: asyncio.Event, times: list, errors: list) -> None:
    while not stop.is_set():
        t = time.time()
        try:
            r = await client.get(url)
            seg = [x for x in r.text.splitlines() if x.endswith(".ts")]
            if seg:
                s = await client.get(url.replace("index.m3u8", seg[-1]))
                if s.status_code != 200:
                    errors.append(s.status_code)
            times.append(time.time() - t)
        except Exception:
            errors.append(-1)
        await asyncio.sleep(1)


async def main(a: argparse.Namespace) -> int:
    api = a.api.rstrip("/")
    verify = not a.insecure
    ctx = None
    if api.startswith("https") and a.insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    async with httpx.AsyncClient(base_url=api, verify=verify, timeout=30) as client:
        tokens = []
        for i in range(a.chatters):
            r = await client.post("/api/auth/signup", json={"name": f"Load chatter {i}", "email": f"load-{uuid.uuid4().hex[:10]}@example.com",
                                                          "password": "Load@123456", "birth_date": "1990-01-01", "country": "IN",
                                                          "language": "en"})
            tokens.append(r.json()["access_token"])
        ws_url = api.replace("http", "ws", 1) + f"/api/video/ws/live/{a.stream}"
        sent: dict[str, float] = {}
        got: list[float] = []
        opened: list[int] = []
        ready, stop = asyncio.Event(), asyncio.Event()
        tasks = []
        for i in range(a.watchers):
            tasks.append(asyncio.create_task(watcher(ws_url, ctx, sent, got, ready, stop, opened)))
            if i % 50 == 49:
                await asyncio.sleep(0.2)
        await asyncio.sleep(3)
        hls_times: list[float] = []
        hls_errors: list = []
        detail = (await client.get(f"/api/video/live/{a.stream}")).json()
        pollers = []
        if detail.get("playback"):
            for _ in range(a.hls_pollers):
                pollers.append(asyncio.create_task(hls_poller(client, detail["playback"]["url"], stop, hls_times, hls_errors)))
        end = time.time() + a.seconds
        n = 0
        rejected: dict[int, int] = {}
        while time.time() < end:
            tok = tokens[n % len(tokens)]
            marker = uuid.uuid4().hex[:12]
            sent[marker] = time.time()
            r = await client.post(f"/api/video/live/{a.stream}/chat", json={"body": f"load message #{marker}"},
                                  headers={"Authorization": f"Bearer {tok}"})
            if r.status_code != 201:
                sent.pop(marker, None)
                rejected[r.status_code] = rejected.get(r.status_code, 0) + 1
            n += 1
            await asyncio.sleep(a.interval)
        await asyncio.sleep(3)
        stop.set()
        await asyncio.gather(*tasks, *pollers, return_exceptions=True)
    ok_sockets = sum(1 for x in opened if x == 1)
    expected = len(sent) * ok_sockets
    p95 = pct(got, 95) * 1000
    print(f"{a.watchers} watchers ({ok_sockets} connected), {len(sent)} chat messages over {a.seconds}s, rejected {rejected}")
    print(f"deliveries {len(got)} of {expected} expected; latency p50 {pct(got, 50) * 1000:.0f} ms, p95 {p95:.0f} ms, "
          f"max {max(got, default=0) * 1000:.0f} ms, mean {statistics.mean(got) * 1000 if got else 0:.0f} ms")
    if hls_times:
        print(f"HLS playlist + segment fetch p95 {pct(hls_times, 95) * 1000:.0f} ms over {len(hls_times)} fetches, errors {len(hls_errors)}")
    failed = []
    if not sent:
        failed.append(f"no chat message was accepted (rejected: {rejected})")
    if p95 > a.p95_ms:
        failed.append(f"fan-out p95 {p95:.0f} ms > {a.p95_ms} ms")
    if ok_sockets < a.watchers:
        failed.append(f"only {ok_sockets} of {a.watchers} sockets connected")
    if expected and len(got) < expected * 0.99:
        failed.append(f"only {len(got)} of {expected} deliveries")
    print(json.dumps({"watchers": ok_sockets, "messages": len(sent), "deliveries": len(got), "p95_ms": round(p95), "failed": failed}))
    print("GREEN" if not failed else "RED: " + "; ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Live room load test: many watchers in one room, chatters posting; measures fan-out.")
    ap.add_argument("--api", default="http://localhost:9300")
    ap.add_argument("--stream", required=True, help="public id of a live stream")
    ap.add_argument("--watchers", type=int, default=1000)
    ap.add_argument("--chatters", type=int, default=5)
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--interval", type=float, default=0.5)
    ap.add_argument("--hls-pollers", type=int, default=20)
    ap.add_argument("--p95-ms", type=float, default=500)
    ap.add_argument("--insecure", action="store_true")
    sys.exit(asyncio.run(main(ap.parse_args())))
