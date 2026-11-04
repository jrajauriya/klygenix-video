from datetime import datetime, timezone

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TenantMember(Base):
    __tablename__ = "tenant_members"
    __table_args__ = (
        CheckConstraint("role IN ('manager','editor','moderator','analyst')", name="ck_tenant_members_role"),
        CheckConstraint("status IN ('invited','active','removed')", name="ck_tenant_members_status"),
        Index("uq_tenant_members_open", "tenant_id", "email", unique=True, postgresql_where="status <> 'removed'"),
        Index("idx_tenant_members_user", "user_id", "status"),
        {"schema": "kv_admin"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("kv_admin.tenants.id"), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("kv_admin.users.id"))
    email: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(12), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="invited", server_default="invited")
    token_hash: Mapped[str | None] = mapped_column(String(64))
    invited_by: Mapped[int | None] = mapped_column(Integer)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
