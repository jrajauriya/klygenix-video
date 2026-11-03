from __future__ import annotations

import time

from app.core.services import metrics

API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
HTML_PATHS = ("/api/video/render",)


class SecurityHeadersMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        headers_in = dict(scope.get("headers") or [])
        https = scope.get("scheme") == "https" or headers_in.get(b"x-forwarded-proto") == b"https"
        html = path.startswith(HTML_PATHS)

        async def wrapped(message):
            if message["type"] == "http.response.start":
                have = {k.lower() for k, _ in message.get("headers", [])}
                extra = [(b"x-content-type-options", b"nosniff"),
                         (b"referrer-policy", b"strict-origin-when-cross-origin"),
                         (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=()"),
                         (b"cache-control", b"no-store")]
                if not html:
                    extra += [(b"x-frame-options", b"DENY"), (b"content-security-policy", API_CSP.encode())]
                if https:
                    extra.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
                message["headers"] = list(message.get("headers", [])) + [(k, v) for k, v in extra if k not in have]
            await send(message)

        await self.app(scope, receive, wrapped)


class MetricsMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = time.perf_counter()
        status = {"code": 500}

        async def wrapped(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, wrapped)
        finally:
            route = scope.get("route")
            template = getattr(route, "path", None) or "unmatched"
            metrics.observe_request(scope.get("method", "GET"), template, status["code"], time.perf_counter() - started)
