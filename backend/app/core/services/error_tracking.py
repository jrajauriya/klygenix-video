from __future__ import annotations

import logging
import os
import re
import subprocess
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

logger = logging.getLogger(__name__)

FILTERED = "[Filtered]"

DROP_HEADERS = {"authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key",
                "x-razorpay-signature", "x-webhook-signature", "x-signature", "x-csrf-token",
                "x-forwarded-for", "x-real-ip", "cf-connecting-ip", "true-client-ip", "referer"}

SECRET_KEYS = re.compile(
    r"(^|[_\-.])(password|passwd|secret|token|authorization|auth|cookie|session|api[_\-]?key|apikey|"
    r"signature|sig|otp|pin|code|link|key|pan|gstin|ifsc|account[_\-]?number|acct|card|cvv|upi|vpa|"
    r"email|phone|mobile|whatsapp)$",
    re.IGNORECASE,
)

SAFE_KEYS = re.compile(r"(^|[_\-.])(status_code|error_code|http_code)$", re.IGNORECASE)

QUERY_KEYS = re.compile(r"^(.*[_\-])?(token|link|code|signature|sig|key|otp|email|phone)$", re.IGNORECASE)

BODY_ROUTES = re.compile(
    r"/api/(auth|account|store/library|store/affiliate|store/webhooks|store/files)|checkout|payout|"
    r"signin|sign-in|lead|password|totp|data-rights|/me(/|$)",
    re.IGNORECASE,
)

PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"enc:[A-Za-z0-9_\-=+/.:]+"), "enc:[sealed]"),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*"), "[jwt]"),
    (re.compile(r"\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=\-]+", re.IGNORECASE), r"\1 [Filtered]"),
    (re.compile(r"\b(kv_live|rzp_live|rzp_test|sk_live|sk_test)_[A-Za-z0-9]+"), r"\1_[Filtered]"),
    (re.compile(r"([?&;](?:[\w\-]*[_\-])?(?:token|link|code|signature|sig|key|otp|email|phone)=)[^&#\s\"'<>]*",
                re.IGNORECASE), r"\1[Filtered]"),
    (re.compile(r"((?:%3F|%26|%23)(?:[\w\-]*[_\-])?(?:token|link|code|signature|sig|key|otp|email|phone)%3D)"
                r"(?:(?!%26|%23)[^&#\s\"'<>])*", re.IGNORECASE), r"\1[Filtered]"),
    (re.compile(r"[A-Za-z0-9._%+\-]+(?:@|%40)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", re.IGNORECASE), "[email]"),
    (re.compile(r"(?<![0-9A-Za-z])\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![0-9A-Za-z])", re.IGNORECASE), "[gstin]"),
    (re.compile(r"(?<![0-9A-Za-z])[A-Z]{5}\d{4}[A-Z](?![0-9A-Za-z])", re.IGNORECASE), "[pan]"),
    (re.compile(r"(?<![0-9A-Za-z])[A-Z]{4}0[A-Z0-9]{6}(?![0-9A-Za-z])"), "[ifsc]"),
    (re.compile(r"(?<![\w.])(?:\+?91[\s\-]?|0)?[6-9]\d{4}[\s\-]?\d{5}(?![\w])"), "[phone]"),
    (re.compile(r"(?<![\w.])\d{4}(?:[ \-]\d{4}){2,3}(?:[ \-]\d{1,3})?(?![\w])"), "[number]"),
    (re.compile(r"(?<![\w.])\d{9,18}(?![\w])"), "[number]"),
]

_state: dict[str, Any] = {"enabled": False}
_in_unit: ContextVar[bool] = ContextVar("error_tracking_unit", default=False)


def scrub_text(value: str) -> str:
    for pattern, repl in PATTERNS:
        value = pattern.sub(repl, value)
    return value


def scrub_url(url: str) -> str:
    try:
        parts = urlsplit(url)
    except ValueError:
        return scrub_text(url)
    query = scrub_query(parts.query)
    return scrub_text(urlunsplit((parts.scheme, parts.netloc, parts.path, query, "")))


def scrub_query(query: str | bytes | None) -> str:
    if not query:
        return ""
    if isinstance(query, bytes):
        query = query.decode("latin-1")
    pairs = parse_qsl(query, keep_blank_values=True)
    return urlencode([(k, FILTERED if QUERY_KEYS.match(k) else scrub_text(v)) for k, v in pairs], safe="[]")


def scrub_value(value: Any, depth: int = 0) -> Any:
    if depth > 12:
        return FILTERED
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            key = str(k)
            if isinstance(v, (str, int, float)) and not isinstance(v, bool) and SECRET_KEYS.search(key) \
                    and not SAFE_KEYS.search(key):
                out[k] = FILTERED
            else:
                out[k] = scrub_value(v, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [scrub_value(v, depth + 1) for v in value]
    return value


def _scrub_request(request: dict[str, Any]) -> dict[str, Any]:
    url = request.get("url") or ""
    path = urlsplit(url).path if url else ""
    headers = request.get("headers") or {}
    if isinstance(headers, dict):
        request["headers"] = {k: scrub_text(str(v)) for k, v in headers.items() if k.lower() not in DROP_HEADERS}
    request.pop("cookies", None)
    request.pop("env", None)
    if "query_string" in request:
        request["query_string"] = scrub_query(request.get("query_string"))
    if url:
        request["url"] = scrub_url(url)
    if "data" in request:
        if BODY_ROUTES.search(path):
            request.pop("data", None)
        else:
            request["data"] = scrub_value(request["data"])
    return request


def _scrub_frames(event: dict[str, Any]) -> None:
    values = (event.get("exception") or {}).get("values") or []
    threads = (event.get("threads") or {}).get("values") or []
    for holder in [*values, *threads]:
        for frame in (holder.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)


def _scrub_breadcrumb(crumb: dict[str, Any]) -> dict[str, Any] | None:
    if crumb.get("category") in ("ui.input",):
        return None
    data = crumb.get("data")
    if isinstance(data, dict):
        for field in ("url", "http.url", "to", "from"):
            if isinstance(data.get(field), str):
                data[field] = scrub_url(data[field])
        data.pop("http.query", None)
        data.pop("http.fragment", None)
    return scrub_value(crumb)


def scrub_event(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    event.pop("user", None)
    if isinstance(event.get("request"), dict):
        event["request"] = _scrub_request(event["request"])
    _scrub_frames(event)
    crumbs = event.get("breadcrumbs")
    if isinstance(crumbs, dict):
        crumbs["values"] = [c for c in (_scrub_breadcrumb(b) for b in crumbs.get("values") or []) if c]
    elif isinstance(crumbs, list):
        event["breadcrumbs"] = [c for c in (_scrub_breadcrumb(b) for b in crumbs) if c]
    for field in ("message", "logentry", "exception", "extra", "contexts", "tags", "spans", "fingerprint"):
        if field in event:
            event[field] = scrub_value(event[field])
    tags = event.setdefault("tags", {})
    if isinstance(tags, dict):
        if event.get("transaction") and "route" not in tags:
            tags["route"] = event["transaction"]
        if "request_id" not in tags:
            from app.core.logging_config import get_request_id

            rid = get_request_id()
            if rid:
                tags["request_id"] = rid
    return event


def enabled() -> bool:
    return bool(_state["enabled"])


def _release(value: str) -> str | None:
    if value:
        return value
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=3,
                             cwd=os.path.dirname(__file__)).stdout.strip()
        return f"klygenix-video@{sha}" if sha else None
    except (OSError, subprocess.SubprocessError):
        return None


def init(component: str = "api") -> bool:
    if _state["enabled"]:
        return True
    from app.config import settings

    dsn = settings.SENTRY_DSN.strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
        from sentry_sdk.integrations.redis import RedisIntegration
        from sentry_sdk.integrations.rq import RqIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed")
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=settings.SENTRY_ENVIRONMENT or ("sandbox" if settings.SANDBOX_ENABLED else "production"),
        release=_release(settings.SENTRY_RELEASE),
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="small",
        max_breadcrumbs=50,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
        before_breadcrumb=lambda crumb, hint: _scrub_breadcrumb(crumb),
        integrations=[
            StarletteIntegration(transaction_style="url"),
            FastApiIntegration(transaction_style="url"),
            SqlalchemyIntegration(),
            RedisIntegration(),
            RqIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )
    sentry_sdk.set_tag("component", component)
    _state["enabled"] = True
    return True


def set_component(name: str) -> None:
    if _state["enabled"]:
        import sentry_sdk

        sentry_sdk.set_tag("component", name)


def begin_request() -> None:
    _in_unit.set(True)


def tag(key: str, value: Any) -> None:
    if not _state["enabled"] or value is None or not _in_unit.get():
        return
    try:
        import sentry_sdk

        sentry_sdk.get_isolation_scope().set_tag(key, str(value))
    except Exception:
        pass


def tag_tenant(tenant_id: Any) -> None:
    tag("tenant_id", tenant_id)


@contextmanager
def job_scope(name: str, request_id: str | None):
    if not _state["enabled"]:
        yield
        return
    import sentry_sdk

    token = _in_unit.set(True)
    with sentry_sdk.isolation_scope() as scope:
        scope.set_tag("job", name)
        scope.set_transaction_name(f"job:{name}")
        if request_id:
            scope.set_tag("request_id", request_id)
        try:
            yield
        finally:
            _in_unit.reset(token)


def capture_job_failure(name: str, exc: BaseException) -> None:
    if not _state["enabled"]:
        return
    try:
        import sentry_sdk

        with sentry_sdk.new_scope() as scope:
            scope.set_tag("job", name)
            scope.set_tag("job_failed", "true")
            sentry_sdk.capture_exception(exc)
        sentry_sdk.flush(timeout=3)
    except Exception:
        pass
