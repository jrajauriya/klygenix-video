"""Sessions that act for one tenant without a signed-in user.

The storefront, the webhook worker and the sweeps all know their tenant from something
other than a token — a store handle, a callback URL, a row they are sweeping. Each of them
opens a session through here so `app.tenant_id` is stamped exactly as `get_tenant_db`
stamps it, and RLS holds for them too (Pay's trap: a sweep that relies on RLS alone is
cross-tenant under the owner role, so every sweep also filters on tenant_id itself).
"""

from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.audit import Actor, attribute
from app.core.services import error_tracking
from app.core.middleware.tenancy import TENANT_KEY
from app.database import SessionLocal


def bind_tenant(db: Session, tenant_id: int, actor: Actor | None = None) -> Session:
    db.info[TENANT_KEY] = tenant_id
    error_tracking.tag_tenant(tenant_id)
    db.execute(text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant_id)})
    if actor is not None:
        attribute(db, tenant_id=tenant_id, actor=actor)
    return db


@contextmanager
def tenant_session(tenant_id: int, actor: Actor | None = None):
    db = SessionLocal()
    try:
        bind_tenant(db, tenant_id, actor)
        yield db
    finally:
        db.close()


@contextmanager
def platform_session():
    db = SessionLocal()
    try:
        db.info["platform"] = True
        db.execute(text("SELECT set_config('app.platform', 'on', true)"))
        yield db
    finally:
        db.close()
