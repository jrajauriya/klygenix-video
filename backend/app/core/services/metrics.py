from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict

from sqlalchemy import create_engine, text

logger = logging.getLogger(__name__)

BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
JOBS_KEY = "ks:metrics:jobs"
REQ_KEY = "kv:metrics:http:requests"
REALTIME_KEY = "kv:metrics:realtime"
HIST_KEY = "kv:metrics:http:durations"
DB_TTL = 10.0
FLUSH_SECONDS = 1.0

_lock = threading.Lock()
_requests: dict[tuple[str, str, str], int] = defaultdict(int)
_durations: dict[tuple[str, str], list[float]] = {}
_pending_requests: dict[tuple[str, str, str], int] = defaultdict(int)
_pending_durations: dict[tuple[str, str], list[float]] = {}
_flusher: threading.Thread | None = None
_db_cache: tuple[float, list[str]] = (0.0, [])
_engine = None


def _add(hists: dict, key: tuple[str, str], seconds: float) -> None:
    h = hists.get(key)
    if h is None:
        h = hists[key] = [0.0] * (len(BUCKETS) + 2)
    for i, b in enumerate(BUCKETS):
        if seconds <= b:
            h[i] += 1
    h[-2] += seconds
    h[-1] += 1


def observe_request(method: str, route: str, status: int, seconds: float) -> None:
    global _flusher
    with _lock:
        _requests[(method, route, str(status))] += 1
        _pending_requests[(method, route, str(status))] += 1
        _add(_durations, (method, route), seconds)
        _add(_pending_durations, (method, route), seconds)
        if _flusher is None or not _flusher.is_alive():
            _flusher = threading.Thread(target=_flush_forever, daemon=True, name="metrics-flush")
            _flusher.start()


def _flush() -> bool:
    with _lock:
        reqs = dict(_pending_requests)
        hists = {k: list(v) for k, v in _pending_durations.items()}
        _pending_requests.clear()
        _pending_durations.clear()
    if not reqs and not hists:
        return True
    try:
        from app.core.redis_client import get_redis

        pipe = get_redis().pipeline(transaction=False)
        for (method, route, status), n in reqs.items():
            pipe.hincrby(REQ_KEY, f"{method}|{route}|{status}", n)
        for (method, route), h in hists.items():
            for i, v in enumerate(h[:-2] + [h[-1]]):
                if v:
                    pipe.hincrby(HIST_KEY, f"{method}|{route}|{i}", int(v))
            pipe.hincrbyfloat(HIST_KEY, f"{method}|{route}|sum", h[-2])
        pipe.execute()
        return True
    except Exception:
        with _lock:
            for k, n in reqs.items():
                _pending_requests[k] += n
            for k, h in hists.items():
                cur = _pending_durations.setdefault(k, [0.0] * (len(BUCKETS) + 2))
                for i, v in enumerate(h):
                    cur[i] += v
        return False


def _flush_forever() -> None:
    while True:
        time.sleep(FLUSH_SECONDS)
        _flush()


def _shared() -> tuple[dict, dict] | None:
    if not _flush():
        return None
    try:
        from app.core.redis_client import get_redis

        r = get_redis()
        raw_req, raw_hist = r.hgetall(REQ_KEY), r.hgetall(HIST_KEY)
    except Exception:
        return None
    reqs: dict[tuple[str, str, str], int] = {}
    for field, n in raw_req.items():
        field = field.decode() if isinstance(field, bytes) else field
        method, rest = field.split("|", 1)
        route, status = rest.rsplit("|", 1)
        reqs[(method, route, status)] = int(n)
    hists: dict[tuple[str, str], list[float]] = {}
    for field, v in raw_hist.items():
        field = field.decode() if isinstance(field, bytes) else field
        method, rest = field.split("|", 1)
        route, slot = rest.rsplit("|", 1)
        h = hists.setdefault((method, route), [0.0] * (len(BUCKETS) + 2))
        if slot == "sum":
            h[-2] = float(v)
        elif int(slot) == len(BUCKETS):
            h[-1] = float(v)
        else:
            h[int(slot)] = float(v)
    return reqs, hists


def job_outcome(name: str, ok: bool) -> None:
    try:
        from app.core.redis_client import get_redis

        get_redis().hincrby(JOBS_KEY, f"{name}|{'ok' if ok else 'failed'}", 1)
    except Exception:
        pass


def _esc(v: str) -> str:
    return str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(**kw) -> str:
    return "{" + ",".join(f'{k}="{_esc(v)}"' for k, v in kw.items()) + "}"


def _owner_engine():
    global _engine
    if _engine is None:
        from app.config import settings

        _engine = create_engine(settings.DATABASE_URL, pool_size=1, max_overflow=0, pool_pre_ping=True)
    return _engine


def _db_lines() -> list[str]:
    global _db_cache
    at, lines = _db_cache
    if time.monotonic() - at < DB_TTL:
        return lines
    out: list[str] = []
    try:
        with _owner_engine().connect() as cx:
            out += ["# HELP kv_payments_captured_total Payments captured, by rail.",
                    "# TYPE kv_payments_captured_total counter"]
            for rail, n in cx.execute(text(
                    "select c.rail, count(*) from kv_commerce.payments p join kv_commerce.checkouts c on c.id = p.checkout_id group by c.rail")):
                out.append(f"kv_payments_captured_total{_labels(rail=rail)} {n}")
            out += ["# HELP kv_open_checkouts Checkouts open or waiting on the gateway.",
                    "# TYPE kv_open_checkouts gauge"]
            n = cx.execute(text("select count(*) from kv_commerce.checkouts where status = 'created'")).scalar()
            out.append(f"kv_open_checkouts {n}")
            out += ["# HELP kv_webhook_deliveries_total Callbacks received (in) and integrator webhooks sent (out).",
                    "# TYPE kv_webhook_deliveries_total counter"]
            for rail, outcome, n in cx.execute(text(
                    "select rail, case when not signature_ok then 'unverified' when processed_at is not null then 'ok' "
                    "when error is not null then 'failed' else 'pending' end, count(*) "
                    "from kv_commerce.provider_events group by 1, 2")):
                out.append(f"kv_webhook_deliveries_total{_labels(direction='in', rail=rail, outcome=outcome)} {n}")
            out += ["# HELP kv_videos Videos by status.", "# TYPE kv_videos gauge"]
            for status, n in cx.execute(text("select status, count(*) from kv_media.videos where not is_deleted group by status")):
                out.append(f"kv_videos{_labels(status=status)} {n}")
            out += ["# HELP kv_ai_jobs_recent AI jobs in the last 15 minutes, by kind and status.", "# TYPE kv_ai_jobs_recent gauge"]
            for kind, status, n in cx.execute(text(
                    "select kind, status, count(*) from kv_ai.ai_jobs where created_at > now() - interval '15 minutes' group by 1, 2")):
                out.append(f"kv_ai_jobs_recent{_labels(kind=kind, status=status)} {n}")
            out += ["# HELP kv_pipeline_backlog Videos waiting in the pipeline.", "# TYPE kv_pipeline_backlog gauge"]
            n = cx.execute(text("select count(*) from kv_media.videos where status in ('processing','scanning') "
                                "and updated_at < now() - interval '10 minutes'")).scalar()
            out.append(f"kv_pipeline_backlog {n}")
            out += ["# HELP kv_render_waiting Clips queued or rendering for over five minutes.", "# TYPE kv_render_waiting gauge"]
            n = cx.execute(text("select count(*) from kv_studio.clips where status in ('queued','rendering') "
                                "and updated_at < now() - interval '5 minutes'")).scalar()
            out.append(f"kv_render_waiting {n}")
            out += ["# HELP kv_llm_cost_month_minor Language-model spend this month, paise.", "# TYPE kv_llm_cost_month_minor gauge"]
            n = cx.execute(text("select coalesce(sum(cost_minor), 0) from kv_ai.llm_calls where created_at >= date_trunc('month', now())")).scalar()
            out.append(f"kv_llm_cost_month_minor {n}")
            out += ["# HELP kv_trust_overdue Takedown notices past their acknowledge or resolve clock, by kind.",
                    "# TYPE kv_trust_overdue gauge"]
            for stage, kind, n in cx.execute(text(
                    "select 'ack', kind, count(*) from kv_trust.takedowns where acknowledged_at is null and ack_due_at < now() group by 2 "
                    "union all select 'resolve', kind, count(*) from kv_trust.takedowns where resolved_at is null "
                    "and status not in ('countered','upheld') and resolve_due_at < now() group by 2")):
                out.append(f"kv_trust_overdue{_labels(stage=stage, kind=kind)} {n}")
            out += ["# HELP kv_reco_ctr_bps Feed click-through in the last 24 h, basis points, by arm.", "# TYPE kv_reco_ctr_bps gauge"]
            for arm, n, c in cx.execute(text("select arm, count(*), count(clicked_at) from kv_ai.reco_impressions "
                                             "where shown_at > now() - interval '24 hours' group by 1")):
                out.append(f"kv_reco_ctr_bps{_labels(arm=arm)} {int(c) * 10000 // int(n) if n else 0}")
            out += ["# HELP kv_reco_model_age_hours Age of the active recommendation model (-1 when none).",
                    "# TYPE kv_reco_model_age_hours gauge"]
            age = cx.execute(text("select extract(epoch from now() - max(trained_at)) / 3600 from kv_ai.reco_models "
                                  "where status = 'active'")).scalar()
            out.append(f"kv_reco_model_age_hours {round(float(age), 1) if age is not None else -1}")
            out += ["# HELP kv_live_streams Live streams, by status (scheduled or live).", "# TYPE kv_live_streams gauge"]
            for status, n in cx.execute(text("select status, count(*) from kv_media.live_streams "
                                             "where status in ('scheduled','live') group by 1")):
                out.append(f"kv_live_streams{_labels(status=status)} {n}")
            out += ["# HELP kv_live_ingest_stale Live streams whose ingest has sent nothing for 20 seconds.",
                    "# TYPE kv_live_ingest_stale gauge"]
            n = cx.execute(text("select count(*) from kv_media.live_streams where status = 'live' "
                                "and coalesce(last_seen_at, started_at) < now() - interval '20 seconds'")).scalar()
            out.append(f"kv_live_ingest_stale {n}")
            out += ["# HELP kv_takedowns_overdue Takedowns past their deadline.", "# TYPE kv_takedowns_overdue gauge"]
            n = cx.execute(text("select count(*) from kv_trust.takedowns where resolved_at is null and resolve_due_at < now()")).scalar()
            out.append(f"kv_takedowns_overdue {n}")
    except Exception:
        logger.warning("metrics: database figures unavailable")
        out += ["# TYPE kv_metrics_db_up gauge", "kv_metrics_db_up 0"]
    else:
        out += ["# TYPE kv_metrics_db_up gauge", "kv_metrics_db_up 1"]
    _db_cache = (time.monotonic(), out)
    return out


def _job_lines() -> list[str]:
    out = ["# HELP kv_jobs_total Background jobs run, by outcome.", "# TYPE kv_jobs_total counter"]
    try:
        from app.core.redis_client import get_redis

        for field, n in sorted(get_redis().hgetall(JOBS_KEY).items()):
            field = field.decode() if isinstance(field, bytes) else field
            name, _, outcome = field.rpartition("|")
            out.append(f"kv_jobs_total{_labels(job=name, outcome=outcome)} {int(n)}")
        dropped = get_redis().hget(REALTIME_KEY, "dropped")
        out += ["# HELP kv_realtime_dropped_total Realtime messages dropped because a socket fell behind.",
                "# TYPE kv_realtime_dropped_total counter", f"kv_realtime_dropped_total {int(dropped or 0)}"]
    except Exception:
        up = 0
    else:
        up = 1
    out += ["# HELP kv_redis_up Whether the API could read Redis for this scrape.", "# TYPE kv_redis_up gauge",
            f"kv_redis_up {up}"]
    return out


def render() -> str:
    shared = _shared()
    if shared is None:
        with _lock:
            shared = dict(_requests), {k: list(v) for k, v in _durations.items()}
    reqs, hists = shared
    lines = ["# HELP kv_http_requests_total HTTP requests, by route template and status.",
             "# TYPE kv_http_requests_total counter"]
    for (method, route, status), n in sorted(reqs.items()):
        lines.append(f"kv_http_requests_total{_labels(method=method, route=route, status=status)} {n}")
    lines += ["# HELP kv_http_request_duration_seconds HTTP request latency, by route template.",
              "# TYPE kv_http_request_duration_seconds histogram"]
    for (method, route), h in sorted(hists.items()):
        for i, b in enumerate(BUCKETS):
            lines.append(f"kv_http_request_duration_seconds_bucket{_labels(method=method, route=route, le=str(b))} {int(h[i])}")
        lines.append(f"kv_http_request_duration_seconds_bucket{_labels(method=method, route=route, le='+Inf')} {int(h[-1])}")
        lines.append(f"kv_http_request_duration_seconds_sum{_labels(method=method, route=route)} {h[-2]:.6f}")
        lines.append(f"kv_http_request_duration_seconds_count{_labels(method=method, route=route)} {int(h[-1])}")
    lines += _job_lines()
    lines += _db_lines()
    return "\n".join(lines) + "\n"
