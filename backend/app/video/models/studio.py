from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, pk, tenant_fk, updated

SCHEMA = "kv_studio"


class Clip(Base):
    __tablename__ = "clips"
    __table_args__ = (
        CheckConstraint("aspect IN ('9:16','1:1','16:9')", name="ck_clips_aspect"),
        CheckConstraint("caption_style IN ('none','clean','bold','karaoke')", name="ck_clips_caption_style"),
        CheckConstraint(
            "status IN ('draft','queued','rendering','rendered','published','failed')", name="ck_clips_status"
        ),
        CheckConstraint("end_ms > start_ms", name="ck_clips_range"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    source_video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False, index=True)
    suggestion_id: Mapped[int | None] = mapped_column(BigInteger)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    start_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    aspect: Mapped[str] = mapped_column(String(5), nullable=False, default="9:16")
    reframe: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    caption_style: Mapped[str] = mapped_column(String(8), nullable=False, default="bold")
    watermark: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="draft")
    output_key: Mapped[str | None] = mapped_column(String(300))
    output_video_id: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
