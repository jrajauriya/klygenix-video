import asyncio
import logging
from datetime import datetime, timedelta
from urllib.parse import urlparse

import jwt
from jwt import PyJWTError as JWTError
from sqlalchemy import insert
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.core.models.activity_log import ActivityLog
from app.database import SessionLocal

logger = logging.getLogger(__name__)

QUEUE_MAX = 5000
FLUSH_SECONDS = 2.0
FLUSH_ROWS = 200

_queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
_dropped = 0

# Which surface a request came from. Origin wins; the path prefix is the fallback for
# calls carrying no Origin header (the mobile app, curl, an integration key).
ORIGIN_APPS = {
    "localhost:5302": "admin",
    "localhost:5301": "video",
    "localhost:5300": "video",
    "127.0.0.1:5302": "admin",
    "127.0.0.1:5301": "video",
    "127.0.0.1:5300": "video",
    "admin.play.klygenix.com": "admin",
    "studio.play.klygenix.com": "video",
    "play.klygenix.com": "video",
}

PATH_APPS = (
    ("/api/video", "video"),
    ("/api/admin", "admin"),
)

METHOD_KINDS = {
    "GET": "view",
    "HEAD": "view",
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
}

# Requests that are machinery, not activity. Logging them buries what a human did.
DENY_EXACT = {
    ("GET", "/api/auth/me"),
    ("GET", "/api/video/tenant-features"),
    ("GET", "/api/video/permissions"),
    ("GET", "/api/admin/tenant-features"),
    ("GET", "/api/admin/permissions"),
    ("GET", "/api/video/me"),
}

DENY_PREFIX = (
    "/health",
    "/api/video/webhooks",
    "/api/video/sandbox",
    "/api/video/feed",
    "/api/video/videos/",
    "/api/video/search",
    "/api/video/channels/",
    "/api/video/images",
    "/api/video/ws",
    "/api/admin/activity",
    "/api/video/permission-catalog",
    "/api/admin/permission-catalog",
)

ROUTE_LABELS: dict[tuple[str, str], tuple[str, str]] = {
    ("POST", "/api/auth/login"): ("Signed in", "login"),
    ("POST", "/api/auth/google"): ("Signed in with Google", "login"),
    ("POST", "/api/auth/signup"): ("Signed up", "create"),

    ("POST", "/api/video/studio/channel"): ("Opened a channel", "create"),
    ("PATCH", "/api/video/studio/channel"): ("Updated the channel", "update"),
    ("POST", "/api/video/studio/videos"): ("Started an upload", "create"),
    ("PATCH", "/api/video/studio/videos/{video_id}"): ("Updated a video", "update"),
    ("DELETE", "/api/video/studio/videos/{video_id}"): ("Deleted a video", "delete"),
    ("PUT", "/api/video/studio/videos/{video_id}/transcript"): ("Edited a transcript", "update"),
    ("POST", "/api/video/studio/videos/{video_id}/captions"): ("Uploaded captions", "create"),
    ("POST", "/api/video/studio/clips"): ("Created a clip", "create"),
    ("POST", "/api/video/studio/clips/{clip_id}/render"): ("Rendered a clip", "create"),
    ("POST", "/api/video/studio/clips/{clip_id}/publish"): ("Published a clip", "create"),
    ("POST", "/api/video/studio/embeds"): ("Added an embedded video", "create"),
    ("DELETE", "/api/video/studio/connected/{connected_id}"): ("Disconnected a channel", "delete"),
    ("POST", "/api/video/checkout"): ("Started a plan payment", "create"),
    ("POST", "/api/video/me/plans/{audience}/cancel"): ("Cancelled a plan", "update"),
    ("POST", "/api/video/appeals"): ("Appealed a decision", "create"),
    ("PUT", "/api/video/roles/permissions"): ("Changed screen access", "update"),

    ("POST", "/api/video/admin/actions"): ("Took a moderation action", "create"),
    ("POST", "/api/video/admin/appeals/{appeal_id}"): ("Decided an appeal", "update"),
    ("POST", "/api/video/admin/takedowns/{takedown_id}"): ("Decided a takedown", "update"),
    ("GET", "/api/admin/tenants"): ("Opened Accounts", "view"),
    ("POST", "/api/admin/tenants"): ("Created an account", "create"),
    ("PATCH", "/api/admin/tenants/{tenant_id}"): ("Updated an account", "update"),
    ("PUT", "/api/admin/tenants/{tenant_id}/features"): ("Changed a feature matrix", "update"),
    ("GET", "/api/admin/team"): ("Opened Users & Roles", "view"),
    ("POST", "/api/admin/team"): ("Added a platform user", "create"),
    ("PUT", "/api/admin/roles/permissions"): ("Changed admin permissions", "update"),
}

PREFIX_LABELS = (
    ("/api/video/admin/queue", "Opened the moderation queue", "view"),
)

FALLBACK_VERBS = {
    "view": "Opened",
    "create": "Created in",
    "update": "Updated",
    "delete": "Deleted from",
    "login": "Signed in to",
}

SKIP_SEGMENTS = {"api", "video", "admin", "studio"}


def _noun(template: str) -> str:
    segments = [
        s for s in template.strip("/").split("/")
        if s and not s.startswith("{") and s not in SKIP_SEGMENTS
    ]
    if not segments:
        return "the API"
    return segments[-1].replace("-", " ").replace("_", " ").title()


def route_template(path: str, path_params: dict) -> tuple[str, str | None]:
    if not path_params:
        return path, None
    by_value: dict[str, str] = {}
    for name, value in path_params.items():
        by_value.setdefault(str(value), name)

    entity_id = None
    out = []
    for segment in path.split("/"):
        name = by_value.get(segment)
        if name is not None:
            out.append("{" + name + "}")
            if entity_id is None:
                entity_id = segment
        else:
            out.append(segment)
    return "/".join(out), entity_id


def describe(method: str, template: str) -> tuple[str, str]:
    hit = ROUTE_LABELS.get((method, template))
    if hit:
        return hit
    kind = METHOD_KINDS.get(method, "view")
    for prefix, label, prefix_kind in PREFIX_LABELS:
        if template.startswith(prefix):
            return label, prefix_kind if method in ("GET", "HEAD") else kind
    return f"{FALLBACK_VERBS[kind]} {_noun(template)}", kind


def app_for(origin: str | None, template: str) -> str:
    if origin:
        host = urlparse(origin).netloc or origin
        hit = ORIGIN_APPS.get(host.lower())
        if hit:
            return hit
    for prefix, app in PATH_APPS:
        if template.startswith(prefix):
            return app
    return "admin"


def is_denied(method: str, template: str) -> bool:
    if (method, template) in DENY_EXACT:
        return True
    return any(template.startswith(p) for p in DENY_PREFIX)


def _claims(auth_header: str | None) -> tuple[int | None, int | None]:
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return None, None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None, None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None, None
    return payload.get("user_id"), payload.get("tenant_id")


def _client_ip(request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45]
    return request.client.host[:45] if request.client else None


def record(row: dict) -> None:
    global _dropped
    try:
        _queue.put_nowait(row)
    except asyncio.QueueFull:
        _dropped += 1
        if _dropped % 500 == 1:
            logger.warning("activity: queue full, %d row(s) dropped so far", _dropped)


def log_login(db, user, request=None) -> None:
    try:
        origin = request.headers.get("origin") if request is not None else None
        db.add(ActivityLog(
            tenant_id=user.tenant_id,
            user_id=user.id,
            occurred_at=datetime.utcnow(),
            app=app_for(origin, "/api/auth/login"),
            kind="login",
            label="Logged in",
            method="POST",
            path="/api/auth/login",
            entity_id=None,
            status_code=200,
            duration_ms=None,
            ip=_client_ip(request) if request is not None else None,
            user_agent=(request.headers.get("user-agent") or "")[:300] if request is not None else None,
        ))
    except Exception:
        logger.exception("activity: login row failed")


class ActivityLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        started = datetime.utcnow()
        response = await call_next(request)

        try:
            user_id, tenant_id = _claims(request.headers.get("authorization"))
            if user_id is None:
                return response

            template, entity_id = route_template(
                request.url.path, request.scope.get("path_params") or {}
            )
            if is_denied(request.method, template):
                return response

            label, kind = describe(request.method, template)
            if kind == "view":
                return response
            elapsed = (datetime.utcnow() - started).total_seconds() * 1000

            record({
                "tenant_id": tenant_id,
                "user_id": user_id,
                "occurred_at": started,
                "app": app_for(request.headers.get("origin"), template),
                "kind": kind,
                "label": label[:200],
                "method": request.method,
                "path": template[:300],
                "entity_id": entity_id[:50] if entity_id else None,
                "status_code": response.status_code,
                "duration_ms": int(elapsed),
                "ip": _client_ip(request),
                "user_agent": (request.headers.get("user-agent") or "")[:300] or None,
            })
        except Exception:
            logger.exception("activity: capture failed")

        return response


def _flush(rows: list[dict]) -> None:
    db = SessionLocal()
    try:
        db.execute(insert(ActivityLog), rows)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("activity: flush failed for %d rows", len(rows))
    finally:
        db.close()


def _purge() -> int:
    days = getattr(settings, "ACTIVITY_LOG_RETENTION_DAYS", 90)
    if days <= 0:
        return 0
    cutoff = datetime.utcnow() - timedelta(days=days)
    db = SessionLocal()
    try:
        removed = (
            db.query(ActivityLog)
            .filter(ActivityLog.occurred_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        return removed
    except Exception:
        db.rollback()
        logger.exception("activity: purge failed")
        return 0
    finally:
        db.close()


async def activity_writer_loop():
    last_purge = datetime.utcnow()

    while True:
        rows: list[dict] = []
        try:
            first = await asyncio.wait_for(_queue.get(), timeout=FLUSH_SECONDS)
            rows.append(first)
            while len(rows) < FLUSH_ROWS:
                try:
                    rows.append(_queue.get_nowait())
                except asyncio.QueueEmpty:
                    break
        except asyncio.TimeoutError:
            pass
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("activity: drain failed")

        if rows:
            try:
                await asyncio.to_thread(_flush, rows)
            except Exception:
                logger.exception("activity: writer failed")

        if (datetime.utcnow() - last_purge) > timedelta(hours=24):
            last_purge = datetime.utcnow()
            try:
                await asyncio.to_thread(_purge)
            except Exception:
                logger.exception("activity: purge task failed")

    leftovers: list[dict] = []
    while True:
        try:
            leftovers.append(_queue.get_nowait())
        except asyncio.QueueEmpty:
            break
    if leftovers:
        _flush(leftovers)
