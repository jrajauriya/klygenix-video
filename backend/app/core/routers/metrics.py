from __future__ import annotations

import hmac

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse

from app.config import settings
from app.core.services import metrics

router = APIRouter(tags=["metrics"])


@router.get("/metrics", include_in_schema=False)
async def prometheus(request: Request):
    token = settings.METRICS_TOKEN
    if token:
        given = request.headers.get("authorization", "")
        if not hmac.compare_digest(given.encode(), f"Bearer {token}".encode()):
            raise HTTPException(status_code=401, detail="A metrics token is required.",
                                headers={"WWW-Authenticate": "Bearer"})
    elif not settings.SANDBOX_ENABLED:
        raise HTTPException(status_code=404, detail="Not Found")
    body = await run_in_threadpool(metrics.render)
    return PlainTextResponse(body, media_type="text/plain; version=0.0.4; charset=utf-8")
