from __future__ import annotations

import logging

from app.video.jobs import job

logger = logging.getLogger(__name__)

SWEEPS: list = []


def sweep(fn):
    SWEEPS.append(fn)
    return fn


@job
def sweep_all() -> None:
    import app.video.sweeps  # noqa: F401

    for fn in SWEEPS:
        try:
            fn()
        except Exception:
            logger.exception("sweep failed", extra={"sweep": fn.__name__})
