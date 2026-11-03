from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, minor, pk, tenant_fk, updated

SCHEMA = "kv_commerce"


class Plan(Base):
    __tablename__ = "plans"
    __table_args__ = (
        CheckConstraint("audience IN ('viewer','creator')", name="ck_plans_audience"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    audience: Mapped[str] = mapped_column(String(8), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price_inr_minor: Mapped[int] = minor()
    price_usd_minor: Mapped[int] = minor()
    limits: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Checkout(Base):
    __tablename__ = "checkouts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_checkouts_idem"),
        UniqueConstraint("gateway_order_id", name="uq_checkouts_gateway_order"),
        CheckConstraint("status IN ('created','paid','failed','expired')", name="ck_checkouts_status"),
        CheckConstraint("purpose IN ('plan','tip','boost','membership','video','series')", name="ck_checkouts_purpose"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    purpose: Mapped[str] = mapped_column(String(10), nullable=False, default="plan")
    plan_key: Mapped[str | None] = mapped_column(String(30))
    target: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    taxable_minor: Mapped[int] = minor()
    tax_minor: Mapped[int] = minor()
    amount_minor: Mapped[int] = minor()
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="IN")
    state_code: Mapped[str | None] = mapped_column(String(2))
    rail: Mapped[str] = mapped_column(String(14), nullable=False)
    gateway_order_id: Mapped[str] = mapped_column(String(80), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="created")
    created_at: Mapped[datetime] = created()
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (UniqueConstraint("checkout_id", name="uq_payments_checkout"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    checkout_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_commerce.checkouts.id"), nullable=False)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(80))
    amount_minor: Mapped[int] = minor()
    fee_minor: Mapped[int] = minor()
    tax_on_fee_minor: Mapped[int] = minor()
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    method: Mapped[str | None] = mapped_column(String(20))
    invoice_id: Mapped[int | None] = mapped_column(BigInteger)
    journal_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = created()


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint("status IN ('active','grace','lapsed','cancelled')", name="ck_subscriptions_status"),
        Index("idx_subscriptions_user", "user_id", "status"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    plan_key: Mapped[str] = mapped_column(String(30), nullable=False)
    audience: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active")
    rail: Mapped[str] = mapped_column(String(14), nullable=False)
    gateway_subscription_id: Mapped[str | None] = mapped_column(String(80))
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()


class Entitlement(Base):
    __tablename__ = "entitlements"
    __table_args__ = (
        CheckConstraint("kind IN ('plan','membership','video')", name="ck_entitlements_kind"),
        CheckConstraint("source IN ('payment','grant','renewal')", name="ck_entitlements_source"),
        Index("idx_entitlements_user", "user_id", "kind", "ref"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    ref: Mapped[str] = mapped_column(String(40), nullable=False)
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    source_id: Mapped[int | None] = mapped_column(BigInteger)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = created()


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("user_id", "metric", "period", name="uq_usage_counters"), {"schema": SCHEMA})

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    metric: Mapped[str] = mapped_column(String(16), nullable=False)
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    used: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    reserved: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class ProviderEvent(Base):
    __tablename__ = "provider_events"
    __table_args__ = (
        UniqueConstraint("rail", "event_id", name="uq_provider_events"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int | None] = mapped_column(Integer, index=True)
    rail: Mapped[str] = mapped_column(String(20), nullable=False)
    event_id: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    signature_ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    received_at: Mapped[datetime] = created()
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text)
