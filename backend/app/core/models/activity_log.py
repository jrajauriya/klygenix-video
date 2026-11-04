from datetime import datetime
from sqlalchemy import (
    String, Integer, SmallInteger, BigInteger, DateTime, ForeignKey, Index,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

SCHEMA = "kv_admin"

KINDS = ("login", "view", "create", "update", "delete")
APPS = ("admin", "video")


class ActivityLog(Base):
    __tablename__ = "activity_log"
    __table_args__ = (
        Index("idx_activity_log_tenant_time", "tenant_id", "occurred_at"),
        Index("idx_activity_log_user_time", "user_id", "occurred_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("kv_admin.tenants.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("kv_admin.users.id"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, primary_key=True)
    app: Mapped[str] = mapped_column(String(10), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(50))
    status_code: Mapped[int] = mapped_column(SmallInteger, default=200, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    ip: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(300))
