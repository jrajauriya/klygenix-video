"""The scheduler."""

from __future__ import annotations

import logging
import signal
import time
from datetime import datetime, timezone

from redis import RedisError

from app.core.logging_config import configure_logging, set_request_id
from app.core.redis_client import get_redis
from app.video.jobs import heartbeat
from app.video.jobs.sweeps import sweep_all

logger = logging.getLogger(__name__)

LOCK_KEY = "scheduler:leader"
LOCK_TTL = 90          # seconds; refreshed every tick
TICK_SECONDS = 30

_running = True


def _stop(signum, _frame):  # noqa: ANN001
    global _running
    logger.info("scheduler stopping", extra={"signal": signum})
    _running = False


def acquire_leadership(token: str) -> bool:
    """Claim the lock, or confirm we still hold it. False means another copy is leading."""
    r = get_redis()
    if r.set(LOCK_KEY, token, nx=True, ex=LOCK_TTL):
        return True
    if r.get(LOCK_KEY) == token:
        r.expire(LOCK_KEY, LOCK_TTL)
        return True
    return False


def tick(now: datetime) -> None:
    """One pass: every store's time-driven work — renewals and grace, expiry, commission
    release, reminders, the outbox, and (with Razorpay keys) reconciliation."""
    if now.minute % 10 == 0:
        heartbeat.enqueue(note=now.isoformat(timespec="minutes"))
    sweep_all.enqueue()


def main() -> None:
    configure_logging()
    from app.core.services import error_tracking

    error_tracking.set_component("scheduler")
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    token = f"{time.time_ns():x}"
    logger.info("scheduler starting", extra={"token": token})

    while _running:
        set_request_id()
        try:
            if acquire_leadership(token):
                tick(datetime.now(timezone.utc))
            else:
                logger.warning("another scheduler holds the lock; idling")
        except RedisError:
            logger.exception("scheduler tick failed")
        time.sleep(TICK_SECONDS)

    logger.info("scheduler stopped")


if __name__ == "__main__":
    main()
