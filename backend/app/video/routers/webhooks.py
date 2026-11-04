from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool

from app.core.messages import err
from app.video.media.service import ingest_event

router = APIRouter(prefix="/api/video/webhooks", tags=["webhooks"])


@router.post("/media/{provider}")
async def media(provider: str, request: Request):
    if provider not in ("bunny", "sandbox"):
        raise err(404, "action_not_allowed")
    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        await run_in_threadpool(ingest_event, provider, body, headers, dict(request.query_params))
    except PermissionError:
        raise err(400, "action_not_allowed")
    return {"ok": True}


@router.post("/cloudflare-live")
async def cloudflare_live(request: Request):
    from app.video.live import cf_events, cloudflare

    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    if "cf-webhook-auth" in headers:
        ok, kind = cloudflare.verify_notification(headers), "notify"
    else:
        ok, kind = cloudflare.verify_stream_webhook(body, headers.get("webhook-signature")), "video"
    event_id = await run_in_threadpool(cf_events.record, body, kind, ok)
    if not ok:
        raise err(400, "action_not_allowed")
    if event_id:
        cf_events.process_event.enqueue(event_id)
    return {"ok": True}
