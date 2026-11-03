from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Computed, DateTime, ForeignKey, Index, Integer, String,
    Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, deleted, pk, tenant_fk, updated

SCHEMA = "kv_media"

STATUSES = ("uploading", "processing", "scanning", "in_review", "published", "blocked", "failed")
VISIBILITY = ("public", "unlisted", "private", "scheduled")


class Video(Base):
    __tablename__ = "videos"
    __table_args__ = (
        CheckConstraint("kind IN ('long','reel')", name="ck_videos_kind"),
        CheckConstraint("source IN ('upload','clip','embed')", name="ck_videos_source"),
        CheckConstraint(
            "status IN ('uploading','processing','scanning','in_review','published','blocked','failed')",
            name="ck_videos_status",
        ),
        CheckConstraint("visibility IN ('public','unlisted','private','scheduled')", name="ck_videos_visibility"),
        Index("idx_videos_feed", "status", "visibility", "published_at"),
        Index("idx_videos_channel", "channel_id", "published_at"),
        Index("idx_videos_search", "search", postgresql_using="gin"),
        UniqueConstraint("provider", "provider_video_id", name="uq_videos_provider_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.channels.id"), nullable=False)
    uploader_user_id: Mapped[int | None] = mapped_column(Integer)
    public_id: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="en", server_default="en")
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="long")
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="upload")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="uploading")
    status_note: Mapped[str | None] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(10), nullable=False, default="public")
    publish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    provider: Mapped[str | None] = mapped_column(String(12))
    provider_video_id: Mapped[str | None] = mapped_column(String(80))
    source_key: Mapped[str | None] = mapped_column(String(300))
    thumbnail_key: Mapped[str | None] = mapped_column(String(300))
    thumbnail_ideas: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    rights_declared: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    rights_note: Mapped[str | None] = mapped_column(Text)
    source_clip_id: Mapped[int | None] = mapped_column(BigInteger)
    embed_platform: Mapped[str | None] = mapped_column(String(12))
    embed_external_id: Mapped[str | None] = mapped_column(String(80))
    embed_url: Mapped[str | None] = mapped_column(String(500))
    embed_owner_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    ai_status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending", server_default="pending")
    view_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    like_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    comment_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    danmaku_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    watch_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    completions: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    search = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))", persisted=True),
    )
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
    is_deleted: Mapped[bool] = deleted()


class CaptionTrack(Base):
    __tablename__ = "caption_tracks"
    __table_args__ = (
        UniqueConstraint("video_id", "language", "source", name="uq_caption_tracks"),
        CheckConstraint("source IN ('ai','creator','youtube','translation')", name="ck_caption_tracks_source"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False, index=True)
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    source: Mapped[str] = mapped_column(String(12), nullable=False)
    vtt: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
