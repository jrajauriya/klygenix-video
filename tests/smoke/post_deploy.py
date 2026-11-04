from __future__ import annotations

import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

import httpx

RESULTS: list[tuple[str, str, str]] = []
YEAR = 31536000


def record(status: str, name: str, detail: str = "") -> None:
    RESULTS.append((status, name, detail))
    print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""), flush=True)


def check(name: str, cond: bool, detail: str = "") -> bool:
    record("PASS" if cond else "FAIL", name, "" if cond else detail)
    return bool(cond)


def section(title: str) -> None:
    print(f"\n== {title}", flush=True)


def resolve_localhost() -> None:
    real = socket.getaddrinfo

    def patched(host, *args, **kwargs):
        if isinstance(host, str) and host.endswith(".localhost"):
            host = "127.0.0.1"
        return real(host, *args, **kwargs)

    socket.getaddrinfo = patched


def sibling(base: str, prefix: str) -> str:
    parts = urlsplit(base)
    return f"{parts.scheme}://{prefix}.{parts.netloc}"


def asset_urls(html: str) -> list[str]:
    return re.findall(r'(?:src|href)="(/[^"]*?assets/[^"]+?\.(?:js|css))"', html)


def header_once(r: httpx.Response, name: str) -> str | None:
    values = r.headers.get_list(name)
    return values[0] if len(values) == 1 else (None if not values else " | ".join(values))


def security_headers(label: str, r: httpx.Response, frame: str, csp_needs: list[str] | None = None) -> None:
    hsts = r.headers.get("strict-transport-security", "")
    check(f"{label}: HSTS", "max-age=" in hsts and int(re.search(r"max-age=(\d+)", hsts).group(1)) >= 15552000,
          f"got {hsts!r}")
    check(f"{label}: X-Content-Type-Options nosniff", r.headers.get("x-content-type-options") == "nosniff",
          f"got {r.headers.get('x-content-type-options')!r}")
    check(f"{label}: X-Frame-Options {frame}", header_once(r, "x-frame-options") == frame,
          f"got {header_once(r, 'x-frame-options')!r}")
    csp = header_once(r, "content-security-policy") or ""
    check(f"{label}: one Content-Security-Policy", bool(csp) and " | " not in csp,
          "missing" if not csp else "sent more than once")
    check(f"{label}: Referrer-Policy", bool(r.headers.get("referrer-policy")), "missing")
    for needle in csp_needs or []:
        check(f"{label}: CSP allows {needle}", needle in csp, f"CSP is {csp[:160]!r}...")


def long_cache(label: str, client: httpx.Client, url: str) -> None:
    r = client.get(url)
    cc = ", ".join(r.headers.get_list("cache-control"))
    ages = [int(a) for a in re.findall(r"max-age=(\d+)", cc)]
    check(f"{label}: {urlsplit(url).path} served", r.status_code == 200, f"HTTP {r.status_code}")
    check(f"{label}: long cache on assets", "immutable" in cc and any(a >= YEAR for a in ages), f"Cache-Control: {cc!r}")


def compressed(label: str, client: httpx.Client, url: str) -> None:
    with client.stream("GET", url, headers={"Accept-Encoding": "br, gzip"}) as r:
        enc = r.headers.get("content-encoding", "")
        vary = r.headers.get("vary", "")
    check(f"{label}: compressed (br/gzip)", enc in ("br", "gzip"), f"Content-Encoding {enc!r}")
    if enc:
        check(f"{label}: Vary: Accept-Encoding", "accept-encoding" in vary.lower(), f"Vary {vary!r}")


def spa(label: str, client: httpx.Client, origin: str, path: str, frame: str, csp_needs: list[str] | None = None) -> list[str]:
    r = client.get(origin + path)
    ok = check(f"{label}: {path} loads", r.status_code == 200 and "text/html" in r.headers.get("content-type", ""),
               f"HTTP {r.status_code} {r.headers.get('content-type')}")
    if not ok:
        return []
    check(f"{label}: app shell present", '<div id="root">' in r.text, "no #root in the page")
    security_headers(label, r, frame, csp_needs)
    assets = asset_urls(r.text)
    scripts = [a for a in assets if a.endswith(".js")]
    if not check(f"{label}: bundle referenced", bool(scripts), "no /assets/*.js in the page"):
        return []
    js = client.get(origin + scripts[0])
    check(f"{label}: bundle served as JavaScript", js.status_code == 200 and "javascript" in js.headers.get("content-type", ""),
          f"HTTP {js.status_code} {js.headers.get('content-type')}")
    long_cache(label, client, origin + scripts[0])
    compressed(label, client, origin + scripts[0])
    return assets


def run(args: argparse.Namespace) -> None:
    base = args.base.rstrip("/")
    api = (args.api or sibling(base, "api")).rstrip("/")
    studio = (args.studio or sibling(base, "studio")).rstrip("/")
    admin = (args.admin or sibling(base, "admin")).rstrip("/")
    verify: bool | str = False if args.insecure else (args.cacert or True)
    client = httpx.Client(verify=verify, timeout=args.timeout, follow_redirects=False)
    print(f"Smoke test: web {base} · api {api} · studio {studio} · admin {admin}")

    section("health")
    try:
        r = client.get(f"{api}/health")
    except httpx.HTTPError as exc:
        check("api reachable", False, str(exc))
        return
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    check("api /health 200", r.status_code == 200 and body.get("status") == "ok", f"HTTP {r.status_code} {r.text[:120]}")
    check("redis up", body.get("redis") == "up", f"redis {body.get('redis')!r}")
    security_headers("api", r, "DENY", ["default-src 'none'"])
    r = client.get(f"{base}/api/video/plans")
    check("web host proxies /api (plans)", r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) >= 3,
          f"HTTP {r.status_code} {r.text[:120]}")
    security_headers("web /api", r, "DENY")

    section("share previews (server-rendered head)")
    for label, url in ((f"api render /@{args.handle}", f"{api}/api/video/render?path=/@{args.handle}"),
                       ("web /", f"{base}/"), (f"web /@{args.handle}", f"{base}/@{args.handle}")):
        r = client.get(url)
        head = r.text.split("</head>", 1)[0] if r.status_code == 200 else ""
        check(f"{label}: 200 HTML", r.status_code == 200 and "text/html" in r.headers.get("content-type", ""),
              f"HTTP {r.status_code}")
        title = re.search(r"<title>([^<]+)</title>", head)
        check(f"{label}: <title>", bool(title), "no title in head")
        for tag in ("og:title", "og:description", "og:type"):
            check(f"{label}: {tag}", f'property="{tag}"' in head, "missing")
    r = client.get(f"{base}/")
    security_headers("web", r, "DENY", [api])
    web_assets = asset_urls(r.text)
    if check("web: bundle referenced", any(a.endswith(".js") for a in web_assets), "no /assets/*.js"):
        js = next(a for a in web_assets if a.endswith(".js"))
        long_cache("web", client, base + js)
        compressed("web", client, base + js)
    compressed("web HTML via render proxy", client, f"{base}/")
    r = client.head(f"{base}/")
    check("web answers HEAD (uptime monitors, crawlers)", r.status_code == 200, f"HTTP {r.status_code}")
    r = client.get(f"{base}/sw.js")
    check("web: the service worker is served, never cached", r.status_code == 200 and "javascript" in r.headers.get("content-type", "")
          and "no-cache" in r.headers.get("cache-control", ""), f"HTTP {r.status_code} {r.headers.get('content-type')}")
    r = client.get(f"{base}/manifest.webmanifest")
    check("web: the app manifest is served", r.status_code == 200 and "Klygenix" in r.text, f"HTTP {r.status_code}")
    r = client.get(f"{base}/reels")
    check("web: deep link /reels falls back to the app", r.status_code == 200 and '<div id="root">' in r.text, f"HTTP {r.status_code}")

    if args.http_base:
        section("plain http")
        r = client.get(args.http_base.rstrip("/") + "/")
        loc = r.headers.get("location", "")
        check("http redirects to https", r.status_code in (301, 308) and loc.startswith(base + "/"),
              f"HTTP {r.status_code} Location {loc!r}")

    section("metrics")
    r = client.get(f"{api}/metrics")
    check("/metrics refused without the token", r.status_code in (401, 403, 404), f"HTTP {r.status_code}")
    r = client.get(f"{api}/metrics", headers={"Authorization": "Bearer wrong-token"})
    check("/metrics refused with a wrong token", r.status_code in (401, 403, 404), f"HTTP {r.status_code}")
    if args.metrics_token:
        r = client.get(f"{api}/metrics", headers={"Authorization": f"Bearer {args.metrics_token}"})
        if r.status_code == 403:
            record("SKIP", "/metrics with the token", "nginx allows /metrics only from private ranges; scrape backend:9300")
        else:
            check("/metrics with the token", r.status_code == 200 and "kv_http_requests_total" in r.text, f"HTTP {r.status_code}")
    else:
        record("SKIP", "/metrics with the token", "no --metrics-token / KV_METRICS_TOKEN")

    section("CORS for the consoles")
    for label, origin in (("studio", studio), ("admin", admin), ("tv", sibling(base, "tv"))):
        r = client.options(f"{api}/api/auth/login", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                            "Access-Control-Request-Headers": "content-type"})
        check(f"{label} origin allowed by the API", r.headers.get("access-control-allow-origin") == origin,
              f"HTTP {r.status_code}, Access-Control-Allow-Origin {r.headers.get('access-control-allow-origin')!r}"
              " — add it to CORS_ORIGINS")

    section("studio and admin")
    spa("studio", client, studio, "/login", "DENY", [api])
    spa("admin", client, admin, "/login", "DENY", [api])
    spa("tv", client, sibling(base, "tv"), "/", "DENY", [api])

    section("sandbox journey")
    if args.skip_purchase:
        record("SKIP", "sandbox journey", "--skip-purchase")
        return
    journey(client, args, base, api)
    section("live journey (sandbox ingest)")
    if args.skip_live:
        record("SKIP", "live journey", "--skip-live")
    elif not shutil.which("ffmpeg"):
        record("SKIP", "live journey", "ffmpeg not installed here")
    else:
        live(client, args, base, api)


def _signup(client: httpx.Client, api: str, name: str, handle: str | None = None) -> dict | None:
    body = {"name": name, "email": f"smoke-{uuid.uuid4().hex[:10]}@example.com", "password": "Smoke@123456",
            "birth_date": "1990-01-01", "country": "IN", "language": "en"}
    if handle:
        body["handle"] = handle
    r = client.post(f"{api}/api/auth/signup", json=body)
    return {"Authorization": f"Bearer {r.json()['access_token']}"} if r.status_code == 201 else None


def live(client: httpx.Client, args: argparse.Namespace, base: str, api: str) -> None:
    auth = _signup(client, api, "Smoke Live Creator", f"smokelive-{uuid.uuid4().hex[:8]}")
    if not check("live creator sign-up", auth is not None):
        return
    r = client.post(f"{api}/api/video/studio/live", headers=auth, json={"title": "Smoke live", "replay_enabled": True})
    if not check("stream created", r.status_code == 201, f"HTTP {r.status_code} {r.text[:200]} (is the live feature on?)"):
        return
    s = r.json()
    pid, server, key = s["id"], s["ingest"]["server"], s["stream_key"]
    if args.rtmp_host:
        parts = urlsplit(server)
        server = parts._replace(netloc=f"{args.rtmp_host}:{parts.port}").geturl()
    encoder = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-re", "-stream_loop", "-1", "-i", args.fixture,
                                "-c:v", "libx264", "-preset", "veryfast", "-g", "30", "-c:a", "aac", "-f", "flv",
                                f"{server}/{key}"], stdin=subprocess.DEVNULL)
    try:
        d: dict = {}
        deadline = time.time() + args.paid_timeout
        while time.time() < deadline:
            d = client.get(f"{base}/api/video/live/{pid}").json()
            if d.get("status") == "live" and d.get("playback"):
                break
            time.sleep(1)
        if not check("encoder took the stream live (live worker running)", d.get("status") == "live",
                     f"status {d.get('status')!r} — is the live service up and {server} reachable?"):
            return
        m = client.get(d["playback"]["url"])
        check("live playlist served", m.status_code == 200 and "#EXTM3U" in m.text and "#EXT-X-ENDLIST" not in m.text,
              f"HTTP {m.status_code}")
        fan = _signup(client, api, "Smoke Live Fan")
        r = client.post(f"{api}/api/video/live/{pid}/chat", headers=fan or {}, json={"body": "Hello from the smoke test"})
        check("a viewer chats", r.status_code == 201, f"HTTP {r.status_code} {r.text[:160]}")
        hist = client.get(f"{api}/api/video/live/{pid}/chat").json()
        check("chat history has the message", any(x.get("body") == "Hello from the smoke test" for x in hist))
        r = client.post(f"{api}/api/video/studio/live/{pid}/end", headers=auth)
        check("creator ends the stream", r.status_code == 200, f"HTTP {r.status_code}")
    finally:
        encoder.terminate()
        try:
            encoder.wait(10)
        except subprocess.TimeoutExpired:
            encoder.kill()
    replay = None
    deadline = time.time() + args.paid_timeout * 3
    while time.time() < deadline:
        replay = client.get(f"{api}/api/video/live/{pid}").json().get("replay")
        if replay and replay.get("status") in ("published", "in_review", "blocked", "failed"):
            break
        time.sleep(2)
    check("the replay went through the pipeline", bool(replay) and replay.get("status") == "published", f"replay {replay!r}")


def journey(client: httpx.Client, args: argparse.Namespace, base: str, api: str) -> None:
    email = f"smoke-{uuid.uuid4().hex[:10]}@example.com"
    handle = f"smoke-{uuid.uuid4().hex[:8]}"
    r = client.post(f"{api}/api/auth/signup", json={"name": "Smoke Creator", "email": email, "password": "Smoke@123456",
                                                   "birth_date": "1990-01-01", "country": "IN", "language": "en",
                                                   "handle": handle})
    if not check("creator sign-up", r.status_code == 201 and "access_token" in r.text, f"HTTP {r.status_code} {r.text[:200]}"):
        return
    auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post(f"{api}/api/video/studio/videos", headers=auth,
                    json={"title": "Smoke test upload", "rights_declared": True, "visibility": "unlisted"})
    if not check("video created", r.status_code == 201, f"HTTP {r.status_code} {r.text[:200]}"):
        return
    d = r.json()
    video_id, public_id = d["video"]["id"], d["video"]["public_id"]
    try:
        with open(args.fixture, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        check("fixture readable", False, str(exc))
        return
    up = client.put(d["upload"]["url"], content=data, headers=d["upload"]["headers"], timeout=300)
    if not check("upload accepted", up.status_code == 200, f"HTTP {up.status_code} {up.text[:200]}"):
        return
    v: dict = {}
    deadline = time.time() + args.paid_timeout * 3
    while time.time() < deadline:
        v = client.get(f"{api}/api/video/studio/videos/{video_id}", headers=auth).json()
        if v.get("status") in ("published", "in_review", "blocked", "failed") and v.get("ai_status") in (
                "ready", "failed", "quota", "no_captions"):
            break
        time.sleep(1)
    if not check("encoded, scanned and published (workers ran)", v.get("status") == "published",
                 f"status {v.get('status')!r} ai {v.get('ai_status')!r} — are worker-ai and worker-render running?"):
        return
    check("AI pipeline finished", v.get("ai_status") in ("ready", "no_captions"), f"ai_status {v.get('ai_status')!r}")
    r = client.get(f"{base}/api/video/videos/{public_id}")
    pb = (r.json() or {}).get("playback") if r.status_code == 200 else None
    if check("watch page data on the web host", r.status_code == 200 and bool(pb), f"HTTP {r.status_code} {r.text[:160]}"):
        hls = pb.get("hls") or pb.get("url") or ""
        if hls:
            m = client.get(hls)
            check("HLS master playlist served", m.status_code == 200 and "#EXTM3U" in m.text, f"HTTP {m.status_code}")
    r = client.get(f"{base}/watch/{public_id}")
    check("share head carries the video title", r.status_code == 200 and "Smoke test upload" in r.text.split("</head>", 1)[0],
          f"HTTP {r.status_code}")

    r = client.post(f"{api}/api/video/checkout", headers=auth, json={"plan_key": "creator_pro"})
    if not check("checkout created (server-priced)", r.status_code == 201 and r.json().get("amount_minor", 0) > 0,
                 f"HTTP {r.status_code} {r.text[:200]}"):
        return
    chk = r.json()
    r = client.post(f"{api}/api/video/sandbox/pay/{chk['id']}", headers=auth)
    if not check("sandbox rail accepted the payment", r.status_code == 200, f"HTTP {r.status_code} {r.text[:200]} (is SANDBOX_ENABLED on?)"):
        return
    plan = ""
    deadline = time.time() + args.paid_timeout
    while time.time() < deadline:
        plan = client.get(f"{api}/api/video/me", headers=auth).json()["plans"]["creator"]["key"]
        if plan == "creator_pro":
            break
        time.sleep(0.5)
    check("Creator Pro granted by the payments worker", plan == "creator_pro", f"plan {plan!r} after {args.paid_timeout}s")
    r = client.get(f"{api}/api/video/me/invoices", headers=auth)
    check("invoice issued", r.status_code == 200 and len(r.json()) >= 1, f"HTTP {r.status_code} {r.text[:160]}")
    section("creator money (sandbox rail)")
    money(client, args, api, auth, video_id, public_id)
    client.delete(f"{api}/api/video/studio/videos/{video_id}", headers=auth)


def _paid(client: httpx.Client, api: str, auth: dict, checkout_id: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if client.get(f"{api}/api/video/checkout/{checkout_id}", headers=auth).json().get("status") == "paid":
            return True
        time.sleep(0.5)
    return False


def money(client: httpx.Client, args: argparse.Namespace, api: str, auth: dict, video_id: int, public_id: str) -> None:
    account = {"business_type": "individual", "legal_name": "Smoke Creator", "contact_name": "Smoke Creator",
               "email": "smoke.payouts@example.com", "phone": "9876543210", "pan": "ABCDE1234F",
               "address": {"street1": "1 Test Road", "city": "Bengaluru", "state": "Karnataka", "postal_code": "560001"},
               "beneficiary_name": "Smoke Creator", "ifsc": "HDFC0001234", "account_number": "123456789012"}
    client.put(f"{api}/api/video/studio/earnings/account", headers=auth, json=account)
    r = client.post(f"{api}/api/video/studio/earnings/account/submit", headers=auth)
    if not check("payout account activated (sandbox Route)", r.status_code == 200 and r.json()["account"]["status"] == "activated",
                 f"HTTP {r.status_code} {r.text[:160]}"):
        return
    r = client.post(f"{api}/api/auth/signup", json={"name": "Smoke Fan", "email": f"smoke-fan-{uuid.uuid4().hex[:10]}@example.com",
                                                   "password": "Smoke@123456", "birth_date": "1990-01-01", "country": "IN",
                                                   "language": "en"})
    fan = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post(f"{api}/api/video/support/checkout", headers=fan, json={"purpose": "tip", "amount_minor": 10000, "video_id": public_id,
                                                                         "message": "Smoke tip"})
    if not check("tip checkout created", r.status_code == 201, f"HTTP {r.status_code} {r.text[:160]}"):
        return
    tip = r.json()
    client.post(f"{api}/api/video/sandbox/pay/{tip['id']}", headers=fan)
    check("tip paid through the payments worker", _paid(client, api, fan, tip["id"], args.paid_timeout))
    sales: list = []
    deadline = time.time() + args.paid_timeout
    while time.time() < deadline and not sales:
        sales = client.get(f"{api}/api/video/studio/earnings/sales", headers=auth).json()
        time.sleep(0.5)
    check("the tip is split for the creator", bool(sales) and sales[0]["gross_minor"] == 10000 and sales[0]["net_minor"] > 0,
          str(sales[:1]))
    held: list = []
    deadline = time.time() + args.paid_timeout
    while time.time() < deadline and len(held) < 2:
        held = [t for t in client.get(f"{api}/api/video/studio/earnings/transfers", headers=auth).json() if t["status"] == "held"]
        time.sleep(0.5)
    check("Route transfers held for the refund window", len(held) == 2, str(held))
    r = client.get(f"{api}/api/video/studio/earnings/statement?format=csv", headers=auth)
    check("monthly statement downloads", r.status_code == 200 and r.text.startswith("paid_at"), f"HTTP {r.status_code}")
    r = client.post(f"{api}/api/video/studio/memberships/tiers", headers=auth, json={"name": "Smoke club", "rank": 1, "price_minor": 4900})
    if not check("membership tier created", r.status_code == 201, f"HTTP {r.status_code} {r.text[:160]}"):
        return
    tier = r.json()
    client.put(f"{api}/api/video/studio/videos/{video_id}/access", headers=auth, json={"access": "members", "members_rank": 1})
    d = client.get(f"{api}/api/video/videos/{public_id}", headers=fan).json()
    check("a members-only video is locked for a fan", (d.get("locked") or {}).get("access") == "members", str(d.get("locked"))[:160])
    r = client.post(f"{api}/api/video/support/checkout", headers=fan, json={"purpose": "membership", "tier_id": tier["id"]})
    client.post(f"{api}/api/video/sandbox/pay/{r.json()['id']}", headers=fan)
    _paid(client, api, fan, r.json()["id"], args.paid_timeout)
    d = client.get(f"{api}/api/video/videos/{public_id}", headers=fan).json()
    pb = d.get("playback") or {}
    check("joining opens the full stream", d.get("locked") is None and "hls-preview" not in (pb.get("url") or ""), str(d.get("locked"))[:160])
    client.put(f"{api}/api/video/studio/videos/{video_id}/access", headers=auth, json={"access": "free"})
    if not (args.admin_email and args.admin_password):
        record("SKIP", "refund unwinds the split", "no admin credentials given")
        return
    r = client.post(f"{api}/api/auth/login", json={"email": args.admin_email, "password": args.admin_password})
    if not check("admin sign-in", r.status_code == 200 and "access_token" in r.text, f"HTTP {r.status_code}"):
        return
    adm = {"Authorization": f"Bearer {r.json()['access_token']}"}
    pays = client.get(f"{api}/api/video/admin/payments?purpose=tip", headers=adm).json()
    pay = next((p for p in pays if p["checkout_id"] == tip["id"]), None)
    if not check("the tip payment is listed for the admin", pay is not None):
        return
    r = client.post(f"{api}/api/video/admin/payments/{pay['id']}/refund", headers=adm, json={"reason": "Smoke test refund"})
    check("admin refund processed", r.status_code == 201 and r.json()["payment"]["refundable_minor"] == 0, f"HTTP {r.status_code} {r.text[:160]}")
    tip_split = next((x["id"] for x in client.get(f"{api}/api/video/studio/earnings/sales?purpose=tip", headers=auth).json()), None)
    tr = [t for t in client.get(f"{api}/api/video/studio/earnings/transfers", headers=auth).json() if t["split_id"] == tip_split]
    check("the tip's held transfers are reversed", bool(tr) and all(t["status"] == "reversed" for t in tr), str(tr))
    section("run 4: ads, sponsorships, notices, beta, TV sign-in")
    run4(client, args, api, auth, adm)


BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"


def _upload(client: httpx.Client, api: str, auth: dict, path: str, title: str, visibility: str, timeout: float) -> dict | None:
    r = client.post(f"{api}/api/video/studio/videos", headers=auth, json={"title": title, "rights_declared": True, "visibility": visibility})
    if r.status_code != 201:
        return None
    d = r.json()
    with open(path, "rb") as fh:
        client.put(d["upload"]["url"], content=fh.read(), headers=d["upload"]["headers"], timeout=300)
    deadline = time.time() + timeout
    v: dict = {}
    while time.time() < deadline:
        v = client.get(f"{api}/api/video/studio/videos/{d['video']['id']}", headers=auth).json()
        if v.get("status") in ("published", "in_review", "blocked", "failed"):
            break
        time.sleep(1)
    return v if v.get("status") == "published" else None


def _outbox(client: httpx.Client, api: str, adm: dict, to: str, template: str, timeout: float) -> dict | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = client.get(f"{api}/api/video/admin/beta/outbox?to={to}&template={template}", headers=adm).json()
        if rows:
            return rows[0]
        time.sleep(0.5)
    return None


def run4(client: httpx.Client, args: argparse.Namespace, api: str, auth: dict, adm: dict) -> None:
    media = os.path.dirname(os.path.abspath(args.fixture))
    long_path = os.path.join(media, "azure-apim-auth.mp4")
    host = _upload(client, api, auth, long_path, "Smoke long video", "public", args.paid_timeout * 3)
    if not check("a long hosted video for ads", host is not None and host.get("kind") == "long", str(host)[:160]):
        return
    client.put(f"{api}/api/video/studio/ads/settings", headers=auth, json={"ads_enabled": True})
    brand = _signup(client, api, "Smoke Brand", f"smoke-brand-{uuid.uuid4().hex[:6]}")
    client.put(f"{api}/api/video/studio/brand", headers=brand, json={"name": "Smoke Brand Co", "contact_email": "brand@smoke.example"})
    creative = _upload(client, api, brand, args.fixture, "Smoke ad", "unlisted", args.paid_timeout * 3)
    if not check("ad creative published (unlisted)", creative is not None, "creative did not publish"):
        return
    r = client.post(f"{api}/api/video/studio/ads/campaigns", headers=brand, json={
        "name": "Smoke campaign", "creative_video_id": creative["public_id"], "click_url": "https://example.com/smoke",
        "cpm_minor": 1_000_000, "countries": []})
    if not check("campaign created", r.status_code == 201, f"HTTP {r.status_code} {r.text[:160]}"):
        return
    camp = r.json()
    client.post(f"{api}/api/video/studio/ads/campaigns/{camp['id']}/submit", headers=brand)
    r = client.post(f"{api}/api/video/admin/ads/campaigns/{camp['id']}/review", headers=adm, json={"decision": "approve"})
    check("admin approved the campaign", r.status_code == 200 and r.json()["status"] == "active", f"HTTP {r.status_code} {r.text[:120]}")
    r = client.post(f"{api}/api/video/studio/ads/campaigns/{camp['id']}/fund", headers=brand,
                    json={"amount_minor": 100000, "idempotency_key": uuid.uuid4().hex})
    chk = r.json()
    client.post(f"{api}/api/video/sandbox/pay/{chk['id']}", headers=brand)
    check("campaign funded through the payments worker (₹1,000 + GST)", _paid(client, api, brand, chk["id"], args.paid_timeout)
          and chk["amount_minor"] == 118000, str(chk)[:160])
    viewer = _signup(client, api, "Smoke Ad Viewer")
    ad = None
    deadline = time.time() + 30
    while time.time() < deadline and ad is None:
        ad = client.get(f"{api}/api/video/ads/decision?video={host['public_id']}",
                        headers={**viewer, "User-Agent": BROWSER_UA}).json().get("ad")
        if ad is None:
            time.sleep(2)
    if check("an ad is served on the long video", ad is not None and ad.get("label") == "Ad", "no ad (campaign cache refreshes every 15 s)"):
        client.post(f"{api}/api/video/ads/events", headers=viewer, json={"token": ad["token"], "event": "start"})
        time.sleep(2.2)
        client.post(f"{api}/api/video/ads/events", headers=viewer, json={"token": ad["token"], "event": "q0"})
        client.post(f"{api}/api/video/ads/events", headers=viewer, json={"token": ad["token"], "event": "click"})
        spent = 0
        deadline = time.time() + 150
        while time.time() < deadline and not spent:
            spent = client.get(f"{api}/api/video/studio/ads/campaigns/{camp['id']}", headers=brand).json().get("spent_minor", 0)
            if not spent:
                time.sleep(3)
        check("the scheduler flushed the impression into spend", spent == 1000, f"spent {spent}")
    r = client.post(f"{api}/api/video/studio/ads/campaigns/{camp['id']}/state", headers=brand, json={"action": "end"})
    check("ending refunds the unspent budget", r.status_code == 200 and r.json().get("refunded_now_minor", 0) > 0, r.text[:160])

    r = client.post(f"{api}/api/video/studio/sponsorships/briefs", headers=brand, json={
        "title": "Smoke sponsorship", "description": "A short integration for the smoke test journey.", "deliverable": "integration",
        "budget_min_minor": 100000, "budget_max_minor": 500000})
    if not check("brief posted", r.status_code == 201, f"HTTP {r.status_code} {r.text[:160]}"):
        return
    brief = r.json()
    r = client.post(f"{api}/api/video/studio/sponsorships/briefs/{brief['id']}/apply", headers=auth,
                    json={"pitch": "Smoke creator would love to feature this.", "quote_minor": 200000})
    check("creator applied", r.status_code == 201, f"HTTP {r.status_code} {r.text[:160]}")
    apps = client.get(f"{api}/api/video/studio/sponsorships/briefs/{brief['id']}/applications", headers=brand).json()
    deal = client.post(f"{api}/api/video/studio/sponsorships/applications/{apps[0]['id']}/accept", headers=brand,
                       json={"deliverables": "Thirty seconds on screen."}).json()
    r = client.post(f"{api}/api/video/studio/sponsorships/deals/{deal['id']}/fund", headers=brand, json={"idempotency_key": uuid.uuid4().hex})
    client.post(f"{api}/api/video/sandbox/pay/{r.json()['id']}", headers=brand)
    check("deal funded into escrow", _paid(client, api, brand, r.json()["id"], args.paid_timeout))
    r = client.post(f"{api}/api/video/studio/sponsorships/deals/{deal['id']}/deliver", headers=auth, json={"video_id": host["public_id"]})
    check("delivered", r.status_code == 200 and r.json()["status"] == "delivered", f"HTTP {r.status_code} {r.text[:160]}")
    label = client.get(f"{api}/api/video/videos/{host['public_id']}").json().get("paid_partnership") or {}
    check("watchers see “Paid partnership”", label.get("label") == "Paid partnership with Smoke Brand Co", str(label))
    r = client.post(f"{api}/api/video/studio/sponsorships/deals/{deal['id']}/approve", headers=brand)
    check("brand approved; the creator's transfer is released", r.status_code == 200 and r.json()["status"] == "approved", r.text[:160])

    r = client.post(f"{api}/api/video/takedowns", json={
        "kind": "copyright", "complainant_name": "Smoke Claimant", "complainant_email": "claimant@smoke.example",
        "target_url": f"https://play.klygenix.com/watch/{host['public_id']}", "details": "Smoke test copyright notice.", "sworn": True})
    ref = r.json().get("reference")
    check("the claimant is mailed a receipt", _outbox(client, api, adm, "claimant@smoke.example", "takedown_received", 15) is not None)
    td = next((t for t in client.get(f"{api}/api/video/admin/takedowns", headers=adm).json() if t["reference"] == ref), None)
    client.post(f"{api}/api/video/admin/takedowns/{td['id']}", headers=adm, json={"status": "actioned", "note": "smoke"})
    r = client.post(f"{api}/api/video/me/takedowns/{ref}/counter-notice", headers=auth, json={
        "full_name": "Smoke Creator", "address": "1 Test Road, Bengaluru 560001", "phone": "9876543210",
        "email": "smoke@example.com", "statement": "This is my own recording; the notice is mistaken.", "good_faith": True,
        "consent_jurisdiction": True, "signature": "Smoke Creator"})
    check("counter-notice filed with a restore date", r.status_code == 200 and r.json()["status"] == "countered"
          and bool(r.json().get("restore_due_at")), r.text[:160])

    wl = f"smoke-wait-{uuid.uuid4().hex[:8]}@example.com"
    client.post(f"{api}/api/video/waitlist", json={"email": wl, "name": "Smoke Wait", "role": "creator"})
    mail = _outbox(client, api, adm, wl, "waitlist_confirm", 15)
    if check("waitlist confirmation mailed", mail is not None):
        token = mail["body_text"].split("token=")[1].split()[0]
        r = client.post(f"{api}/api/video/waitlist/confirm", json={"token": token})
        check("waitlist confirmed", r.status_code == 200 and r.json()["status"] == "confirmed", r.text[:120])
    r = client.post(f"{api}/api/video/admin/beta/codes", headers=adm, json={"role": "creator"})
    code = r.json().get("code", "")
    check("invite code made and valid", client.post(f"{api}/api/video/invites/check", json={"code": code}).json()
          == {"valid": True, "role": "creator"})
    r = client.post(f"{api}/api/video/feedback", json={"kind": "bug", "body": "Smoke feedback", "app": "tv", "page": "/"})
    check("feedback accepted", r.status_code == 201, f"HTTP {r.status_code}")

    d = client.post(f"{api}/api/auth/device/start", json={"client": "tv"}).json()
    client.post(f"{api}/api/auth/device/approve", headers=viewer, json={"user_code": d["user_code"]})
    r = client.post(f"{api}/api/auth/device/poll", json={"device_code": d["device_code"]})
    check("TV signs in with a device code", r.status_code == 200 and "access_token" in r.text, f"HTTP {r.status_code} {r.text[:120]}")

    section("run 5: region, Hindi, ad integrity, downloads, inbox, view pool")
    r = client.get(f"{api}/api/auth/region")
    check("region discovery", r.status_code == 200 and r.json().get("region") in ("in", "us"), r.text[:120])
    r = client.get(f"{api}/api/video/videos/notavideo00", headers={"Accept-Language": "hi"})
    check("server messages in Hindi", r.status_code == 404 and any("\u0900" <= ch <= "\u097f" for ch in r.text), r.text[:120])
    bot = client.get(f"{api}/api/video/ads/decision?video={host['public_id']}",
                     headers={**viewer, "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)"}).json()
    check("declared bots get no ad", bot.get("ad") is None, str(bot)[:120])
    r = client.post(f"{api}/api/video/checkout", headers=viewer, json={"plan_key": "viewer_premium"})
    client.post(f"{api}/api/video/sandbox/pay/{r.json()['id']}", headers=viewer)
    _paid(client, api, viewer, r.json()["id"], args.paid_timeout)
    d = client.post(f"{api}/api/video/videos/{creative['public_id']}/download", headers=viewer)
    if check("Premium download link", d.status_code == 200 and bool(d.json().get("license")), f"HTTP {d.status_code} {d.text[:120]}"):
        f = client.get(d.json()["url"])
        check("the MP4 downloads", f.status_code == 200 and f.headers.get("content-type") == "video/mp4", f"HTTP {f.status_code}")
    inbox = client.get(f"{api}/api/video/me/inbox", headers=auth).json()
    check("the creator's inbox has the publish notice", any(n["kind"] == "published" for n in inbox.get("items", [])), str(inbox)[:160])
    month = time.strftime("%Y-%m")
    r = client.get(f"{api}/api/video/admin/ads/view-pool/preview?period={month}", headers=adm)
    check("view-pool preview for the month", r.status_code == 200 and "pool_minor" in r.json(), f"HTTP {r.status_code} {r.text[:120]}")
    r = client.get(f"{api}/api/video/search", params={"q": "स्मोक लॉन्ग वीडियो"})
    check("Hinglish search answers a Devanagari query", r.status_code == 200, f"HTTP {r.status_code}")
    run6(client, args, api, auth, adm)


def run6(client: httpx.Client, args: argparse.Namespace, api: str, auth: dict, adm: dict) -> None:
    section("run 6: channel teams, handle redirects, support desk")
    mine = client.get(f"{api}/api/video/me/channels", headers=auth).json()
    tid = mine[0]["tenant_id"] if mine else None
    email = f"smoke-{uuid.uuid4().hex[:10]}@example.com"
    r = client.post(f"{api}/api/auth/signup", json={"name": "Smoke Editor", "email": email, "password": "Smoke@123456",
                                                    "birth_date": "1990-01-01", "country": "IN", "language": "en"})
    if not check("an editor signs up", r.status_code == 201, f"HTTP {r.status_code}"):
        return
    ed = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post(f"{api}/api/video/studio/team/invites", headers=auth, json={"email": email, "role": "editor"})
    check("the creator invites an editor", r.status_code == 201, f"HTTP {r.status_code} {r.text[:120]}")
    mail = _outbox(client, api, adm, email, "team_invite", args.paid_timeout)
    found = re.search(r"token=([A-Za-z0-9_-]+)", (mail or {}).get("body_text", ""))
    token = found.group(1) if found else ""
    if check("the invitation mail is in the outbox", bool(token), str(mail)[:160]):
        r = client.post(f"{api}/api/video/team/accept", headers=ed, json={"token": token})
        check("the editor accepts", r.status_code == 200 and r.json().get("tenant_id") == tid, f"HTTP {r.status_code} {r.text[:120]}")
        acting = {**ed, "X-Kv-Tenant": str(tid)}
        me = client.get(f"{api}/api/video/studio/team/me", headers=acting).json()
        check("the editor acts in the creator's channel", me.get("role") == "editor" and me.get("tenant_id") == tid, str(me)[:160])
        r = client.get(f"{api}/api/video/studio/earnings", headers=acting)
        check("earnings stay owner-only", r.status_code == 403, f"HTTP {r.status_code}")
    old = client.get(f"{api}/api/video/studio/channel", headers=auth).json()["channel"]["handle"]
    new = f"smoke-moved-{uuid.uuid4().hex[:6]}"
    r = client.post(f"{api}/api/video/studio/channel/handle", headers=auth, json={"handle": new})
    check("the creator renames the handle", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")
    r = client.get(f"{api}/api/video/render", params={"path": f"/@{old}"}, follow_redirects=False)
    check("old channel links redirect", r.status_code == 301 and r.headers.get("location") == f"/@{new}", f"HTTP {r.status_code}")
    hits = client.get(f"{api}/api/video/admin/support/lookup", params={"q": email}, headers=adm).json()
    check("the support desk finds the editor", any(h.get("email") == email for h in hits), str(hits)[:160])


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Klygenix Play post-deploy smoke test. Exit 0 only when every check passed.",
        epilog="The journey (sign-up, upload, publish, sandbox purchase) needs the sandbox rail; production runs with --skip-purchase.")
    ap.add_argument("--base", required=True, help="web origin, e.g. https://play.klygenix.com")
    ap.add_argument("--api")
    ap.add_argument("--studio")
    ap.add_argument("--admin")
    ap.add_argument("--http-base", help="plain-http origin to check the https redirect, e.g. http://play.localhost:8080")
    ap.add_argument("--insecure", action="store_true", help="accept a self-signed certificate")
    ap.add_argument("--cacert")
    ap.add_argument("--handle", default="klygenix")
    ap.add_argument("--metrics-token", default=os.environ.get("KV_METRICS_TOKEN", ""))
    ap.add_argument("--fixture", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "media", "reel-chai.mp4"))
    ap.add_argument("--skip-purchase", action="store_true")
    ap.add_argument("--skip-live", action="store_true", help="skip the RTMP live journey (production uses Cloudflare)")
    ap.add_argument("--rtmp-host", help="host to publish RTMP to instead of the one the API returns, e.g. 127.0.0.1")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--paid-timeout", type=float, default=60.0)
    ap.add_argument("--admin-email", default=os.environ.get("KV_ADMIN_EMAIL", ""))
    ap.add_argument("--admin-password", default=os.environ.get("KV_ADMIN_PASSWORD", ""))
    args = ap.parse_args()
    if args.insecure:
        import warnings

        warnings.filterwarnings("ignore")
    resolve_localhost()
    started = time.time()
    try:
        run(args)
    except Exception as exc:
        record("FAIL", "smoke test crashed", f"{type(exc).__name__}: {exc}")
    passed = sum(1 for s, _, _ in RESULTS if s == "PASS")
    failed = [(n, d) for s, n, d in RESULTS if s == "FAIL"]
    skipped = sum(1 for s, _, _ in RESULTS if s == "SKIP")
    print(f"\n{passed} passed, {len(failed)} failed, {skipped} skipped in {time.time() - started:.1f}s")
    for name, detail in failed:
        print(f"  - {name}: {detail}")
    print("GREEN" if not failed else "RED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
