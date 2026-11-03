from datetime import datetime, timezone

from sqlalchemy import ARRAY, BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ApiKey(Base):
    """A credential an integrator holds. Shown once, stored hashed, revocable (P4)."""

    __tablename__ = "api_keys"
    __table_args__ = (
        UniqueConstraint("secret_hash", name="uq_api_keys_secret_hash"),
        Index("idx_api_keys_prefix", "prefix"),
        Index("idx_api_keys_tenant", "tenant_id", "is_active"),
        {"schema": "kv_admin"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("kv_admin.tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # The visible half, so a leaked key can be named in a log without holding it.
    prefix: Mapped[str] = mapped_column(String(24), nullable=False)
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    allowed_ips: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    # A key acts AS this user, so it can never do more than they can.
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("kv_admin.users.id", ondelete="CASCADE"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("kv_admin.users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
