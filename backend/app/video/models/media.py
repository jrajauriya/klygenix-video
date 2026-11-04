from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Computed, DateTime, ForeignKey, Index, Integer, SmallInteger, String,
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
        CheckConstraint("access IN ('free','members','paid')", name="ck_videos_access"),
        CheckConstraint("access <> 'paid' OR price_inr_minor > 0", name="ck_videos_paid_price"),
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
    access: Mapped[str] = mapped_column(String(8), nullable=False, default="free", server_default="free")
    price_inr_minor: Mapped[int | None] = mapped_column(Integer)
    members_rank: Mapped[int | None] = mapped_column(SmallInteger)
    preview_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60, server_default="60")
    dubbing_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    ads_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    sponsor_deal_id: Mapped[int | None] = mapped_column(BigInteger)
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


class ProductLink(Base):
    __tablename__ = "product_links"
    __table_args__ = (Index("idx_product_links_video", "video_id", "position"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    price_text: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default="")
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    clicks: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = created()


class DubTrack(Base):
    __tablename__ = "dub_tracks"
    __table_args__ = (
        CheckConstraint("status IN ('queued','ready','failed')", name="ck_dub_tracks_status"),
        UniqueConstraint("video_id", "language", name="uq_dub_tracks"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="queued")
    voice: Mapped[str] = mapped_column(String(60), nullable=False, default="", server_default="")
    model: Mapped[str] = mapped_column(String(60), nullable=False, default="", server_default="")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()


class LiveStream(Base):
    __tablename__ = "live_streams"
    __table_args__ = (
        CheckConstraint("status IN ('scheduled','live','ended','failed')", name="ck_live_streams_status"),
        UniqueConstraint("public_id", name="uq_live_streams_public_id"),
        Index("idx_live_streams_status", "status", "started_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.channels.id", ondelete="CASCADE"), nullable=False)
    public_id: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="scheduled")
    provider: Mapped[str] = mapped_column(String(12), nullable=False, default="sandbox")
    provider_ref: Mapped[str | None] = mapped_column(String(80))
    replay_ref: Mapped[str | None] = mapped_column(String(80))
    ingest_port: Mapped[int | None] = mapped_column(Integer)
    stream_key: Mapped[str] = mapped_column(Text, nullable=False)
    stream_key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    slow_mode_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    members_rank: Mapped[int | None] = mapped_column(SmallInteger)
    replay_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    replay_video_id: Mapped[int | None] = mapped_column(BigInteger)
    peak_viewers: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
