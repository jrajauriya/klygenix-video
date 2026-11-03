from __future__ import annotations

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger, CheckConstraint, Computed, DateTime, Float, ForeignKey, Index, Integer, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base
from app.video.models._base import created, minor, pk, tenant_fk

SCHEMA = "kv_ai"


class Transcript(Base):
    __tablename__ = "transcripts"
    __table_args__ = (
        CheckConstraint("source IN ('stt','captions')", name="ck_transcripts_source"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False, index=True)
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=True)
    edited: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = created()


class Segment(Base):
    __tablename__ = "segments"
    __table_args__ = (
        Index("idx_segments_video", "video_id", "start_ms"),
        Index("idx_segments_search", "search", postgresql_using="gin"),
        Index(
            "idx_segments_embedding", "embedding", postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    transcript_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_ai.transcripts.id", ondelete="CASCADE"), nullable=False, index=True)
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    start_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding = mapped_column(Vector(settings.EMBED_DIM))
    search = mapped_column(TSVECTOR, Computed("to_tsvector('simple', text)", persisted=True))


class Insight(Base):
    __tablename__ = "insights"
    __table_args__ = (Index("idx_insights_video", "video_id", "language"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    key_points: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    chapters: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    title_ideas: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    hashtags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    model: Mapped[str] = mapped_column(String(60), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = created()


class ClipSuggestion(Base):
    __tablename__ = "clip_suggestions"
    __table_args__ = (Index("idx_clip_suggestions_video", "video_id", "score"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    start_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    hook: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = created()


class AskMessage(Base):
    __tablename__ = "ask_messages"
    __table_args__ = (
        CheckConstraint("status IN ('answered','declined','failed')", name="ck_ask_messages_status"),
        Index("idx_ask_messages_user", "user_id", "video_id", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    video_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_media.videos.id", ondelete="CASCADE"), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    model: Mapped[str] = mapped_column(String(60), nullable=False)
    created_at: Mapped[datetime] = created()


class AiJob(Base):
    __tablename__ = "ai_jobs"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('transcribe','insights','embed','translate','clips','ask','render','scan','drafts')",
            name="ck_ai_jobs_kind",
        ),
        CheckConstraint("status IN ('queued','running','done','failed','skipped')", name="ck_ai_jobs_status"),
        Index("idx_ai_jobs_video", "video_id", "kind"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    video_id: Mapped[int | None] = mapped_column(BigInteger)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="queued")
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    units: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    units_kind: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    cost_minor: Mapped[int] = minor()
    error: Mapped[str | None] = mapped_column(Text)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = created()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LlmCall(Base):
    __tablename__ = "llm_calls"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ok','error','refused','budget','retry','paused')", name="ck_llm_calls_status"
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int | None] = mapped_column(Integer, index=True)
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    model: Mapped[str] = mapped_column(String(60), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_minor: Mapped[int] = minor()
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
