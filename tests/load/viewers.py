from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
import time
from collections import defaultdict

import httpx
import websockets

DESCRIPTION = ("Viewer load test: virtual viewers open the home feed, the reels feed, a watch page, its danmaku "
               "bucket and comments, and report progress, while others hold WebSocket rooms open and receive "
               "live danmaku. Exits 1 when a threshold fails.")


def resolve_localhost() -> None:
    import socket

    real = socket.getaddrinfo

    def patched(host, *args, **kwargs):
        if isinstance(host, str) and host.endswith(".localhost"):
            host = "127.0.0.1"
        return real(host, *args, **kwargs)

    socket.getaddrinfo = patched


def ssl_context(insecure: bool):
    import ssl

    if not insecure:
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    return s[max(0, min(len(s) - 1, int(round(p / 100 * (len(s) - 1)))))]


class Stats:
    def __init__(self) -> None:
        self.times: dict[str, list[float]] = defaultdict(list)
        self.errors: dict[str, int] = defaultdict(int)
        self.samples: dict[str, str] = {}
        self.ws_open = 0
        self.ws_failed = 0
        self.ws_messages = 0

    def record(self, step: str, seconds: float, ok: bool, why: str = "") -> None:
        self.times[step].append(seconds * 1000)
        if not ok:
            self.errors[step] += 1
            self.samples.setdefault(step, why[:160])


async def timed(stats: Stats, step: str, call, expect=(200,)):
    started = time.perf_counter()
    try:
        r = await call
    except httpx.HTTPError as exc:
        stats.record(step, time.perf_counter() - started, False, f"{type(exc).__name__}: {exc}")
        return None
    ok = r.status_code in expect
    stats.record(step, time.perf_counter() - started, ok, f"{r.status_code} {r.text}")
    return r if ok else None


async def viewer(client: httpx.AsyncClient, videos: list[str], stats: Stats, stop_at: float) -> None:
    while time.monotonic() < stop_at:
        await timed(stats, "feed_home", client.get("/api/video/feed/home", params={"limit": 24}))
        await timed(stats, "feed_reels", client.get("/api/video/feed/reels", params={"limit": 10}))
        pid = random.choice(videos)
        await timed(stats, "watch", client.get(f"/api/video/videos/{pid}"))
        start = random.randint(0, 3) * 60000
        await timed(stats, "danmaku_bucket", client.get(f"/api/video/videos/{pid}/danmaku",
                                                          params={"from_ms": start, "to_ms": start + 60000}))
        await timed(stats, "comments", client.get(f"/api/video/videos/{pid}/comments", params={"limit": 20}))
        await timed(stats, "progress", client.post(f"/api/video/videos/{pid}/progress",
                                                   json={"position_ms": 5000, "watched_ms": 5000, "started": True}), expect=(200, 429))
        await asyncio.sleep(random.uniform(0.2, 1.0))


async def room(ws_base: str, pid: str, stats: Stats, stop_at: float, ssl_ctx=None) -> None:
    try:
        async with websockets.connect(f"{ws_base}/api/video/ws/videos/{pid}", open_timeout=10, ssl=ssl_ctx if ws_base.startswith("wss") else None) as ws:
            stats.ws_open += 1
            while time.monotonic() < stop_at:
                try:
                    await asyncio.wait_for(ws.recv(), timeout=max(0.1, min(5, stop_at - time.monotonic())))
                    stats.ws_messages += 1
                except asyncio.TimeoutError:
                    continue
    except Exception:
        stats.ws_failed += 1


async def poster(api: str, token: str, pid: str, stats: Stats, stop_at: float, verify=True) -> None:
    async with httpx.AsyncClient(base_url=api, headers={"Authorization": f"Bearer {token}"}, timeout=30, verify=verify) as c:
        n = 0
        while time.monotonic() < stop_at:
            n += 1
            await timed(stats, "danmaku_post", c.post(f"/api/video/videos/{pid}/danmaku",
                                                      json={"t_ms": 1000 + n * 50, "text": f"load line {n}"}), expect=(201, 429))
            await asyncio.sleep(2.5)


async def main(args) -> int:
    api = args.api.rstrip("/")
    verify = not args.insecure
    ssl_ctx = ssl_context(args.insecure)
    async with httpx.AsyncClient(base_url=api, timeout=30, verify=verify) as c:
        feed = (await c.get("/api/video/feed/home", params={"limit": 30})).json()
        reels = (await c.get("/api/video/feed/reels", params={"limit": 30})).json()
        videos = [v["id"] for v in feed + reels]
        if not videos:
            print("No published videos — run db-scripts/seed-demo.py first.")
            return 2
        login = await c.post("/api/auth/login", json={"email": args.email, "password": args.password})
        token = login.json().get("access_token") if login.status_code == 200 else None
    stats = Stats()
    stop_at = time.monotonic() + args.seconds
    limits = httpx.Limits(max_connections=args.users, max_keepalive_connections=args.users)
    ws_base = api.replace("https://", "wss://").replace("http://", "ws://")
    print(f"{args.users} viewers + {args.rooms} WebSocket watchers for {args.seconds}s against {api} ({len(videos)} videos)")
    started = time.perf_counter()
    async with httpx.AsyncClient(base_url=api, timeout=30, limits=limits, verify=verify) as client:
        tasks = [viewer(client, videos, stats, stop_at) for _ in range(args.users)]
        tasks += [room(ws_base, videos[i % len(videos)], stats, stop_at, ssl_ctx) for i in range(args.rooms)]
        if token:
            tasks.append(poster(api, token, videos[0], stats, stop_at, verify))
        await asyncio.gather(*tasks)
    elapsed = time.perf_counter() - started
    total = sum(len(v) for v in stats.times.values())
    errors = sum(stats.errors.values())
    print(f"\n{'step':16} {'n':>7} {'p50':>8} {'p95':>8} {'p99':>8} {'err':>6}")
    failed = []
    for step, values in sorted(stats.times.items()):
        p95 = pct(values, 95)
        print(f"{step:16} {len(values):7} {pct(values, 50):8.1f} {p95:8.1f} {pct(values, 99):8.1f} {stats.errors[step]:6}")
        if step not in ("danmaku_post",) and p95 > args.p95_ms:
            failed.append(f"{step} p95 {p95:.0f} ms > {args.p95_ms} ms")
    for step, why in stats.samples.items():
        print(f"  sample error in {step}: {why}")
    rate = errors / total if total else 1.0
    print(f"\n{total} requests in {elapsed:.1f}s = {total / elapsed:.0f} req/s; errors {errors} ({rate:.2%})")
    print(f"WebSockets: {stats.ws_open} opened, {stats.ws_failed} failed, {stats.ws_messages} live messages received")
    if rate > args.max_error_rate:
        failed.append(f"error rate {rate:.2%} > {args.max_error_rate:.2%}")
    if args.rooms and stats.ws_failed > args.rooms * 0.01:
        failed.append(f"{stats.ws_failed} WebSockets failed")
    if token and args.rooms and stats.ws_messages == 0:
        failed.append("no live danmaku reached any watcher")
    print(json.dumps({"requests": total, "rps": round(total / elapsed), "error_rate": rate, "failed": failed}))
    print("GREEN" if not failed else "RED: " + "; ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=DESCRIPTION)
    ap.add_argument("--api", default="http://localhost:9300")
    ap.add_argument("--users", type=int, default=200)
    ap.add_argument("--rooms", type=int, default=300)
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--p95-ms", type=float, default=300.0)
    ap.add_argument("--max-error-rate", type=float, default=0.01)
    ap.add_argument("--email", default="rohan@demo.klygenix.com")
    ap.add_argument("--password", default="Welcome@12345")
    ap.add_argument("--insecure", action="store_true")
    resolve_localhost()
    sys.exit(asyncio.run(main(ap.parse_args())))
