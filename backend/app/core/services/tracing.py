from __future__ import annotations

import atexit
import contextlib
import logging
import os
import queue
import re
import secrets
import threading
import time
from contextvars import ContextVar
from typing import Any, Iterator

from app.config import settings

logger = logging.getLogger(__name__)

KINDS = {"internal": 1, "server": 2, "client": 3, "producer": 4, "consumer": 5}
TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$")
_current: ContextVar[tuple[str, str] | None] = ContextVar("kv_trace", default=None)
_memory: list[dict] = []
_exporter: "Exporter | None" = None
_lock = threading.Lock()


def enabled() -> bool:
    return bool(settings.OTEL_EXPORTER_OTLP_ENDPOINT) or settings.TRACING == "memory"


def extract(header: str | None) -> tuple[str, str] | None:
    m = TRACEPARENT.match((header or "").strip().lower())
    if not m or m.group(1) == "0" * 32 or m.group(2) == "0" * 16:
        return None
    return m.group(1), m.group(2)


def traceparent() -> str | None:
    cur = _current.get()
    return f"00-{cur[0]}-{cur[1]}-01" if cur else None


def current_trace_id() -> str | None:
    cur = _current.get()
    return cur[0] if cur else None


def _value(v: Any) -> dict:
    if isinstance(v, bool):
        return {"boolValue": v}
    if isinstance(v, int):
        return {"intValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    return {"stringValue": str(v)[:500]}


@contextlib.contextmanager
def span(name: str, kind: str = "internal", parent: tuple[str, str] | None = None, **attrs: Any) -> Iterator[dict]:
    if not enabled():
        yield {}
        return
    base = parent or _current.get()
    trace_id = base[0] if base else secrets.token_hex(16)
    span_id = secrets.token_hex(8)
    rec = {"traceId": trace_id, "spanId": span_id, "name": name[:200], "kind": KINDS.get(kind, 1),
           "startTimeUnixNano": str(time.time_ns()), "attrs": dict(attrs), "status": {"code": 1}}
    if base:
        rec["parentSpanId"] = base[1]
    token = _current.set((trace_id, span_id))
    try:
        yield rec["attrs"]
    except BaseException as exc:
        rec["status"] = {"code": 2, "message": f"{type(exc).__name__}: {exc}"[:300]}
        raise
    finally:
        _current.reset(token)
        rec["endTimeUnixNano"] = str(time.time_ns())
        rec["attributes"] = [{"key": k, "value": _value(v)} for k, v in rec.pop("attrs").items() if v is not None]
        _emit(rec)


def _emit(rec: dict) -> None:
    if settings.TRACING == "memory":
        with _lock:
            _memory.append(rec)
            del _memory[:-2000]
    if settings.OTEL_EXPORTER_OTLP_ENDPOINT:
        _ensure_exporter().put(rec)


def finished() -> list[dict]:
    with _lock:
        return list(_memory)


def clear() -> None:
    with _lock:
        _memory.clear()


def payload(spans: list[dict]) -> dict:
    resource = [{"key": "service.name", "value": {"stringValue": settings.OTEL_SERVICE_NAME}},
                {"key": "deployment.environment", "value": {"stringValue": settings.SENTRY_ENVIRONMENT or ("sandbox" if settings.SANDBOX_ENABLED else "production")}},
                {"key": "process.pid", "value": {"intValue": str(os.getpid())}}]
    return {"resourceSpans": [{"resource": {"attributes": resource},
                               "scopeSpans": [{"scope": {"name": "klygenix-play"}, "spans": spans}]}]}


class Exporter:
    def __init__(self, endpoint: str, every: float = 2.0, batch: int = 256):
        self.url = endpoint.rstrip("/") + ("" if endpoint.rstrip("/").endswith("/v1/traces") else "/v1/traces")
        self.q: queue.Queue = queue.Queue(maxsize=10_000)
        self.every, self.batch = every, batch
        self.thread = threading.Thread(target=self._loop, name="otlp-exporter", daemon=True)
        self.thread.start()

    def put(self, rec: dict) -> None:
        try:
            self.q.put_nowait(rec)
        except queue.Full:
            pass

    def drain(self) -> list[dict]:
        out = []
        while len(out) < self.batch:
            try:
                out.append(self.q.get_nowait())
            except queue.Empty:
                break
        return out

    def flush(self) -> int:
        import httpx

        sent = 0
        while True:
            spans = self.drain()
            if not spans:
                return sent
            headers = {"Content-Type": "application/json"}
            if settings.OTEL_EXPORTER_OTLP_HEADERS:
                from app.core.services import secrets as sealed

                for pair in sealed.resolve(settings.OTEL_EXPORTER_OTLP_HEADERS).split(","):
                    if "=" in pair:
                        k, v = pair.split("=", 1)
                        headers[k.strip()] = v.strip()
            try:
                httpx.post(self.url, json=payload(spans), headers=headers, timeout=5.0)
                sent += len(spans)
            except Exception:
                logger.warning("trace export failed", extra={"spans": len(spans)})

    def _loop(self) -> None:
        while True:
            time.sleep(self.every)
            self.flush()


def _ensure_exporter() -> Exporter:
    global _exporter
    if _exporter is None:
        with _lock:
            if _exporter is None:
                _exporter = Exporter(settings.OTEL_EXPORTER_OTLP_ENDPOINT)
                atexit.register(_exporter.flush)
    return _exporter


def flush() -> int:
    return _exporter.flush() if _exporter else 0


class TracingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not enabled():
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers") or []}
        parent = extract(headers.get("traceparent"))
        method = scope.get("method", "GET")
        with span(f"{method} {scope.get('path', '')}", "server", parent, **{
                "http.request.method": method, "url.path": scope.get("path", ""),
                "user_agent.original": headers.get("user-agent", "")[:200]}) as attrs:
            tp = traceparent()

            async def sending(message):
                if message["type"] == "http.response.start":
                    attrs["http.response.status_code"] = message["status"]
                    route = scope.get("route")
                    if route is not None and getattr(route, "path", None):
                        attrs["http.route"] = route.path
                    message.setdefault("headers", [])
                    message["headers"] = list(message["headers"]) + [(b"traceparent", tp.encode())]
                await send(message)

            await self.app(scope, receive, sending)
