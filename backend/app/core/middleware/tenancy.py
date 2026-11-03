"""Tenant scoping — the second gate on every query (§17, "Tenancy, twice").

Store has no legal-entity level: a tenant is one seller with one GSTIN or none, so the
request carries its tenant and nothing else. Pay's `require_entity` is deliberately gone."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.core.audit import API_KEY, Actor, USER, acting_as
from app.core.middleware.auth import get_current_user
from app.core.models.user import User
from app.core.services import error_tracking
from app.database import get_db
from app.core.messages import err

TENANT_KEY = "tenant_id"


@event.listens_for(Session, "after_begin")
def _apply_tenant_setting(session: Session, transaction, connection) -> None:
    """Stamp app.tenant_id at the start of EVERY transaction on a tenant session."""
    tenant_id = session.info.get(TENANT_KEY)
    if tenant_id is not None:
        connection.exec_driver_sql(
            "SELECT set_config('app.tenant_id', %s, true)", (str(tenant_id),)
        )
    if session.info.get("platform"):
        connection.exec_driver_sql("SELECT set_config('app.platform', 'on', true)")


def get_tenant_db(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Session:
    """A session with `app.tenant_id` set for the life of the transaction."""
    if user.tenant_id is None:
        # A global admin with no tenant reads through kv_admin routes, not these.
        raise err(status.HTTP_403_FORBIDDEN, "tenant_context_required")
    db.info[TENANT_KEY] = user.tenant_id
    error_tracking.tag_tenant(user.tenant_id)
    # Two places, and both are needed.
    #
    # Covers every transaction opened from here on, including those after a commit.
    #
    # And this covers the transaction get_current_user already opened before us.
    db.execute(
        text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(user.tenant_id)}
    )
    # An integration borrows a user's permissions but is not that person, and the trail
    # has to say so — otherwise a nightly sync reads as somebody working at 3am.
    key = getattr(request.state, "api_key", None)
    imp = getattr(user, "impersonated_by", None)
    if imp:
        # Every write in a support session is the staff member's, never the creator's (§13).
        acting_as(db, Actor(USER, user_id=imp["staff_user_id"], label=f"support:{imp['staff_email']} as {user.email}",
                            ip=request.client.host if request.client else None))
        return db
    acting_as(
        db,
        Actor(
            API_KEY if key is not None else USER,
            user_id=user.id,
            label=f"{key.name} ({key.prefix}…)" if key is not None else user.email,
            ip=request.client.host if request.client else None,
        ),
    )
    return db
