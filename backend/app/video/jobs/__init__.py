"""Background work on RQ. Every job must be idempotent and safe to retry (§04)."""

from __future__ import annotations

import functools
import logging
from typing import Any, Callable

from redis import RedisError
from rq import Queue, Retry

from app.core.logging_config import get_request_id, set_request_id
from app.core.redis_client import get_redis
from app.core.services import error_tracking

logger = logging.getLogger(__name__)

error_tracking.init("worker")

QUEUE_NAME = "default"

# 1 minute, 5, 25.
DEFAULT_RETRY = Retry(max=3, interval=[60, 300, 1500])
DEFAULT_TIMEOUT = 300


def queue(name: str = QUEUE_NAME) -> Queue:
    return Queue(name, connection=get_redis())


def job(fn: Callable[..., Any] | None = None, *, queue_name: str = QUEUE_NAME, timeout: int = DEFAULT_TIMEOUT):
    def wrap(f: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(f)
        def run(*args: Any, _request_id: str | None = None, _traceparent: str | None = None, **kwargs: Any) -> Any:
            set_request_id(_request_id)
            from app.core.services import tracing
            from app.core.services.metrics import job_outcome

            with error_tracking.job_scope(f.__name__, _request_id), tracing.span(
                    f"job {f.__name__}", "consumer", tracing.extract(_traceparent),
                    **{"messaging.destination.name": queue_name, "kv.request_id": _request_id}):
                logger.info("job started", extra={"job": f.__name__})
                try:
                    result = f(*args, **kwargs)
                except Exception as exc:
                    error_tracking.capture_job_failure(f.__name__, exc)
                    logger.exception("job failed", extra={"job": f.__name__})
                    job_outcome(f.__name__, False)
                    raise
                logger.info("job finished", extra={"job": f.__name__})
                job_outcome(f.__name__, True)
                return result

        run.queue_name = queue_name  # type: ignore[attr-defined]
        run.timeout = timeout  # type: ignore[attr-defined]
        run.enqueue = lambda *a, **kw: enqueue(run, *a, **kw)  # type: ignore[attr-defined]
        return run

    if fn is not None:
        return wrap(fn)
    return wrap


def _run_inline(fn: Callable[..., Any], args: tuple, kwargs: dict) -> None:
    import threading

    from app.core.services import tracing

    request_id = get_request_id()
    parent = tracing.traceparent()

    def target() -> None:
        try:
            fn(*args, _request_id=request_id, _traceparent=parent, **kwargs)
        except Exception:
            logger.exception("inline job failed", extra={"job": getattr(fn, "__name__", str(fn))})

    threading.Thread(target=target, daemon=True).start()


def _parent() -> str | None:
    from app.core.services import tracing

    return tracing.traceparent()


def enqueue(fn: Callable[..., Any], *args: Any, **kwargs: Any):
    from app.config import settings

    if settings.JOBS_MODE == "inline":
        _run_inline(fn, args, kwargs)
        return None
    if settings.JOBS_MODE == "sync":
        fn(*args, **kwargs)
        return None
    try:
        return queue(getattr(fn, "queue_name", QUEUE_NAME)).enqueue(
            fn,
            *args,
            _request_id=get_request_id(),
            _traceparent=_parent(),
            retry=DEFAULT_RETRY,
            job_timeout=getattr(fn, "timeout", DEFAULT_TIMEOUT),
            **kwargs,
        )
    except RedisError:
        logger.exception("could not enqueue", extra={"job": getattr(fn, "__name__", str(fn))})
        return None


@job
def heartbeat(note: str = "") -> str:
    """A no-op job, to prove the pipe."""
    logger.info("heartbeat", extra={"note": note})
    return f"ok {note}".strip()
