"""Live on Cloudflare Stream end to end against a fake Cloudflare: create, webhooks, playback, idle end, replay import."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from datetime import timedelta

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from fakehttp import configured, fake
from harness import check, creator, finish, ok, sql, wait_for

from app.main import app
from app.video.live import cf_events, service
from app.video.models.media import LiveStream, Video
from app.video.models.social import Channel
from app.video.sessions import platform_session

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "media", "reel-chai.mp4")
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
CF = dict(LIVE_PROVIDER="cloudflare", CF_ACCOUNT_ID="acc-e2e", CF_STREAM_TOKEN="cf-token", CF_NOTIFY_SECRET="notify-secret",
          CF_STREAM_CUSTOMER_HOST="customer-e2e.cloudflarestream.com", CF_STREAM_SIGNING_KEY_ID="kid-e2e",
          CF_STREAM_SIGNING_KEY=base64.b64encode(pem).decode(), CF_STREAM_WEBHOOK_SECRET="stream-secret", JOBS_MODE="sync")
uid = f"in-{os.urandom(4).hex()}"
rec = f"rec-{os.urandom(4).hex()}"
state = {"downloads": 0, "inputs": [], "deleted": []}


def cloudflare(req: httpx.Request) -> httpx.Response:
    p = req.url.path
    base = "/client/v4/accounts/acc-e2e/stream"
    if req.url.host == "customer-e2e.cloudflarestream.com" and p.endswith("/downloads/default.mp4"):
        return httpx.Response(200, content=open(FIX, "rb").read())
    if req.method == "POST" and p == f"{base}/live_inputs":
        n = len(state["inputs"])
        state["inputs"].append(json.loads(req.content))
        return httpx.Response(200, json={"success": True, "result": {"uid": uid if n == 0 else f"{uid}-{n}",
                                                                       "rtmps": {"url": "rtmps://live.cloudflare.com:443/live/",
                                                                                 "streamKey": f"cf-key-{n}"}}})
    if req.method == "DELETE" and p.startswith(f"{base}/live_inputs/"):
        state["deleted"].append(p.rsplit("/", 1)[1])
        return httpx.Response(200, json={"success": True, "result": None})
    if req.method == "POST" and p == f"{base}/{rec}/downloads":
        state["downloads"] += 1
        ready = state["downloads"] > 1
        return httpx.Response(200, json={"success": True, "result": {"default": {
            "status": "ready" if ready else "inprogress",
            "url": f"https://customer-e2e.cloudflarestream.com/{rec}/downloads/default.mp4"}}})
    return httpx.Response(404, json={"success": False, "errors": [{"message": "no such route"}]})


def notify(client: TestClient, event: str, secret: str = "notify-secret", input_id: str | None = None):
    payload = {"name": "Live Webhook", "text": event, "ts": time.time(),
               "data": {"notification_name": "Stream Live Input", "input_id": input_id or uid, "event_type": event,
                        "updated_at": f"{time.time():.6f}"}}
    return client.post("/api/video/webhooks/cloudflare-live", content=json.dumps(payload).encode(),
                       headers={"cf-webhook-auth": secret, "content-type": "application/json"})


def stream_hook(client: TestClient, payload: dict, secret: str = "stream-secret"):
    raw = json.dumps(payload).encode()
    now = int(time.time())
    sig = hmac.new(secret.encode(), f"{now}.".encode() + raw, hashlib.sha256).hexdigest()
    return client.post("/api/video/webhooks/cloudflare-live", content=raw,
                       headers={"webhook-signature": f"time={now},sig1={sig}", "content-type": "application/json"})


def load(sid: int) -> LiveStream:
    with platform_session() as db:
        s = db.get(LiveStream, sid)
        db.expunge(s)
        return s


c = creator("Cloudflare Live Creator")
me = c.get("/api/video/studio/channel").json()["channel"]
tc = TestClient(app, client=("127.0.0.1", 50000))

with configured(**CF), fake(cloudflare):
    print("\n== create on Cloudflare")
    with platform_session() as db:
        ch = db.get(Channel, me["id"])
        s = service.create(db, channel=ch, title="Morning chai live", replay_enabled=True)
        db.commit()
        sid = s.id
        check("provider and input id", (s.provider, s.provider_ref, s.ingest_port), ("cloudflare", uid, None))
        check("Cloudflare's key, sealed at rest", (service.key_of(s), s.stream_key.startswith("enc:") or s.stream_key != "cf-key-0"),
              ("cf-key-0", True))
        check("ingest is RTMPS to Cloudflare", service.ingest(s), {"protocol": "rtmps", "server": "rtmps://live.cloudflare.com:443/live/",
                                                                   "stream_key": "cf-key-0", "browser": False})
        check("recording on with signed URLs", state["inputs"][0]["recording"], {"mode": "automatic", "requireSignedURLs": True,
                                                                                 "timeoutSeconds": 60})
        check("no playback before live", service.playback(s), None)
    r = c.get(f"/api/video/studio/live/{s.public_id}")
    check("studio sees it", r.status_code, 200)

    print("\n== rotate key while scheduled")
    with platform_session() as db:
        s = db.get(LiveStream, sid)
        service.rotate_key(db, s)
        db.commit()
        check("a new input replaces the old one", (s.provider_ref, service.key_of(s)), (f"{uid}-1", "cf-key-1"))
        check("old input deleted at Cloudflare", state["deleted"], [uid])
        s.provider_ref = uid
        db.commit()

    print("\n== webhooks")
    r = notify(tc, "live_input.connected", secret="wrong")
    check("wrong notification secret refused", r.status_code, 400)
    check("refused body kept as evidence", sql("SELECT count(*) FROM kv_commerce.provider_events WHERE rail = 'cloudflare-live' "
                                                "AND signature_ok = false AND body LIKE :u", u=f"%{uid}%")[0][0] >= 1, True)
    r = notify(tc, "live_input.connected")
    check("connected accepted", r.status_code, 200)
    s = load(sid)
    check("stream is live", (s.status, s.started_at is not None, s.last_seen_at), ("live", True, None))
    d = tc.get(f"/api/video/live/{s.public_id}").json()
    url = (d.get("playback") or {}).get("url", "")
    ok("viewers get a signed Cloudflare manifest", url.startswith("https://customer-e2e.cloudflarestream.com/") and
       url.endswith("/manifest/video.m3u8") and url.count(".") >= 4, url)
    check("a replayed webhook is recorded once", notify(tc, "live_input.connected").status_code, 200)

    r = notify(tc, "live_input.disconnected")
    s = load(sid)
    check("disconnect starts the idle clock, still live", (s.status, s.last_seen_at is not None), ("live", True))
    notify(tc, "live_input.connected")
    check("reconnect clears it", load(sid).last_seen_at, None)
    notify(tc, "live_input.disconnected")
    with platform_session() as db:
        db.get(LiveStream, sid).last_seen_at = service.now() - timedelta(minutes=5)
        db.commit()
    cf_events.sweep()
    s = load(sid)
    check("idle past the limit ends the stream", (s.status, s.ended_at is not None), ("ended", True))

    print("\n== replay import")
    r = stream_hook(tc, {"uid": rec, "readyToStream": True, "liveInput": uid, "status": {"state": "ready"}}, secret="wrong")
    check("bad stream signature refused", r.status_code, 400)
    r = stream_hook(tc, {"uid": rec, "readyToStream": True, "liveInput": uid, "status": {"state": "ready"}, "duration": 12})
    check("recording ready accepted", r.status_code, 200)
    check("recording remembered", load(sid).replay_ref, rec)
    check("first pass waits for the MP4", cf_events.import_replay(sid), "waiting")
    check("second pass imports", cf_events.import_replay(sid), "imported")
    s = load(sid)
    ok("replay video linked", s.replay_video_id is not None and s.error is None, s.error)
    check("import is idempotent", cf_events.import_replay(sid), "skipped")

v = wait_for(lambda: (lambda row: row if row and row[0] in ("published", "in_review", "failed") else None)(
    sql("SELECT status, title FROM kv_media.videos WHERE id = :i", i=s.replay_video_id)[0] if s.replay_video_id else None), 240, 2)
check("replay went through the normal pipeline", (v[0] if v else None, v[1] if v else None), ("published", "Morning chai live (live replay)"))

print("\n== readiness")
from app.config import settings  # noqa: E402
from app.core.services import readiness  # noqa: E402

with configured(**{**CF, "CF_NOTIFY_SECRET": ""}):
    chk = next(x for x in readiness.evaluate(settings) if x.key == "live.provider")
    ok("readiness names the missing Cloudflare setting", not chk.ok and "CF_NOTIFY_SECRET" in chk.detail, chk.detail)
with configured(**CF):
    chk = next(x for x in readiness.evaluate(settings) if x.key == "live.provider")
    check("complete Cloudflare settings pass", chk.ok, True)

finish()
