from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, pk, tenant_fk

SCHEMA = "kv_trust"

TARGETS = "target_type IN ('video','comment','danmaku','channel','live','live_message')"


class ScanResult(Base):
    __tablename__ = "scan_results"
    __table_args__ = (
        CheckConstraint("verdict IN ('clear','review','block')", name="ck_scan_results_verdict"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    verdict: Mapped[str] = mapped_column(String(8), nullable=False)
    labels: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    hash_match: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = created()


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint(TARGETS, name="ck_reports_target"),
        CheckConstraint("status IN ('open','actioned','dismissed')", name="ck_reports_status"),
        Index("idx_reports_open", "status", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    reporter_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    target_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")
    created_at: Mapped[datetime] = created()
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[int | None] = mapped_column(Integer)


class ModerationAction(Base):
    __tablename__ = "moderation_actions"
    __table_args__ = (
        CheckConstraint(TARGETS, name="ck_moderation_actions_target"),
        CheckConstraint(
            "action IN ('approve','remove','restrict','restore','warn','suspend','unsuspend')",
            name="ck_moderation_actions_action",
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    report_id: Mapped[int | None] = mapped_column(BigInteger)
    takedown_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = created()


class Strike(Base):
    __tablename__ = "strikes"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    action_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lifted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Appeal(Base):
    __tablename__ = "appeals"
    __table_args__ = (
        CheckConstraint("status IN ('open','upheld','overturned')", name="ck_appeals_status"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    action_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")
    decision_note: Mapped[str | None] = mapped_column(Text)
    decided_by: Mapped[int | None] = mapped_column(Integer)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Takedown(Base):
    __tablename__ = "takedowns"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('copyright','it_rules','intimate','court_order','other')", name="ck_takedowns_kind"
        ),
        CheckConstraint(
            "status IN ('received','acknowledged','actioned','rejected','countered','restored','upheld')",
            name="ck_takedowns_status",
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    complainant_name: Mapped[str] = mapped_column(String(120), nullable=False)
    complainant_email: Mapped[str] = mapped_column(String(200), nullable=False)
    target_url: Mapped[str] = mapped_column(String(500), nullable=False)
    video_id: Mapped[int | None] = mapped_column(BigInteger)
    target_tenant_id: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    sworn: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="received")
    received_at: Mapped[datetime] = created()
    ack_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolve_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    counter_notice: Mapped[dict | None] = mapped_column(JSONB)
    countered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    restore_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    legal_action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
