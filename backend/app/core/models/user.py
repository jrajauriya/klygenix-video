from datetime import datetime, timezone
from sqlalchemy import BigInteger, String, Boolean, Integer, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    """Timezone-aware UTC. datetime.utcnow() is naive and deprecated."""
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "kv_admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("kv_admin.tenants.id"), index=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    products: Mapped[dict] = mapped_column(JSONB, default=list)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    phone: Mapped[str | None] = mapped_column(String(20))
    notifications_last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    home_region: Mapped[str] = mapped_column(String(4), nullable=False, default="in", server_default="in")
    totp_secret: Mapped[str | None] = mapped_column(Text)
    totp_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    totp_last_step: Mapped[int | None] = mapped_column(BigInteger)

    tenant = relationship("Tenant", back_populates="users")

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def totp_enabled(self) -> bool:
        return self.totp_enabled_at is not None
