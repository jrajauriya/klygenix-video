from __future__ import annotations

import argparse
import os
import re
import socket
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
    for label, origin in (("studio", studio), ("admin", admin)):
        r = client.options(f"{api}/api/auth/login", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                            "Access-Control-Request-Headers": "content-type"})
        check(f"{label} origin allowed by the API", r.headers.get("access-control-allow-origin") == origin,
              f"HTTP {r.status_code}, Access-Control-Allow-Origin {r.headers.get('access-control-allow-origin')!r}"
              " — add it to CORS_ORIGINS")

    section("studio and admin")
    spa("studio", client, studio, "/login", "DENY", [api])
    spa("admin", client, admin, "/login", "DENY", [api])

    section("sandbox journey")
    if args.skip_purchase:
        record("SKIP", "sandbox journey", "--skip-purchase")
        return
    journey(client, args, base, api)


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
    client.delete(f"{api}/api/video/studio/videos/{video_id}", headers=auth)


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
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--paid-timeout", type=float, default=60.0)
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
