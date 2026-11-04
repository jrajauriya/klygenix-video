from __future__ import annotations

import json
import logging
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy import func, select

from app.config import settings

logger = logging.getLogger(__name__)

COMPLETED = ("completed", None)


class LlmUnavailable(RuntimeError):
    pass


class LlmFailed(RuntimeError):
    pass


class Transient(LlmFailed):
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


BREAKER = "llm"
RETRYABLE = {408, 409, 429, 500, 502, 503, 504}
PURPOSES = {"ask": (45, 1), "insights": (90, 2), "translate": (90, 2), "drafts": (45, 1), "clips": (60, 1), "repurpose": (90, 1)}
BACKOFF = (1.5, 4.0)
MAX_WAIT = 20.0


@dataclass
class Reply:
    text: str
    input_tokens: int
    output_tokens: int
    model: str


def is_configured() -> bool:
    return settings.LLM_PROVIDER != "sandbox" and bool(settings.LLM_BASE_URL and settings.LLM_API_KEY and settings.LLM_MODEL)


def _cost(inp: int, out: int) -> int:
    return (inp * settings.LLM_INPUT_COST_PER_MTOK_MINOR + out * settings.LLM_OUTPUT_COST_PER_MTOK_MINOR) // 1_000_000


def _log(purpose: str, model: str, tenant_id: int | None, status: str, started: float,
         inp: int = 0, out: int = 0, error: str | None = None) -> None:
    import app.core.models  # noqa: F401
    from app.database import SessionLocal
    from app.video.models.ai import LlmCall

    db = SessionLocal()
    try:
        db.add(LlmCall(tenant_id=tenant_id, purpose=purpose, provider=settings.LLM_PROVIDER, model=model,
                       input_tokens=inp, output_tokens=out, cost_minor=_cost(inp, out),
                       latency_ms=int((time.monotonic() - started) * 1000), status=status,
                       error=(error or "")[:500] or None))
        db.commit()
    except Exception:
        logger.exception("could not log llm call")
        db.rollback()
    finally:
        db.close()


def spent_this_month_minor() -> int:
    from app.database import SessionLocal
    from app.video.models.ai import LlmCall

    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    db = SessionLocal()
    try:
        return int(db.execute(select(func.coalesce(func.sum(LlmCall.cost_minor), 0)).where(LlmCall.created_at >= start)).scalar() or 0)
    finally:
        db.close()


def _text(body: dict) -> str:
    parts: list[str] = []
    for item in body.get("output") or []:
        for chunk in item.get("content") or []:
            if chunk.get("type") in ("output_text", "text"):
                parts.append(chunk.get("text") or "")
    return "".join(parts) or (body.get("output_text") or "")


def _retry_after(r: httpx.Response) -> float | None:
    for h in ("retry-after-ms", "retry-after"):
        v = r.headers.get(h)
        if v:
            try:
                return float(v) / (1000 if h.endswith("ms") else 1)
            except ValueError:
                return None
    return None


def _call(messages: list[dict], *, model: str, max_tokens: int, timeout: float | None = None) -> Reply:
    payload = {"model": model, "input": messages, "max_output_tokens": max_tokens}
    try:
        r = httpx.post(
            settings.LLM_BASE_URL,
            headers={"api-key": settings.LLM_API_KEY, "Content-Type": "application/json"},
            json=payload,
            timeout=httpx.Timeout(float(timeout or settings.LLM_TIMEOUT_SECONDS), connect=10.0),
        )
    except httpx.HTTPError as exc:
        raise Transient(f"could not reach the language model ({type(exc).__name__})") from exc
    if r.status_code != 200:
        detail = ""
        try:
            detail = ((r.json().get("error") or {}).get("message") or "")[:200]
        except Exception:
            detail = r.text[:200]
        message = f"language model returned {r.status_code} {detail}".strip()
        if r.status_code in RETRYABLE:
            raise Transient(message, _retry_after(r))
        raise LlmFailed(message)
    body = r.json()
    status = body.get("status")
    text = _text(body)
    if status == "incomplete":
        reason = (body.get("incomplete_details") or {}).get("reason") or "ran out of room"
        raise LlmFailed(f"the answer was cut short ({reason})")
    if status not in COMPLETED:
        raise LlmFailed(f"language model status {status}")
    if not text.strip():
        raise LlmFailed("empty answer")
    usage = body.get("usage") or {}
    return Reply(text, int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0), body.get("model") or model)


def complete(purpose: str, system: str, user: str, *, tenant_id: int | None = None, fast: bool = False,
             max_tokens: int | None = None) -> Reply:
    if not is_configured():
        raise LlmUnavailable("The language model is not configured")
    model = (settings.LLM_MODEL_FAST if fast and settings.LLM_MODEL_FAST else settings.LLM_MODEL)
    started = time.monotonic()
    if settings.LLM_MONTHLY_BUDGET_MINOR and (settings.LLM_INPUT_COST_PER_MTOK_MINOR or settings.LLM_OUTPUT_COST_PER_MTOK_MINOR):
        if spent_this_month_minor() >= settings.LLM_MONTHLY_BUDGET_MINOR:
            _log(purpose, model, tenant_id, "budget", started)
            raise LlmUnavailable("This month's language-model budget is used up")
    messages = [
        {"role": "system", "content": [{"type": "input_text", "text": system}]},
        {"role": "user", "content": [{"type": "input_text", "text": user}]},
    ]
    from app.core import breaker

    key = _breaker_key()
    try:
        breaker.check(BREAKER, key)
    except breaker.BreakerOpen as exc:
        _log(purpose, model, tenant_id, "paused", started, error=str(exc))
        raise Transient("The language model is failing; calls are paused for a minute", exc.retry_after) from exc
    timeout, retries = PURPOSES.get(purpose, (settings.LLM_TIMEOUT_SECONDS, settings.LLM_RETRIES))
    attempt = 0
    while True:
        try:
            reply = _call(messages, model=model, max_tokens=max_tokens or settings.LLM_MAX_OUTPUT_TOKENS, timeout=timeout)
        except Transient as exc:
            if attempt < retries:
                wait = min(exc.retry_after if exc.retry_after is not None else BACKOFF[min(attempt, len(BACKOFF) - 1)], MAX_WAIT)
                _log(purpose, model, tenant_id, "retry", started, error=str(exc))
                attempt += 1
                _sleep(wait * (0.8 + 0.4 * random.random()))
                continue
            breaker.failed(BREAKER, key)
            _log(purpose, model, tenant_id, "error", started, error=str(exc))
            raise
        except LlmFailed as exc:
            breaker.succeeded(BREAKER, key)
            _log(purpose, model, tenant_id, "error", started, error=str(exc))
            raise
        break
    breaker.succeeded(BREAKER, key)
    _log(purpose, reply.model, tenant_id, "ok", started, reply.input_tokens, reply.output_tokens)
    return reply


def _breaker_key() -> str:
    from urllib.parse import urlsplit

    return urlsplit(settings.LLM_BASE_URL).netloc or "default"


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def parse_json(text: str) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1].removeprefix("json").strip()
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise LlmFailed("the answer was not JSON")
    try:
        value = json.loads(m.group(0))
    except json.JSONDecodeError as exc:
        raise LlmFailed(f"the answer was not valid JSON ({exc.msg})") from exc
    if not isinstance(value, dict):
        raise LlmFailed("the answer was not a JSON object")
    return value


def complete_json(purpose: str, system: str, user: str, **kw) -> tuple[dict, Reply]:
    reply = complete(purpose, system, user, **kw)
    return parse_json(reply.text), reply
