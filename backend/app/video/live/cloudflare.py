from __future__ import annotations

import httpx

from app.config import settings

API = "https://api.cloudflare.com/client/v4"


class CloudflareLiveError(Exception):
    pass


def _call(method: str, path: str, **kw) -> dict:
    if not (settings.CF_ACCOUNT_ID and settings.CF_STREAM_TOKEN):
        raise CloudflareLiveError("Cloudflare Stream is not configured.")
    r = httpx.request(method, f"{API}/accounts/{settings.CF_ACCOUNT_ID}/stream{path}",
                      headers={"Authorization": f"Bearer {settings.CF_STREAM_TOKEN}"}, timeout=20, **kw)
    body = r.json() if r.content else {}
    if r.status_code >= 400 or not body.get("success", False):
        raise CloudflareLiveError(f"Cloudflare refused: {(body.get('errors') or [{}])[0].get('message', r.status_code)}")
    return body["result"]


def create_input(title: str, record: bool) -> dict:
    res = _call("POST", "/live_inputs", json={"meta": {"name": title[:100]},
                                              "recording": {"mode": "automatic" if record else "off",
                                                            "requireSignedURLs": True}})
    return {"uid": res["uid"], "rtmps_url": res["rtmps"]["url"], "stream_key": res["rtmps"]["streamKey"]}


def playback_url(uid: str) -> str:
    return f"https://{settings.CF_STREAM_CUSTOMER_HOST}/{uid}/manifest/video.m3u8"


def delete_input(uid: str) -> None:
    _call("DELETE", f"/live_inputs/{uid}")


def recordings(uid: str) -> list[dict]:
    return _call("GET", f"/live_inputs/{uid}/videos")
