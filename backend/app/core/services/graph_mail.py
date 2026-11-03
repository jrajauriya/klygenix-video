from __future__ import annotations

import base64
import threading
import time
from urllib.parse import quote

import httpx

from app.config import settings
from app.core import breaker

INLINE_LIMIT = 3 * 1024 * 1024
CHUNK = 320 * 1024 * 12
SPACING = 2.0
SCOPE = "https://graph.microsoft.com/.default"

_lock = threading.Lock()
_pace_lock = threading.Lock()
_token: dict = {"value": None, "expires": 0.0}
_last_send = [0.0]


class GraphAnswer(RuntimeError):
    pass


def _http() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(30.0, connect=5.0))


def configured() -> bool:
    return bool(settings.MS_GRAPH_TENANT_ID and settings.MS_GRAPH_CLIENT_ID and settings.MS_GRAPH_CLIENT_SECRET)


def sender() -> str:
    return settings.MS_GRAPH_SENDER or settings.SMTP_FROM_EMAIL


def _error(resp: httpx.Response) -> str:
    try:
        data = resp.json()
    except ValueError:
        return f"HTTP {resp.status_code}"
    err = data.get("error")
    if isinstance(err, dict):
        return f"{err.get('code', resp.status_code)}: {err.get('message', '')}"[:300]
    return (data.get("error_description") or str(err or resp.status_code)).split("\r\n")[0][:300]


def _access_token(client: httpx.Client, fresh: bool = False) -> str:
    with _lock:
        if not fresh and _token["value"] and time.time() < _token["expires"] - 60:
            return _token["value"]
        resp = client.post(f"{settings.MS_GRAPH_LOGIN_BASE}/{settings.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token", data={
            "grant_type": "client_credentials", "client_id": settings.MS_GRAPH_CLIENT_ID,
            "client_secret": settings.MS_GRAPH_CLIENT_SECRET, "scope": SCOPE,
        })
        data = resp.json() if resp.status_code == 200 else {}
        if "access_token" not in data:
            raise GraphAnswer(f"Microsoft sign-in for the mail app failed — {_error(resp)}")
        _token.update(value=data["access_token"], expires=time.time() + int(data.get("expires_in", 3600)))
        return _token["value"]


def _call(client: httpx.Client, method: str, path: str, json: dict | None = None) -> httpx.Response:
    url = f"{settings.MS_GRAPH_API_BASE}{path}"
    resp = client.request(method, url, json=json, headers={"Authorization": f"Bearer {_access_token(client)}"})
    if resp.status_code == 401:
        resp = client.request(method, url, json=json, headers={"Authorization": f"Bearer {_access_token(client, fresh=True)}"})
    if resp.status_code in (429, 503):
        raise RuntimeError(f"Microsoft asked to slow down (HTTP {resp.status_code}, retry after "
                           f"{resp.headers.get('Retry-After', '?')}s)")
    if 400 <= resp.status_code < 500:
        raise GraphAnswer(f"Microsoft refused the email — {_error(resp)}")
    resp.raise_for_status()
    return resp


def _address(email: str, name: str | None = None) -> dict:
    return {"emailAddress": {"address": email, **({"name": name} if name else {})}}


def _content_type(filename: str) -> str:
    return "application/pdf" if filename.lower().endswith(".pdf") else "application/octet-stream"


def _pace() -> None:
    with _pace_lock:
        wait = _last_send[0] + SPACING - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_send[0] = time.monotonic()


def _upload(client: httpx.Client, box: str, message_id: str, name: str, data: bytes) -> None:
    session = _call(client, "POST", f"/users/{box}/messages/{message_id}/attachments/createUploadSession", {
        "AttachmentItem": {"attachmentType": "file", "name": name, "size": len(data), "contentType": _content_type(name)},
    }).json()
    for start in range(0, len(data), CHUNK):
        part = data[start:start + CHUNK]
        resp = client.put(session["uploadUrl"], content=part, headers={
            "Content-Type": "application/octet-stream", "Content-Length": str(len(part)),
            "Content-Range": f"bytes {start}-{start + len(part) - 1}/{len(data)}",
        })
        if resp.status_code >= 400:
            raise GraphAnswer(f"Microsoft refused the attachment {name} — {_error(resp)}")


def send(to: str, cc: list[str], subject: str, html: str, attachments: list[tuple[str, bytes]],
         reply_to: str | None, from_name: str | None) -> None:
    box = quote(sender(), safe="@")
    message = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": html},
        "from": _address(sender(), from_name),
        "toRecipients": [_address(to)],
        "ccRecipients": [_address(c) for c in cc],
        **({"replyTo": [_address(reply_to)]} if reply_to else {}),
    }
    inline = sum(len(d) for _, d in attachments) <= INLINE_LIMIT
    _pace()
    with breaker.guard("graph", "graph.microsoft.com", answers=(GraphAnswer,)), _http() as client:
        if inline:
            if attachments:
                message["attachments"] = [{"@odata.type": "#microsoft.graph.fileAttachment", "name": n,
                                           "contentType": _content_type(n), "contentBytes": base64.b64encode(d).decode()}
                                          for n, d in attachments]
            _call(client, "POST", f"/users/{box}/sendMail", {"message": message, "saveToSentItems": False})
            return
        draft = _call(client, "POST", f"/users/{box}/messages", message).json()
        for name, data in attachments:
            _upload(client, box, draft["id"], name, data)
        _call(client, "POST", f"/users/{box}/messages/{draft['id']}/send")
