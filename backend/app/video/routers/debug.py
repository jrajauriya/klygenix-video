from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.core.middleware.tenancy import get_tenant_db
from app.core.services import error_tracking
from app.video.jobs import job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/_debug", tags=["debug"], include_in_schema=False)


def _seed(detail: dict[str, Any]) -> str:
    logger.warning("debug breadcrumb for %s", detail.get("email"), extra={"buyer": detail})
    if error_tracking.enabled():
        import sentry_sdk

        sentry_sdk.set_extra("buyer", detail)
    return " ".join(f"{k}={v}" for k, v in detail.items())


@router.post("/boom")
def boom(payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_tenant_db)):
    raise RuntimeError(f"deliberate error {_seed(payload)}")


@router.post("/checkout/boom")
def checkout_boom(payload: dict[str, Any] = Body(default_factory=dict)):
    raise RuntimeError("deliberate checkout error")


@router.post("/boom-job", status_code=202)
def boom_job(payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_tenant_db)):
    debug_fail.enqueue(db.info.get("tenant_id"), payload)
    return {"queued": True}


@job
def debug_fail(tenant_id: int | None, detail: dict[str, Any]) -> None:
    if tenant_id is not None:
        error_tracking.tag_tenant(tenant_id)
    raise RuntimeError(f"deliberate job failure {_seed(detail)}")
