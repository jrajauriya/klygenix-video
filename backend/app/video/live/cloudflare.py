from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import httpx

from app.config import settings

API = "https://api.cloudflare.com/client/v4"
RTMPS = "rtmps://live.cloudflare.com:443/live/"
TIMEOUT = httpx.Timeout(20.0, connect=5.0)


class CloudflareLiveError(Exception):
    pass


def configured() -> bool:
    return bool(settings.CF_ACCOUNT_ID and settings.CF_STREAM_TOKEN and settings.CF_STREAM_CUSTOMER_HOST)


def _call(method: str, path: str, **kw) -> dict | list:
    from app.core.breaker import guard

    if not (settings.CF_ACCOUNT_ID and settings.CF_STREAM_TOKEN):
        raise CloudflareLiveError("Cloudflare Stream is not configured.")
    try:
        with guard("cloudflare-stream", settings.CF_ACCOUNT_ID):
            r = httpx.request(method, f"{API}/accounts/{settings.CF_ACCOUNT_ID}/stream{path}",
                              headers={"Authorization": f"Bearer {settings.CF_STREAM_TOKEN}"},
                              timeout=TIMEOUT, **kw)
    except httpx.HTTPError as exc:
        raise CloudflareLiveError(f"Cloudflare could not be reached: {type(exc).__name__}") from exc
    try:
        body = r.json() if r.content else {}
    except ValueError:
        body = {}
    if r.status_code >= 400 or not body.get("success", False):
        raise CloudflareLiveError(f"Cloudflare refused: {(body.get('errors') or [{}])[0].get('message', r.status_code)}")
    return body.get("result")


def create_input(title: str, record: bool) -> dict:
    res = _call("POST", "/live_inputs", json={"meta": {"name": title[:100]}, "deleteRecordingAfterDays": 30,
                                              "recording": {"mode": "automatic" if record else "off",
                                                            "requireSignedURLs": True, "timeoutSeconds": 60}})
    return {"uid": res["uid"], "rtmps_url": res["rtmps"]["url"], "stream_key": res["rtmps"]["streamKey"]}


def delete_input(uid: str) -> None:
    _call("DELETE", f"/live_inputs/{uid}")


def recordings(uid: str) -> list[dict]:
    return _call("GET", f"/live_inputs/{uid}/videos") or []


def download(video_uid: str) -> tuple[str, str | None]:
    res = _call("POST", f"/{video_uid}/downloads")
    d = (res or {}).get("default") or {}
    return d.get("status", "inprogress"), d.get("url") if d.get("status") == "ready" else None


def delete_video(video_uid: str) -> None:
    _call("DELETE", f"/{video_uid}")


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def token(uid: str, ttl: int) -> str:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    if not (settings.CF_STREAM_SIGNING_KEY_ID and settings.CF_STREAM_SIGNING_KEY):
        raise CloudflareLiveError("The Stream signing key is not configured.")
    kid = settings.CF_STREAM_SIGNING_KEY_ID
    pem = base64.b64decode(settings.CF_STREAM_SIGNING_KEY)
    key = serialization.load_pem_private_key(pem, password=None)
    head = _b64(json.dumps({"alg": "RS256", "kid": kid}, separators=(",", ":")).encode())
    body = _b64(json.dumps({"sub": uid, "kid": kid, "exp": int(time.time()) + ttl}, separators=(",", ":")).encode())
    sig = key.sign(f"{head}.{body}".encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{head}.{body}.{_b64(sig)}"


def playback_url(uid: str, ttl: int = 4 * 3600) -> str:
    return f"https://{settings.CF_STREAM_CUSTOMER_HOST}/{token(uid, ttl)}/manifest/video.m3u8"


def verify_notification(headers: dict) -> bool:
    secret = settings.CF_NOTIFY_SECRET
    got = headers.get("cf-webhook-auth") or ""
    return bool(secret) and hmac.compare_digest(hashlib.sha256(got.encode()).digest(), hashlib.sha256(secret.encode()).digest())


def verify_stream_webhook(body: bytes, header: str | None, now: float | None = None, tolerance: int = 300) -> bool:
    secret = settings.CF_STREAM_WEBHOOK_SECRET
    if not secret or not header:
        return False
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    ts, sig = parts.get("time", ""), parts.get("sig1", "")
    if not ts.isdigit() or abs((now or time.time()) - int(ts)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)
