from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
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
    music: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()


class PublishTarget(Base):
    __tablename__ = "publish_targets"
    __table_args__ = (
        CheckConstraint("platform IN ('youtube','instagram')", name="ck_publish_targets_platform"),
        CheckConstraint("status IN ('scheduled','queued','publishing','published','failed','cancelled')", name="ck_publish_targets_status"),
        UniqueConstraint("clip_id", "platform", name="uq_publish_targets"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    clip_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_studio.clips.id", ondelete="CASCADE"), nullable=False)
    platform: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="queued")
    caption: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    external_id: Mapped[str | None] = mapped_column(String(80))
    external_url: Mapped[str | None] = mapped_column(String(300))
    error: Mapped[str | None] = mapped_column(Text)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()


class MusicTrack(Base):
    __tablename__ = "music_tracks"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    artist: Mapped[str] = mapped_column(String(120), nullable=False)
    mood: Mapped[str] = mapped_column(String(30), nullable=False, default="", server_default="")
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    licence: Mapped[str] = mapped_column(String(120), nullable=False)
    licence_url: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    storage_key: Mapped[str] = mapped_column(String(300), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = created()
