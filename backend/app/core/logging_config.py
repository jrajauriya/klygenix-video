"""Structured logs, with a request id that survives into the worker."""

from __future__ import annotations

import json
import logging
import re
import sys
import uuid
from contextvars import ContextVar

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

# Never log these, whatever the key's casing or nesting.
REDACT = {"password", "password_hash", "token", "access_token", "secret", "api_key",
          "authorization", "smtp_password", "card", "pan", "cvv", "account_number"}
URL_SECRET = re.compile(r"([?&](?:secret|token|access_token|key|signature|sig|code)=)[^&\s\"']+", re.I)


def set_request_id(value: str | None = None) -> str:
    rid = value or uuid.uuid4().hex[:16]
    _request_id.set(rid)
    return rid


def get_request_id() -> str | None:
    return _request_id.get()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": URL_SECRET.sub(r"\1***", record.getMessage()),
        }
        rid = _request_id.get()
        if rid:
            payload["request_id"] = rid
        # Anything passed as `extra=` rides along, redacted.
        for key, value in record.__dict__.items():
            if key in logging.LogRecord("", 0, "", 0, "", None, None).__dict__:
                continue
            if key in ("message", "asctime", "taskName"):
                continue
            payload[key] = "***" if key.lower() in REDACT else value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level)
    # uvicorn's own handlers would otherwise double every line in a different format.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers.clear()
        logging.getLogger(name).propagate = True
