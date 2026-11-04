import asyncio
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core.services import error_tracking

error_tracking.init("api")

from app.core.logging_config import configure_logging
from app.core.redis_client import redis_available
from app.database import SessionLocal, create_schemas
from app.core.models.tenant import Tenant, TenantModule
from app.core.models.user import User
from app.core.services.auth_service import hash_password
from app.core.services.tenant_service import MODULES

import app.core.models  # noqa: F401
import app.video.models  # noqa: F401
import app.video.after_commit  # noqa: F401


def seed_admin_tenant_and_global_admin() -> None:
    """Make sure the platform has a tenant to run from and someone who can sign in.

    Idempotent, and ordered so the global admin always lands with a real tenant_id —
    the master estate creates the user first with tenant_id=None and backfills it in a
    second function, which leaves a window where the admin cannot log in.
    """
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.slug == settings.ADMIN_TENANT_SLUG).first()
        if not tenant:
            tenant = Tenant(
                name=settings.ADMIN_TENANT_NAME,
                slug=settings.ADMIN_TENANT_SLUG,
                plan="enterprise",
                email=settings.GLOBAL_ADMIN_EMAIL,
                license_start=date.today(),
                license_end=date.today() + timedelta(days=36500),
                max_users=50,
                is_active=True,
                verified_at=datetime.now(timezone.utc),
            )
            db.add(tenant)
            db.flush()
            for module in MODULES:
                db.add(TenantModule(tenant_id=tenant.id, module_name=module, is_enabled=True))
            db.commit()
            print(f"Admin tenant created: {settings.ADMIN_TENANT_SLUG}")

        admin = db.query(User).filter(User.email == settings.GLOBAL_ADMIN_EMAIL).first()
        if not admin:
            db.add(
                User(
                    tenant_id=tenant.id,
                    email=settings.GLOBAL_ADMIN_EMAIL,
                    password_hash=hash_password(settings.GLOBAL_ADMIN_PASSWORD),
                    name=settings.GLOBAL_ADMIN_NAME,
                    role="global_admin",
                    products=list(MODULES),
                    is_active=True,
                    # The platform's own admin is not a signup waiting on a confirmation link.
                    email_verified_at=datetime.now(timezone.utc),
                )
            )
            db.commit()
            print(f"Global admin created: {settings.GLOBAL_ADMIN_EMAIL}")
        elif admin.tenant_id != tenant.id:
            admin.tenant_id = tenant.id
            db.commit()
    finally:
        db.close()


def _provision_admin_store() -> None:
    from app.video.services.provisioning import provision_admin_tenant

    db = SessionLocal()
    try:
        provision_admin_tenant(db)
    finally:
        db.close()


async def _inline_sweeps() -> None:
    """With no scheduler process (JOBS_MODE=inline, development), sweep once a minute here."""
    from fastapi.concurrency import run_in_threadpool

    from app.video.jobs.sweeps import sweep_all

    while True:
        await asyncio.sleep(60)
        try:
            await run_in_threadpool(sweep_all)
        except Exception:  # a sweep failing must never take the API down
            import logging

            logging.getLogger(__name__).exception("inline sweep failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.LOG_LEVEL)
    import anyio.to_thread

    anyio.to_thread.current_default_thread_limiter().total_tokens = max(4, settings.DB_POOL_SIZE)
    create_schemas()
    seed_admin_tenant_and_global_admin()
    _provision_admin_store()

    from app.core.middleware.activity import activity_writer_loop

    activity_task = asyncio.create_task(activity_writer_loop())
    sweeper = asyncio.create_task(_inline_sweeps()) if settings.JOBS_MODE == "inline" else None
    if settings.LIVE_WORKER_INLINE and settings.LIVE_PROVIDER == "sandbox" and settings.SANDBOX_ENABLED:
        from app.video.live.worker import start_inline

        start_inline()
    yield
    if settings.LIVE_WORKER_INLINE:
        from app.video.live.worker import stop_inline

        stop_inline()
    for task in (activity_task, sweeper):
        if task is None:
            continue
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Klygenix Play API",
    description="Klygenix Play — videos, reels, AI, danmaku and the creator studio",
    version="0.1.0",
    lifespan=lifespan,
    openapi_url="/openapi.json" if settings.SANDBOX_ENABLED else None,
    docs_url="/docs" if settings.SANDBOX_ENABLED else None,
    redoc_url="/redoc" if settings.SANDBOX_ENABLED else None,
)

from app.core.errors import install as install_error_handlers  # noqa: E402

install_error_handlers(app)

from app.core.middleware.activity import ActivityLogMiddleware  # noqa: E402
from app.core.middleware.rate_headers import RateLimitHeaderMiddleware  # noqa: E402
from app.core.middleware.request_id import RequestIdMiddleware  # noqa: E402

# Starlette runs middleware in REVERSE add order: CORS, request id, activity logger.
app.add_middleware(RateLimitHeaderMiddleware)
app.add_middleware(ActivityLogMiddleware)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Totp-Required", "X-Request-Id"],
)

from app.core.middleware.observe import MetricsMiddleware, SecurityHeadersMiddleware  # noqa: E402

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(MetricsMiddleware)

from app.core.messages import ReaderMiddleware  # noqa: E402

app.add_middleware(ReaderMiddleware)

# ── Control plane ────────────────────────────────────────────────────────────
from app.core.routers.auth import router as auth_router  # noqa: E402
from app.core.routers.account import router as account_router  # noqa: E402
from app.core.routers.device import router as device_router  # noqa: E402
from app.core.routers.admin import router as admin_router  # noqa: E402
from app.core.routers.admin_team import router as admin_team_router  # noqa: E402
from app.core.routers.activity import router as activity_router  # noqa: E402
from app.core.routers.email_config import router as email_config_router  # noqa: E402
from app.core.routers.permissions import (  # noqa: E402
    admin_permissions_router,
    video_permissions_router,
)

app.include_router(auth_router)
app.include_router(account_router)
app.include_router(device_router)
app.include_router(admin_router)
app.include_router(admin_team_router)
app.include_router(admin_permissions_router)
app.include_router(activity_router)
app.include_router(email_config_router)

# ── Klygenix Play ───────────────────────────────────────────────────────────
app.include_router(video_permissions_router)

from app.video.routers import ROUTERS  # noqa: E402

for _router in ROUTERS:
    app.include_router(_router)

if settings.ERROR_TRACKING_DEBUG_ROUTES and settings.SANDBOX_ENABLED:
    from app.video.routers.debug import router as debug_router

    app.include_router(debug_router)

from app.core.routers.metrics import router as metrics_router  # noqa: E402

app.include_router(metrics_router)

from app.core.routers.readiness import router as readiness_router  # noqa: E402

app.include_router(readiness_router)

from app.core.routers.observe import router as observe_router  # noqa: E402

app.include_router(observe_router)



@app.get("/health")
def health():
    """Liveness. Redis is reported, not required — money routes fail closed on their own."""
    return {
        "status": "ok",
        "service": "klygenix-play-api",
        "redis": "up" if redis_available() else "down",
    }
