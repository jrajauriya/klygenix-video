from datetime import datetime

from pydantic import BaseModel


class TenantActivityRow(BaseModel):
    tenant_id: int
    name: str
    slug: str
    products: list[str] = []
    is_active: bool
    active_users: int = 0
    total_users: int = 0
    total_events: int = 0
    logins: int = 0
    last_activity_at: datetime | None = None


class UserActivityRow(BaseModel):
    user_id: int
    name: str
    email: str
    role: str
    is_active: bool
    last_seen_at: datetime | None = None
    last_login_at: datetime | None = None
    sessions: int = 0
    creates: int = 0
    updates: int = 0
    deletes: int = 0
    total_events: int = 0


class ActivityEvent(BaseModel):
    id: int
    occurred_at: datetime
    user_id: int | None = None
    user_name: str | None = None
    app: str
    kind: str
    label: str
    method: str
    path: str
    entity_id: str | None = None
    status_code: int
    duration_ms: int | None = None
    ip: str | None = None


class TenantActivitySummary(BaseModel):
    tenant_id: int
    tenant_name: str
    active_users: int = 0
    total_events: int = 0
    logins: int = 0
    users: list[UserActivityRow] = []
