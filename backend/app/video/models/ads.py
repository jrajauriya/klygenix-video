from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, Index, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, minor, pk, tenant_fk, updated

SCHEMA = "kv_commerce"


class BrandProfile(Base):
    __tablename__ = "brand_profiles"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_brand_profiles_tenant"),
        CheckConstraint("status IN ('active','suspended')", name="ck_brand_profiles_status"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    website: Mapped[str | None] = mapped_column(String(300))
    gstin: Mapped[str | None] = mapped_column(String(15))
    state_code: Mapped[str | None] = mapped_column(String(2))
    contact_email: Mapped[str] = mapped_column(String(200), nullable=False)
    about: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active")
    created_at: Mapped[datetime] = created()


class AdCampaign(Base):
    __tablename__ = "ad_campaigns"
    __table_args__ = (
        UniqueConstraint("public_id", name="uq_ad_campaigns_public_id"),
        CheckConstraint("status IN ('draft','review','active','paused','rejected','ended')", name="ck_ad_campaigns_status"),
        CheckConstraint("cpm_minor > 0", name="ck_ad_campaigns_cpm"),
        Index("idx_ad_campaigns_status", "status", "start_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    public_id: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="draft")
    creative_video_id: Mapped[int | None] = mapped_column(BigInteger)
    click_url: Mapped[str] = mapped_column(String(500), nullable=False)
    cpm_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    budget_minor: Mapped[int] = minor()
    spent_minor: Mapped[int] = minor()
    accrued_minor: Mapped[int] = minor()
    refunded_minor: Mapped[int] = minor()
    daily_cap_minor: Mapped[int | None] = mapped_column(BigInteger)
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    targeting: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    skip_after_seconds: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=5, server_default="5")
    review_note: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[int | None] = mapped_column(Integer)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()


class AdDaily(Base):
    __tablename__ = "ad_daily"
    __table_args__ = (
        UniqueConstraint("campaign_id", "video_id", "day", name="uq_ad_daily"),
        Index("idx_ad_daily_channel", "channel_tenant_id", "day"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    campaign_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    channel_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    impressions: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    completes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    skips: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    clicks: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    spend_minor: Mapped[int] = minor()


class AdPayout(Base):
    __tablename__ = "ad_payouts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "period", name="uq_ad_payouts_period"),
        CheckConstraint("status IN ('pending','released','failed','skipped')", name="ck_ad_payouts_status"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    impressions: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    spend_minor: Mapped[int] = minor()
    share_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    share_minor: Mapped[int] = minor()
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="pending")
    route_transfer_id: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = created()


class SponsorBrief(Base):
    __tablename__ = "sponsor_briefs"
    __table_args__ = (
        UniqueConstraint("public_id", name="uq_sponsor_briefs_public_id"),
        CheckConstraint("deliverable IN ('dedicated','integration','reel','post')", name="ck_sponsor_briefs_deliverable"),
        CheckConstraint("status IN ('open','closed','cancelled')", name="ck_sponsor_briefs_status"),
        Index("idx_sponsor_briefs_open", "status", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    public_id: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    deliverable: Mapped[str] = mapped_column(String(12), nullable=False)
    budget_min_minor: Mapped[int] = minor()
    budget_max_minor: Mapped[int] = minor()
    languages: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    min_followers: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    deadline: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")
    created_at: Mapped[datetime] = created()


class SponsorApplication(Base):
    __tablename__ = "sponsor_applications"
    __table_args__ = (
        UniqueConstraint("brief_id", "channel_id", name="uq_sponsor_applications"),
        CheckConstraint("status IN ('applied','accepted','declined','withdrawn')", name="ck_sponsor_applications_status"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    brief_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    channel_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    pitch: Mapped[str] = mapped_column(Text, nullable=False)
    quote_minor: Mapped[int] = minor()
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="applied")
    created_at: Mapped[datetime] = created()


class SponsorDeal(Base):
    __tablename__ = "sponsor_deals"
    __table_args__ = (
        UniqueConstraint("public_id", name="uq_sponsor_deals_public_id"),
        CheckConstraint("status IN ('proposed','funded','delivered','approved','disputed','refunded','cancelled')",
                        name="ck_sponsor_deals_status"),
        Index("idx_sponsor_deals_channel", "channel_tenant_id", "status"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    public_id: Mapped[str] = mapped_column(String(16), nullable=False)
    brief_id: Mapped[int | None] = mapped_column(BigInteger)
    application_id: Mapped[int | None] = mapped_column(BigInteger)
    channel_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    channel_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    deliverables: Mapped[str] = mapped_column(Text, nullable=False)
    price_minor: Mapped[int] = minor()
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="proposed")
    checkout_id: Mapped[int | None] = mapped_column(BigInteger)
    split_id: Mapped[int | None] = mapped_column(BigInteger)
    video_id: Mapped[int | None] = mapped_column(BigInteger)
    funded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approve_by: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    auto_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    dispute_reason: Mapped[str | None] = mapped_column(Text)
    resolution_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
