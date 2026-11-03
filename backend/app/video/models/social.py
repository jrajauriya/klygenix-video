from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, SmallInteger,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, pk, tenant_fk, updated

SCHEMA = "kv_social"


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = ({"schema": SCHEMA},)

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("kv_admin.users.id", ondelete="CASCADE"), primary_key=True)
    tenant_id: Mapped[int] = tenant_fk()
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    birth_date: Mapped[date | None] = mapped_column(Date)
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="IN")
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="en")
    danmaku_prefs: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()


class Channel(Base):
    __tablename__ = "channels"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_channels_tenant"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    handle: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    about: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    avatar_key: Mapped[str | None] = mapped_column(String(300))
    banner_key: Mapped[str | None] = mapped_column(String(300))
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="en")
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="IN")
    follower_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    video_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    strike_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0")
    is_suspended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    reviewed_uploads: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()


class ConnectedChannel(Base):
    __tablename__ = "connected_channels"
    __table_args__ = (
        UniqueConstraint("platform", "external_channel_id", name="uq_connected_channels"),
        CheckConstraint("platform IN ('youtube','bilibili','instagram')", name="ck_connected_channels_platform"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.channels.id", ondelete="CASCADE"), nullable=False)
    platform: Mapped[str] = mapped_column(String(10), nullable=False)
    external_channel_id: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    access_token: Mapped[str | None] = mapped_column(Text)
    refresh_token: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("user_id", "channel_id", name="uq_follows"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.channels.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = created()


class Like(Base):
    __tablename__ = "likes"
    __table_args__ = (UniqueConstraint("user_id", "video_id", name="uq_likes"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = created()


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (
        CheckConstraint("status IN ('visible','hidden','deleted')", name="ck_comments_status"),
        Index("idx_comments_video", "video_id", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    author_name: Mapped[str] = mapped_column(String(80), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("kv_social.comments.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="visible")
    report_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0")
    paid_minor: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    checkout_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = created()


class Danmaku(Base):
    __tablename__ = "danmaku"
    __table_args__ = (
        CheckConstraint("mode IN ('scroll','top','bottom')", name="ck_danmaku_mode"),
        CheckConstraint("status IN ('visible','hidden','deleted')", name="ck_danmaku_status"),
        CheckConstraint("char_length(text) <= 60", name="ck_danmaku_len"),
        Index("idx_danmaku_video_t", "video_id", "t_ms"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    t_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    text: Mapped[str] = mapped_column(String(60), nullable=False)
    mode: Mapped[str] = mapped_column(String(6), nullable=False, default="scroll")
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#FFFFFF")
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="visible")
    report_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0")
    paid_minor: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    boost_tier: Mapped[int | None] = mapped_column(SmallInteger)
    pin_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    checkout_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = created()


class Playlist(Base):
    __tablename__ = "playlists"
    __table_args__ = (
        CheckConstraint("kind IN ('playlist','series')", name="ck_playlists_kind"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.channels.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="playlist")
    visibility: Mapped[str] = mapped_column(String(10), nullable=False, default="public")
    price_inr_minor: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = created()


class PlaylistItem(Base):
    __tablename__ = "playlist_items"
    __table_args__ = (UniqueConstraint("playlist_id", "video_id", name="uq_playlist_items"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    playlist_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.playlists.id", ondelete="CASCADE"), nullable=False)
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class WatchProgress(Base):
    __tablename__ = "watch_progress"
    __table_args__ = (UniqueConstraint("user_id", "video_id", name="uq_watch_progress"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    position_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = updated()


class ViewDaily(Base):
    __tablename__ = "view_daily"
    __table_args__ = (UniqueConstraint("video_id", "day", name="uq_view_daily"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    views: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    watch_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    completions: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    likes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    retention: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    sources: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")


class DeviceToken(Base):
    __tablename__ = "device_tokens"
    __table_args__ = (
        CheckConstraint("platform IN ('ios','android','web')", name="ck_device_tokens_platform"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("kv_admin.users.id", ondelete="CASCADE"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    platform: Mapped[str] = mapped_column(String(8), nullable=False)
    created_at: Mapped[datetime] = created()
    last_seen_at: Mapped[datetime] = updated()


class PushMessage(Base):
    __tablename__ = "push_messages"
    __table_args__ = (
        CheckConstraint("status IN ('sent','failed','skipped')", name="ck_push_messages_status"),
        UniqueConstraint("dedupe_key", name="uq_push_messages_dedupe"),
        Index("idx_push_messages_user", "user_id", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(String(300), nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    dedupe_key: Mapped[str | None] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
