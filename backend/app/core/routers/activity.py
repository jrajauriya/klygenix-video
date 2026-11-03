from datetime import date as date_type, datetime, time as dt_time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.models.activity_log import ActivityLog
from app.core.models.tenant import Tenant, TenantModule
from app.core.models.user import User
from app.core.middleware.auth import require_admin_tenant
from app.core.schemas.activity import (
    ActivityEvent,
    TenantActivityRow,
    TenantActivitySummary,
    UserActivityRow,
)

router = APIRouter(prefix="/api/admin/activity", tags=["admin-activity"])

DEFAULT_WINDOW_DAYS = 5


def _parse(value: Optional[str]) -> Optional[date_type]:
    if not value:
        return None
    try:
        return date_type.fromisoformat(value[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}")


def _bounds(date_from: Optional[str], date_to: Optional[str]) -> tuple[datetime, datetime]:
    end_day = _parse(date_to) or datetime.utcnow().date()
    start_day = _parse(date_from)
    if start_day is None:
        start_day = end_day - timedelta(days=DEFAULT_WINDOW_DAYS - 1)
    if start_day > end_day:
        start_day, end_day = end_day, start_day
    return (
        datetime.combine(start_day, dt_time.min),
        datetime.combine(end_day, dt_time.max),
    )


def _counts():
    return (
        func.count(ActivityLog.id).label("total_events"),
        func.sum(case((ActivityLog.kind == "login", 1), else_=0)).label("logins"),
        func.sum(case((ActivityLog.kind == "create", 1), else_=0)).label("creates"),
        func.sum(case((ActivityLog.kind == "update", 1), else_=0)).label("updates"),
        func.sum(case((ActivityLog.kind == "delete", 1), else_=0)).label("deletes"),
        func.max(ActivityLog.occurred_at).label("last_seen_at"),
    )


@router.get("/tenants", response_model=list[TenantActivityRow])
def tenant_activity(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.logs")),
):
    start, end = _bounds(date_from, date_to)

    stats = {
        r.tenant_id: r
        for r in db.query(
            ActivityLog.tenant_id.label("tenant_id"),
            func.count(ActivityLog.id).label("total_events"),
            func.sum(case((ActivityLog.kind == "login", 1), else_=0)).label("logins"),
            func.count(func.distinct(ActivityLog.user_id)).label("active_users"),
            func.max(ActivityLog.occurred_at).label("last_activity_at"),
        )
        .filter(ActivityLog.occurred_at >= start, ActivityLog.occurred_at <= end)
        .group_by(ActivityLog.tenant_id)
        .all()
    }
    user_counts = dict(
        db.query(User.tenant_id, func.count(User.id))
        .filter(User.tenant_id.isnot(None))
        .group_by(User.tenant_id)
        .all()
    )
    modules: dict[int, list[str]] = {}
    for tenant_id, module_name in (
        db.query(TenantModule.tenant_id, TenantModule.module_name)
        .filter(TenantModule.is_enabled == True)  # noqa: E712
        .all()
    ):
        modules.setdefault(tenant_id, []).append(module_name)

    rows = []
    for tenant in db.query(Tenant).order_by(Tenant.name.asc()).all():
        s = stats.get(tenant.id)
        rows.append(TenantActivityRow(
            tenant_id=tenant.id,
            name=tenant.name,
            slug=tenant.slug,
            products=sorted(modules.get(tenant.id, [])),
            is_active=tenant.is_active,
            active_users=int(s.active_users or 0) if s else 0,
            total_users=int(user_counts.get(tenant.id) or 0),
            total_events=int(s.total_events or 0) if s else 0,
            logins=int(s.logins or 0) if s else 0,
            last_activity_at=s.last_activity_at if s else None,
        ))
    return rows


@router.get("/tenants/{tenant_id}/users", response_model=TenantActivitySummary)
def tenant_user_activity(
    tenant_id: int,
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.logs")),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Customer not found")

    start, end = _bounds(date_from, date_to)
    total_events, logins, creates, updates, deletes, last_seen = _counts()

    stats = {
        r.user_id: r
        for r in db.query(
            ActivityLog.user_id.label("user_id"),
            total_events, logins, creates, updates, deletes, last_seen,
        )
        .filter(
            ActivityLog.tenant_id == tenant_id,
            ActivityLog.occurred_at >= start,
            ActivityLog.occurred_at <= end,
        )
        .group_by(ActivityLog.user_id)
        .all()
    }

    users = (
        db.query(User)
        .filter(User.tenant_id == tenant_id)
        .order_by(User.name.asc())
        .all()
    )

    rows = []
    for user in users:
        s = stats.get(user.id)
        rows.append(UserActivityRow(
            user_id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            is_active=user.is_active,
            last_seen_at=s.last_seen_at if s else None,
            last_login_at=user.last_login,
            sessions=int(s.logins or 0) if s else 0,
            creates=int(s.creates or 0) if s else 0,
            updates=int(s.updates or 0) if s else 0,
            deletes=int(s.deletes or 0) if s else 0,
            total_events=int(s.total_events or 0) if s else 0,
        ))

    rows.sort(key=lambda r: (-r.total_events, r.name.lower()))

    return TenantActivitySummary(
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        active_users=sum(1 for r in rows if r.total_events > 0),
        total_events=sum(r.total_events for r in rows),
        logins=sum(r.sessions for r in rows),
        users=rows,
    )


@router.get("/tenants/{tenant_id}/events", response_model=list[ActivityEvent])
def tenant_events(
    tenant_id: int,
    user_id: Optional[int] = Query(None),
    app: Optional[str] = Query(None),
    kind: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.logs")),
):
    start, end = _bounds(date_from, date_to)

    q = (
        db.query(ActivityLog, User.name)
        .outerjoin(User, ActivityLog.user_id == User.id)
        .filter(
            ActivityLog.tenant_id == tenant_id,
            ActivityLog.occurred_at >= start,
            ActivityLog.occurred_at <= end,
        )
    )
    if user_id is not None:
        q = q.filter(ActivityLog.user_id == user_id)
    if app:
        q = q.filter(ActivityLog.app == app)
    if kind:
        q = q.filter(ActivityLog.kind == kind)

    rows = (
        q.order_by(ActivityLog.occurred_at.desc(), ActivityLog.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    return [
        ActivityEvent(
            id=row.id,
            occurred_at=row.occurred_at,
            user_id=row.user_id,
            user_name=user_name,
            app=row.app,
            kind=row.kind,
            label=row.label,
            method=row.method,
            path=row.path,
            entity_id=row.entity_id,
            status_code=row.status_code,
            duration_ms=row.duration_ms,
            ip=row.ip,
        )
        for row, user_name in rows
    ]
