import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from redis import Redis
from rq import Queue

from harness import check, finish, login, ok, sql, uid, wait_for

sys.path.insert(0, str(Path(__file__).resolve().parent / "obs"))
from fake_sentry import serve  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
BIN = Path(sys.executable).parent
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:16383/0")

EMAIL = "ravi.buyer+obs@example.in"
PHONE = "+91 98765 43210"
PHONE_PLAIN = "9876543210"
PAN = "ABCPK1234Q"
GSTIN = "27ABCPK1234Q1Z5"
IFSC = "HDFC0001234"
ACCOUNT = "501002345678901"
JWT_LIKE = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvYnMifQ.c2lnbmF0dXJlLXZhbHVl"
SEALED = "enc:gAAAAABmObsSealedSecretValue_ZZ9-xx=="
QUERY_TOKEN = "qtok-" + uid() + "-secret"
COOKIE = "cookie-" + uid() + "-secret"
API_KEY = "kv_live_" + uid() + "obskey"
SIGNED = "https://files.example.com/d/abc?signature=sigvalue123&expires=99"
MARKER = "MARKER-BODY-" + uid()

SEEDED = [EMAIL, PHONE, PHONE_PLAIN, PAN, GSTIN, IFSC, ACCOUNT, JWT_LIKE, SEALED, QUERY_TOKEN, COOKIE, API_KEY,
          "sigvalue123", MARKER, "suite-owner@example.com"]
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<!\d)[6-9]\d{4}[\s\-]?\d{5}(?!\d)")
PAN_RE = re.compile(r"(?<![0-9A-Za-z])[A-Z]{5}\d{4}[A-Z](?![0-9A-Za-z])")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def detail() -> dict:
    return {"email": EMAIL, "phone": PHONE, "mobile_plain": PHONE_PLAIN, "pan": PAN, "gstin": GSTIN, "ifsc": IFSC,
            "account_number": ACCOUNT, "token": JWT_LIKE, "sealed": SEALED, "download": SIGNED,
            "nested": f"https%3A%2F%2Fx.example%2Fd%3Ftoken%3D{QUERY_TOKEN}%26email%3D{EMAIL.replace('@', '%40')}",
            "note": f"reach {EMAIL} on {PHONE_PLAIN}, pan {PAN}, gst {GSTIN}, bank {IFSC} {ACCOUNT}, {SEALED}"}


def start_api(port: int, dsn: str) -> subprocess.Popen:
    env = {**os.environ, "SENTRY_DSN": dsn, "SENTRY_ENVIRONMENT": "obs-test", "SENTRY_RELEASE": "klygenix-video@obs-test",
           "ERROR_TRACKING_DEBUG_ROUTES": "true", "SANDBOX_ENABLED": "true", "JOBS_MODE": "inline",
           "LOG_LEVEL": "WARNING"}
    proc = subprocess.Popen([str(BIN / "uvicorn"), "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                            cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            start_new_session=True)
    up = wait_for(lambda: _healthy(port), timeout=90, every=0.5)
    if not up:
        stop(proc)
        raise SystemExit(f"second API on :{port} did not start")
    return proc


def _healthy(port: int) -> bool:
    try:
        return httpx.get(f"http://127.0.0.1:{port}/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


def stop(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=20)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def run_rq_job(dsn: str, tenant_id: int) -> None:
    qname = "kv-obs-" + uid()
    redis = Redis.from_url(REDIS_URL)
    q = Queue(qname, connection=redis)
    q.enqueue("app.video.routers.debug.debug_fail", tenant_id, detail(), _request_id="rq-obs-" + uid())
    env = {**os.environ, "SENTRY_DSN": dsn, "SENTRY_ENVIRONMENT": "obs-test", "SENTRY_RELEASE": "klygenix-video@obs-test",
           "JOBS_MODE": "rq", "OBJC_DISABLE_INITIALIZE_FORK_SAFETY": "YES", "LOG_LEVEL": "WARNING"}
    subprocess.run([str(BIN / "rq"), "worker", "--burst", "--url", REDIS_URL, "-c", "app.video.jobs.rq_boot", qname],
                   cwd=BACKEND, env=env, capture_output=True, timeout=120)
    for reg in (q.failed_job_registry, q.finished_job_registry):
        for jid in reg.get_job_ids():
            reg.remove(jid, delete_job=True)
    q.delete(delete_jobs=True)


def envelope(dsn_value: str | None, *, attach: bool = True, pad: int = 0) -> bytes:
    event_id = uid().replace("-", "")[:32].ljust(32, "0")
    header = {"event_id": event_id, "sent_at": "2026-09-27T10:00:00.000Z",
              "sdk": {"name": "sentry.javascript.react", "version": "10.0.0", "packages": [{"name": EMAIL}]},
              "trace": {"trace_id": event_id, "public_key": "public", "user_segment": EMAIL}}
    if dsn_value is not None:
        header["dsn"] = dsn_value
    event = {"event_id": event_id, "platform": "javascript", "level": "error",
             "tags": {"app": "storefront", "via": "tunnel"},
             "message": f"checkout failed for {EMAIL} {PHONE} pan {PAN} {JWT_LIKE}",
             "exception": {"values": [{"type": "TypeError", "value": f"cannot read {GSTIN} {IFSC} {ACCOUNT} {SEALED}"}]},
             "request": {"url": f"https://store.example/checkout?token={QUERY_TOKEN}&page=2",
                         "headers": {"User-Agent": "Mozilla/5.0", "Cookie": f"kv_session={COOKIE}",
                                     "Referer": SIGNED, "X-Api-Key": API_KEY}},
             "user": {"email": EMAIL, "ip_address": "203.0.113.9"},
             "breadcrumbs": {"values": [{"category": "fetch", "data": {"url": SIGNED}},
                                        {"category": "ui.input", "message": MARKER},
                                        {"category": "console", "message": f"typed {EMAIL}"}]},
             "extra": {"buyer": detail(), "pad": "x" * pad}}
    body = json.dumps(event).encode()
    parts = [json.dumps(header).encode(), json.dumps({"type": "event", "length": len(body)}).encode(), body]
    if attach:
        blob = f"attachment {MARKER} {EMAIL}".encode()
        parts += [json.dumps({"type": "attachment", "length": len(blob), "filename": "a.txt"}).encode(), blob,
                  json.dumps({"type": "replay_recording"}).encode(), json.dumps({"m": MARKER}).encode()]
    return b"\n".join(parts) + b"\n"


def tunnel(port: int, body: bytes, **headers) -> httpx.Response:
    return httpx.post(f"http://127.0.0.1:{port}/api/observe/tunnel", content=body, timeout=30,
                      headers={"Content-Type": "text/plain;charset=UTF-8", "Cookie": f"kv_session={COOKIE}",
                               "X-Forwarded-For": "203.0.113.9", **headers})


def trigger(client: httpx.Client, rid: str) -> dict:
    out = {}
    r = client.post("/api/_debug/boom", params={"token": QUERY_TOKEN, "email": EMAIL, "page": "2"},
                    headers={"Cookie": f"kv_session={COOKIE}", "X-Request-Id": rid}, json=detail())
    out["boom"] = r.status_code
    r = httpx.post(f"{client.base_url}/api/_debug/checkout/boom", json={"name": MARKER, "email": EMAIL},
                   headers={"X-Api-Key": API_KEY, "Cookie": f"kv_session={COOKIE}"}, timeout=30)
    out["checkout"] = r.status_code
    r = client.post("/api/_debug/boom-job", json=detail())
    out["job"] = r.status_code
    return out


def events(records: list) -> list[dict]:
    return [i["payload"] for rec in records for i in rec["items"] if i["header"].get("type") == "event"]


def by_tag(evts: list[dict], key: str, value: str) -> list[dict]:
    return [e for e in evts if (e.get("tags") or {}).get(key) == value]


def tags_of(e: dict) -> dict:
    t = e.get("tags") or {}
    return dict(t) if isinstance(t, dict) else {k: v for k, v in t}


work = Path(tempfile.mkdtemp(prefix="kv-obs-"))
sink_port, api_port = free_port(), free_port()
sink_file = work / "events.json"
sink = serve(sink_port, sink_file)
dsn = f"http://public@127.0.0.1:{sink_port}/1"

from harness import ADMIN_EMAIL, ADMIN_PASSWORD  # noqa: E402

studio = login(ADMIN_EMAIL, ADMIN_PASSWORD)
tenant_id = sql("select id from kv_admin.tenants where slug = :s", s="klygenix-video-admin")[0][0]
token = studio.headers["Authorization"]

print("\n== with a DSN: events arrive, scrubbed")
proc = start_api(api_port, dsn)
try:
    client = httpx.Client(base_url=f"http://127.0.0.1:{api_port}", timeout=30, headers={"Authorization": token})
    rid = "obs-" + uid()
    codes = trigger(client, rid)
    check("deliberate route answers 500", codes["boom"], 500)
    check("deliberate checkout route answers 500", codes["checkout"], 500)
    check("failing job is queued", codes["job"], 202)
    wait_for(lambda: len(by_tag(events(json.loads(sink_file.read_text())), "job", "debug_fail")) >= 1
             and len(events(json.loads(sink_file.read_text()))) >= 3, timeout=30)

    print("\n== the browser tunnel: envelopes forwarded scrubbed, only for our own project")
    before = len(json.loads(sink_file.read_text()))
    r = tunnel(api_port, envelope(dsn))
    check("tunnel forwards our own project", r.status_code, 200)
    wait_for(lambda: len(json.loads(sink_file.read_text())) > before, timeout=15)
    arrived = json.loads(sink_file.read_text())[before:]
    check("one envelope arrived", len(arrived), 1)
    if arrived:
        rec = arrived[0]
        check("posted to the project's envelope endpoint", (rec["project"], rec["path"]), ("1", "/api/1/envelope/"))
        check("only the event item forwarded", [i["header"].get("type") for i in rec["items"]], ["event"])
        ev = rec["items"][0]["payload"] if rec["items"] else {}
        check("tunnel event kept its tags", ((ev.get("tags") or {}).get("app"), (ev.get("tags") or {}).get("via")),
              ("storefront", "tunnel"))
        ok("tunnel event has no user", "user" not in ev)
        th = {k.lower() for k in ((ev.get("request") or {}).get("headers") or {})}
        ok("tunnel event lost Cookie, Referer, X-Api-Key", not th & {"cookie", "referer", "x-api-key"}, str(th))
        ok("tunnel event lost ui.input crumbs", MARKER not in json.dumps(ev))
        ok("tunnel envelope header is the dsn and ids only", set(rec["header"]) <= {"event_id", "sent_at", "sdk", "dsn", "trace"},
           str(sorted(rec["header"])))
        ok("tunnel envelope header lost the trace user segment", "user_segment" not in json.dumps(rec["header"]))
        fwd = {k.lower() for k in rec.get("request_headers", {})}
        ok("no browser cookie or address forwarded upstream", not fwd & {"cookie", "x-forwarded-for", "x-real-ip"}, str(fwd))
        ok("tunnel envelope carries no seeded value", not [v for v in SEEDED if v in json.dumps(rec)],
           str([v for v in SEEDED if v in json.dumps(rec)][:3]))
    before = len(json.loads(sink_file.read_text()))
    wrong_key = dsn.replace("public@", "someoneelse@")
    wrong_project = dsn.rsplit("/", 1)[0] + "/2"
    elsewhere = f"http://public@127.0.0.2:{sink_port}/1"
    check("another key refused", tunnel(api_port, envelope(wrong_key)).status_code, 403)
    check("another project refused", tunnel(api_port, envelope(wrong_project)).status_code, 403)
    check("another host refused", tunnel(api_port, envelope(elsewhere)).status_code, 403)
    check("no dsn in the header refused", tunnel(api_port, envelope(None)).status_code, 403)
    check("garbage refused", tunnel(api_port, b"not an envelope\n{").status_code, 400)
    check("oversized refused", tunnel(api_port, envelope(dsn, pad=260 * 1024)).status_code, 413)
    import gzip as _gzip
    bomb = _gzip.compress(envelope(dsn, pad=4 * 1024 * 1024))
    check("gzip that expands past the cap refused", tunnel(api_port, bomb, **{"Content-Encoding": "gzip"}).status_code, 413)
    time.sleep(1)
    check("nothing refused reached the ingest", len(json.loads(sink_file.read_text())), before)
finally:
    stop(proc)

run_rq_job(dsn, tenant_id)
wait_for(lambda: any(tags_of(e).get("component") == "worker" and tags_of(e).get("job") == "debug_fail"
                     for e in events(json.loads(sink_file.read_text()))), timeout=20)

records = json.loads(sink_file.read_text())
evts = events(records)
ok("events received", len(evts) >= 4, f"{len(evts)} events")
boom = [e for e in evts if (e.get("request") or {}).get("url", "").endswith("/api/_debug/boom")]
ok("route error captured", bool(boom))
if boom:
    e = boom[0]
    t = tags_of(e)
    check("tenant tag", t.get("tenant_id"), str(tenant_id))
    check("route tag is the template", t.get("route"), "/api/_debug/boom")
    check("request id tag", t.get("request_id"), rid)
    check("component tag", t.get("component"), "api")
    check("environment", e.get("environment"), "obs-test")
    check("release", e.get("release"), "klygenix-video@obs-test")
    headers = {k.lower(): v for k, v in ((e.get("request") or {}).get("headers") or {}).items()}
    ok("no Authorization header", "authorization" not in headers)
    ok("no Cookie header", "cookie" not in headers)
    ok("no cookies", "cookies" not in (e.get("request") or {}))
    ok("no user", "user" not in e)
    qs = (e.get("request") or {}).get("query_string") or ""
    ok("token query param filtered", "token=%5BFiltered%5D" in qs or "token=[Filtered]" in qs, qs)
    ok("page query param kept", "page=2" in qs, qs)
    ok("exception type kept", any(v.get("type") == "RuntimeError" for v in (e.get("exception") or {}).get("values", [])))
checkout = [e for e in evts if (e.get("request") or {}).get("url", "").endswith("/api/_debug/checkout/boom")]
ok("checkout error captured", bool(checkout))
if checkout:
    ok("checkout request body dropped", "data" not in (checkout[0].get("request") or {}))
    ok("no tenant tag leaks onto an anonymous request", "tenant_id" not in tags_of(checkout[0]))
    ch = {k.lower() for k in ((checkout[0].get("request") or {}).get("headers") or {})}
    ok("no X-Api-Key header", "x-api-key" not in ch)
    ok("no Cookie header on checkout", "cookie" not in ch)
inline = [e for e in evts if tags_of(e).get("job") == "debug_fail" and tags_of(e).get("component") == "api"]
ok("inline job failure captured", bool(inline))
if inline:
    check("inline job tenant tag", tags_of(inline[0]).get("tenant_id"), str(tenant_id))
worker = [e for e in evts if tags_of(e).get("job") == "debug_fail" and tags_of(e).get("component") == "worker"]
ok("rq worker job failure captured", bool(worker))
if worker:
    check("worker job tenant tag", tags_of(worker[0]).get("tenant_id"), str(tenant_id))
    ok("worker request id tag", str(tags_of(worker[0]).get("request_id", "")).startswith("rq-obs-"))

blob = json.dumps([{"header": r["header"], "items": r["items"]} for r in records])
for value in SEEDED:
    ok(f"absent: {value[:18]}…", value not in blob)
ok("no email address anywhere", not EMAIL_RE.findall(blob), str(EMAIL_RE.findall(blob)[:3]))
def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield str(k)
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


# numeric fields such as thread ids can look like phone numbers; personal data arrives as text
text_blob = "\n".join(_strings([{"header": r["header"], "items": r["items"]} for r in records]))
HEX_ID = re.compile(r"(?<![0-9a-zA-Z])[0-9a-f]{16,}(?![0-9a-zA-Z])")
phones = PHONE_RE.findall(HEX_ID.sub(" ", text_blob))
ok("no Indian phone number anywhere", not phones,
   str([(p, text_blob[max(0, text_blob.find(p) - 40):text_blob.find(p) + 20]) for p in phones[:2]]))
ok("no PAN anywhere", not PAN_RE.findall(blob), str(PAN_RE.findall(blob)[:3]))
ok("no bearer token anywhere", token.split()[-1] not in blob and "eyJ" not in blob)
ok("no sealed value anywhere", not re.search(r"enc:(?!\[sealed\])", blob))
ok("breadcrumb seeded and scrubbed", "debug breadcrumb for [email]" in blob)

print("\n== without a DSN: nothing is sent")
(work / "events-with-dsn.json").write_text(sink_file.read_text())
print(f"  (captured envelopes kept in {work / 'events-with-dsn.json'})")
sink_file.write_text("[]")
sink.shutdown()
sink.server_close()
sink = serve(sink_port, sink_file)
proc = start_api(api_port, "")
try:
    client = httpx.Client(base_url=f"http://127.0.0.1:{api_port}", timeout=30, headers={"Authorization": token})
    codes = trigger(client, "obs-" + uid())
    check("deliberate route still 500 with no DSN", codes["boom"], 500)
    check("tunnel is 404 with no DSN", tunnel(api_port, envelope(dsn)).status_code, 404)
    time.sleep(4)
finally:
    stop(proc)
run_rq_job("", tenant_id)
time.sleep(1)
check("sink received nothing", len(json.loads(sink_file.read_text())), 0)
sink.shutdown()

finish()
