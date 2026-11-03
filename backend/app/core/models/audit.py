from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditEntry(Base):
    """The money-and-access audit trail (§22).

    Not `kv_admin.activity_log`, which is page-view telemetry written by a background
    queue that drops on overflow. This one is written by a `before_flush` listener in the
    same transaction as the change, and the application role may only insert and read it.
    """

    __tablename__ = "audit_log"
    __table_args__ = {"schema": "kv_admin"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("kv_admin.tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    actor_kind: Mapped[str] = mapped_column(String(12), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("kv_admin.users.id", ondelete="SET NULL")
    )
    # Kept even when the user row goes: the FK above is SET NULL by design.
    actor_label: Mapped[str | None] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    target_table: Mapped[str] = mapped_column(String(80), nullable=False)
    target_id: Mapped[int | None] = mapped_column(BigInteger)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    request_id: Mapped[str | None] = mapped_column(String(32))
    ip: Mapped[str | None] = mapped_column(String(45))
