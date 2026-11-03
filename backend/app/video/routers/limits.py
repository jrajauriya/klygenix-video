from __future__ import annotations

from fastapi import Request

from app.config import settings
from app.core.services.rate_limit import limit, per_ip

BUSY = "Too many requests from here. Wait a minute and try again."
HOURLY = "Too many requests from here. Try again later."


def checkout_create(request: Request) -> None:
    per_ip(request, "checkout-create", settings.RL_CHECKOUT_CREATE_PER_MIN, 60, BUSY)


def sandbox_pay(request: Request) -> None:
    per_ip(request, "sandbox-pay", settings.RL_SANDBOX_PAY_PER_MIN, 60, BUSY)


def report(request: Request) -> None:
    per_ip(request, "report", settings.RL_REPORT_PER_HOUR, 3600, "Too many reports from here. Try again later.")


def upload_create(request: Request) -> None:
    per_ip(request, "upload-create", settings.RL_UPLOAD_PER_HOUR, 3600, HOURLY)


def search(request: Request) -> None:
    per_ip(request, "search", settings.RL_SEARCH_PER_MIN, 60, BUSY)


def ask(request: Request) -> None:
    per_ip(request, "ask", settings.RL_ASK_PER_MIN, 60, BUSY)


def danmaku(request: Request, user_id: int) -> None:
    per_ip(request, "danmaku", settings.RL_DANMAKU_PER_MIN * 3, 60, BUSY)
    limit(f"danmaku-user:{user_id}", settings.RL_DANMAKU_PER_MIN, 60, message="Too fast. Wait a moment.")


def comment(request: Request, user_id: int) -> None:
    per_ip(request, "comment", settings.RL_COMMENT_PER_MIN * 3, 60, BUSY)
    limit(f"comment-user:{user_id}", settings.RL_COMMENT_PER_MIN, 60, message="Too fast. Wait a moment.")


def takedown(request: Request) -> None:
    per_ip(request, "takedown", 10, 3600, HOURLY)
