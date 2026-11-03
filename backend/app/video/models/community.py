from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, pk, tenant_fk

SCHEMA = "kv_social"


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (
        CheckConstraint("kind IN ('text','image','poll')", name="ck_posts_kind"),
        CheckConstraint("status IN ('visible','hidden','deleted')", name="ck_posts_status"),
        Index("idx_posts_channel", "channel_id", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.channels.id", ondelete="CASCADE"), nullable=False)
    author_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(6), nullable=False, default="text")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    image_key: Mapped[str | None] = mapped_column(String(300))
    members_rank: Mapped[int | None] = mapped_column(SmallInteger)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="visible")
    created_at: Mapped[datetime] = created()


class PollOption(Base):
    __tablename__ = "poll_options"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    post_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.posts.id", ondelete="CASCADE"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)


class PollVote(Base):
    __tablename__ = "poll_votes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_poll_votes"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    post_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.posts.id", ondelete="CASCADE"), nullable=False)
    option_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.poll_options.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = created()


class ChannelModerator(Base):
    __tablename__ = "channel_moderators"
    __table_args__ = (UniqueConstraint("channel_id", "user_id", name="uq_channel_moderators"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.channels.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    added_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = created()


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (Index("idx_notes_user_video", "user_id", "video_id", "t_ms"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    t_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created()


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"
    __table_args__ = (Index("idx_quiz_attempts_user", "user_id", "video_id"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    study_set_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    answers: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = created()


class LiveMessage(Base):
    __tablename__ = "live_messages"
    __table_args__ = (
        CheckConstraint("kind IN ('chat','superchat','gift')", name="ck_live_messages_kind"),
        CheckConstraint("status IN ('visible','hidden','deleted')", name="ck_live_messages_status"),
        Index("idx_live_messages_stream", "stream_id", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    stream_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.live_streams.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    author_name: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="chat")
    body: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    paid_minor: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    tier: Mapped[str | None] = mapped_column(String(20))
    pinned_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checkout_id: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="visible")
    created_at: Mapped[datetime] = created()
