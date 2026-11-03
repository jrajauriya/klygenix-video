from __future__ import annotations

import json
import logging
import zlib
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from app.config import settings
from app.core.services import error_tracking, rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/observe", tags=["observe"], include_in_schema=False)

MAX_BYTES = 200 * 1024
MAX_EXPANDED = 1024 * 1024
TIMEOUT = httpx.Timeout(5.0, connect=3.0)
EVENT_ITEMS = {"event", "transaction"}
OTHER_ITEMS = {"feedback", "user_report", "client_report"}
TRACE_KEYS = {"trace_id", "public_key", "release", "environment", "sample_rate", "sampled", "transaction"}


@dataclass(frozen=True)
class Dsn:
    scheme: str
    host: str
    port: int | None
    prefix: str
    key: str
    project: str

    @property
    def envelope_url(self) -> str:
        netloc = f"[{self.host}]" if ":" in self.host else self.host
        if self.port:
            netloc += f":{self.port}"
        return f"{self.scheme}://{netloc}{self.prefix}/api/{self.project}/envelope/"

    def same(self, other: "Dsn") -> bool:
        return (self.key, self.project, self.host, self.port) == (other.key, other.project, other.host, other.port)


def parse_dsn(value: Any) -> Dsn | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parts = urlsplit(value.strip())
        port = parts.port
    except ValueError:
        return None
    path = parts.path.rstrip("/")
    prefix, _, project = path.rpartition("/")
    if parts.scheme not in ("http", "https") or not parts.hostname or not parts.username or not project.isdigit():
        return None
    return Dsn(parts.scheme, parts.hostname.lower(), port, prefix, parts.username, project)


def configured() -> list[Dsn]:
    found = [parse_dsn(v) for v in (settings.SENTRY_BROWSER_DSN, settings.SENTRY_DSN)]
    return [d for d in found if d]


def _refuse(code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


async def _body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise _refuse(413, "That report is too large.")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BYTES:
            raise _refuse(413, "That report is too large.")
        chunks.append(chunk)
    raw = b"".join(chunks)
    encoding = (request.headers.get("content-encoding") or "").lower()
    if encoding in ("gzip", "deflate"):
        inflater = zlib.decompressobj(zlib.MAX_WBITS | 32 if encoding == "gzip" else zlib.MAX_WBITS)
        try:
            raw = inflater.decompress(raw, MAX_EXPANDED + 1)
        except zlib.error:
            raise _refuse(400, "That report could not be read.") from None
        if len(raw) > MAX_EXPANDED or inflater.unconsumed_tail:
            raise _refuse(413, "That report is too large.")
    elif encoding not in ("", "identity"):
        raise _refuse(415, "That report is in an encoding this server does not read.")
    return raw


def split_envelope(raw: bytes) -> tuple[dict, list[tuple[dict, bytes]]]:
    pos = 0

    def line() -> bytes:
        nonlocal pos
        end = raw.find(b"\n", pos)
        end = len(raw) if end < 0 else end
        out, pos = raw[pos:end], end + 1
        return out

    header = json.loads(line() or b"{}")
    if not isinstance(header, dict):
        raise ValueError("envelope header")
    items: list[tuple[dict, bytes]] = []
    while pos < len(raw):
        head = line()
        if not head.strip():
            continue
        item = json.loads(head)
        if not isinstance(item, dict):
            raise ValueError("item header")
        length = item.get("length")
        if isinstance(length, int) and length >= 0:
            payload = raw[pos:pos + length]
            pos += length + 1
        else:
            payload = line()
        items.append((item, payload))
    return header, items


def _scrub_item(kind: str, payload: bytes) -> bytes | None:
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    if kind in EVENT_ITEMS:
        had_rid = isinstance(data.get("tags"), dict) and "request_id" in data["tags"]
        data = error_tracking.scrub_event(data) or {}
        if not had_rid and isinstance(data.get("tags"), dict):
            data["tags"].pop("request_id", None)
        data.pop("server_name", None)
    else:
        data = error_tracking.scrub_value(data)
    return json.dumps(data, separators=(",", ":"), default=str).encode()


def rebuild(header: dict, items: list[tuple[dict, bytes]]) -> tuple[bytes, int]:
    head = {k: header[k] for k in ("event_id", "sent_at", "dsn") if isinstance(header.get(k), str)}
    sdk = header.get("sdk")
    if isinstance(sdk, dict):
        head["sdk"] = {k: sdk[k] for k in ("name", "version") if isinstance(sdk.get(k), str)}
    trace = header.get("trace")
    if isinstance(trace, dict):
        head["trace"] = {k: v for k, v in trace.items() if k in TRACE_KEYS}
        if isinstance(head["trace"].get("transaction"), str):
            head["trace"]["transaction"] = error_tracking.scrub_url(head["trace"]["transaction"])
    out = [json.dumps(head, separators=(",", ":")).encode()]
    kept = 0
    for item, payload in items:
        kind = str(item.get("type") or "")
        if kind not in EVENT_ITEMS and kind not in OTHER_ITEMS:
            continue
        body = _scrub_item(kind, payload)
        if body is None:
            continue
        out.append(json.dumps({"type": kind, "length": len(body)}, separators=(",", ":")).encode())
        out.append(body)
        kept += 1
    return b"\n".join(out) + b"\n", kept


@router.post("/tunnel")
async def tunnel(request: Request) -> Response:
    allowed = configured()
    if not allowed:
        raise _refuse(404, "Not Found")
    rate_limit.per_ip(request, "observe-tunnel", settings.RL_OBSERVE_TUNNEL_PER_MIN, 60,
                      "Too many error reports from this address; try again in a minute.")
    raw = await _body(request)
    try:
        header, items = split_envelope(raw)
    except (ValueError, UnicodeDecodeError):
        raise _refuse(400, "That report could not be read.") from None
    claimed = parse_dsn(header.get("dsn"))
    target = next((d for d in allowed if claimed and d.same(claimed)), None)
    if target is None:
        raise _refuse(403, "Reports are only forwarded for this site's own error-tracking project.")
    envelope, kept = rebuild(header, items)
    if not kept:
        return Response(status_code=200, content=b"{}", media_type="application/json")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
            upstream = await client.post(target.envelope_url, content=envelope,
                                         headers={"Content-Type": "application/x-sentry-envelope"})
    except httpx.HTTPError as exc:
        logger.warning("error report tunnel: upstream unreachable (%s)", type(exc).__name__)
        raise _refuse(502, "The error tracker could not be reached.") from None
    passthrough = {k: v for k, v in upstream.headers.items()
                   if k.lower() in ("retry-after", "x-sentry-rate-limits")}
    if upstream.status_code == 429 or 200 <= upstream.status_code < 300:
        return Response(status_code=upstream.status_code, content=upstream.content[:4096],
                        media_type="application/json", headers=passthrough)
    logger.warning("error report tunnel: upstream answered %s", upstream.status_code)
    return Response(status_code=502, content=b'{"detail":"The error tracker refused the report."}',
                    media_type="application/json")
