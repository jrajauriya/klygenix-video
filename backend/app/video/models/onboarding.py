from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, pk, tenant_fk


class ImportJob(Base):
    __tablename__ = "import_jobs"
    __table_args__ = (
        CheckConstraint("status IN ('queued','running','done','failed')", name="ck_import_jobs_status"),
        {"schema": "kv_media"},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    connected_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="queued", server_default="queued")
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    done: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = created()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ImportItem(Base):
    __tablename__ = "import_items"
    __table_args__ = (
        UniqueConstraint("job_id", "external_id", name="uq_import_items_job_external"),
        CheckConstraint("status IN ('pending','done','failed','skipped')", name="ck_import_items_status"),
        Index("idx_import_items_job", "job_id", "status"),
        {"schema": "kv_media"},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    job_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    external_id: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="pending", server_default="pending")
    video_id: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(String(300))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChannelHandle(Base):
    __tablename__ = "channel_handles"
    __table_args__ = (
        UniqueConstraint("handle", name="uq_channel_handles_handle"),
        Index("idx_channel_handles_channel", "channel_id"),
        {"schema": "kv_social"},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    handle: Mapped[str] = mapped_column(String(40), nullable=False)
    retired_at: Mapped[datetime] = created()
    reserved_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
