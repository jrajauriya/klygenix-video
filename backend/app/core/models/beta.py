from datetime import datetime, timezone

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class InviteCode(Base):
    __tablename__ = "invite_codes"
    __table_args__ = (
        UniqueConstraint("code_hash", name="uq_invite_codes_hash"),
        CheckConstraint("role IN ('viewer','creator')", name="ck_invite_codes_role"),
        {"schema": "kv_admin"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hint: Mapped[str] = mapped_column(String(12), nullable=False)
    role: Mapped[str] = mapped_column(String(8), nullable=False, default="viewer")
    note: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    email: Mapped[str | None] = mapped_column(String(200))
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    used: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class WaitlistEntry(Base):
    __tablename__ = "waitlist"
    __table_args__ = (
        UniqueConstraint("email", name="uq_waitlist_email"),
        CheckConstraint("role IN ('viewer','creator','brand')", name="ck_waitlist_role"),
        CheckConstraint("status IN ('pending','confirmed','invited','joined','removed')", name="ck_waitlist_status"),
        Index("idx_waitlist_status", "status", "created_at"),
        {"schema": "kv_admin"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    role: Mapped[str] = mapped_column(String(8), nullable=False, default="viewer")
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="IN", server_default="IN")
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="en", server_default="en")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    channel_url: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    confirm_hash: Mapped[str | None] = mapped_column(String(64))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invite_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class MailOutbox(Base):
    __tablename__ = "mail_outbox"
    __table_args__ = (
        CheckConstraint("status IN ('captured','sent','failed','skipped')", name="ck_mail_outbox_status"),
        Index("idx_mail_outbox_to", "to_email", "created_at"),
        {"schema": "kv_admin"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    template: Mapped[str] = mapped_column(String(40), nullable=False)
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="en")
    to_email: Mapped[str] = mapped_column(String(200), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body_html: Mapped[str] = mapped_column(Text, nullable=False)
    body_text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    provider: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    tenant_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class Feedback(Base):
    __tablename__ = "feedback"
    __table_args__ = (
        CheckConstraint("kind IN ('bug','idea','other')", name="ck_feedback_kind"),
        CheckConstraint("status IN ('new','triaged','done','wontfix')", name="ck_feedback_status"),
        Index("idx_feedback_status", "status", "created_at"),
        {"schema": "kv_admin"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer)
    tenant_id: Mapped[int | None] = mapped_column(Integer)
    email: Mapped[str | None] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(6), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    page: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    app: Mapped[str] = mapped_column(String(12), nullable=False, default="web", server_default="web")
    app_version: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default="")
    user_agent: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    screenshot_key: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="new")
    admin_note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
