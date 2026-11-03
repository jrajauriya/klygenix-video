from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    """Timezone-aware UTC. datetime.utcnow() is naive and deprecated."""
    return datetime.now(timezone.utc)


class EmailConfig(Base):
    __tablename__ = "email_configs"
    __table_args__ = {"schema": "kv_admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    config_type: Mapped[str] = mapped_column(String(20), default="global")
    tenant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("kv_admin.tenants.id"), nullable=True)
    smtp_host: Mapped[str] = mapped_column(String(200), nullable=False)
    smtp_port: Mapped[int] = mapped_column(Integer, default=587)
    smtp_username: Mapped[str] = mapped_column(String(200), nullable=False)
    smtp_password: Mapped[str] = mapped_column(String(500), nullable=False)
    from_email: Mapped[str] = mapped_column(String(200), nullable=False)
    from_name: Mapped[str] = mapped_column(String(200), default="Klygenix")
    use_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
