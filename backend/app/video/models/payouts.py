from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.video.models._base import created, minor, pk, tenant_fk, updated

SCHEMA = "kv_commerce"


class PayoutAccount(Base):
    __tablename__ = "payout_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_payout_accounts_tenant"),
        CheckConstraint(
            "status IN ('draft','submitted','under_review','needs_clarification','activated','suspended','rejected')",
            name="ck_payout_accounts_status"),
        CheckConstraint(
            "business_type IN ('individual','proprietorship','partnership','private_limited','public_limited','llp','trust','society','ngo')",
            name="ck_payout_accounts_business_type"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    business_type: Mapped[str] = mapped_column(String(20), nullable=False, default="individual")
    legal_name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    pan: Mapped[str | None] = mapped_column(String(10))
    gstin: Mapped[str | None] = mapped_column(String(15))
    address: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    beneficiary_name: Mapped[str | None] = mapped_column(String(120))
    ifsc: Mapped[str | None] = mapped_column(String(11))
    account_number: Mapped[str | None] = mapped_column(Text)
    account_last4: Mapped[str | None] = mapped_column(String(4))
    gateway_account_id: Mapped[str | None] = mapped_column(String(40))
    gateway_stakeholder_id: Mapped[str | None] = mapped_column(String(40))
    gateway_product_id: Mapped[str | None] = mapped_column(String(40))
    requirements: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()


class CreatorSplit(Base):
    __tablename__ = "creator_splits"
    __table_args__ = (
        UniqueConstraint("source_key", name="uq_creator_splits_source"),
        Index("ix_creator_splits_tenant_paid", "tenant_id", "paid_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    source_key: Mapped[str] = mapped_column(String(40), nullable=False)
    purpose: Mapped[str] = mapped_column(String(12), nullable=False)
    checkout_id: Mapped[int | None] = mapped_column(BigInteger)
    payment_id: Mapped[int | None] = mapped_column(BigInteger)
    reference: Mapped[str] = mapped_column(String(40), nullable=False)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    gross_minor: Mapped[int] = minor()
    taxable_minor: Mapped[int] = minor()
    seller_tax_minor: Mapped[int] = minor()
    seller_gstin: Mapped[str | None] = mapped_column(String(15))
    seller_pan: Mapped[str | None] = mapped_column(String(10))
    place_of_supply: Mapped[str | None] = mapped_column(String(2))
    commission_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    commission_minor: Mapped[int] = minor()
    commission_cgst_minor: Mapped[int] = minor()
    commission_sgst_minor: Mapped[int] = minor()
    commission_igst_minor: Mapped[int] = minor()
    tcs_rate_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tcs_cgst_minor: Mapped[int] = minor()
    tcs_sgst_minor: Mapped[int] = minor()
    tcs_igst_minor: Mapped[int] = minor()
    tds_rate_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tds_minor: Mapped[int] = minor()
    reserve_minor: Mapped[int] = minor()
    creator_net_minor: Mapped[int] = minor()
    refunded_minor: Mapped[int] = minor()
    commission_invoice_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = created()

    @property
    def tcs_minor(self) -> int:
        return self.tcs_cgst_minor + self.tcs_sgst_minor + self.tcs_igst_minor

    @property
    def commission_tax_minor(self) -> int:
        return self.commission_cgst_minor + self.commission_sgst_minor + self.commission_igst_minor


class RouteTransfer(Base):
    __tablename__ = "route_transfers"
    __table_args__ = (
        CheckConstraint("kind IN ('sale','reserve','recovery','ad_share','view_pool')", name="ck_route_transfers_kind"),
        CheckConstraint("status IN ('pending','held','released','reversed','recovered','failed')",
                        name="ck_route_transfers_status"),
        Index("uq_route_transfers_split_kind", "split_id", "kind", unique=True,
              postgresql_where="kind IN ('sale','reserve')"),
        Index("ix_route_transfers_release", "status", "hold_until"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    payout_account_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.payout_accounts.id"))
    split_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.creator_splits.id"))
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    amount_minor: Mapped[int] = minor()
    reversed_minor: Mapped[int] = minor()
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    hold_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gateway_transfer_id: Mapped[str | None] = mapped_column(String(40))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recovered_by_id: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(String(200))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()

    @property
    def open_minor(self) -> int:
        return self.amount_minor - self.reversed_minor


class Refund(Base):
    __tablename__ = "refunds"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_refunds_idem"),
        CheckConstraint("status IN ('requested','processed','failed')", name="ck_refunds_status"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    payment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.payments.id"), nullable=False)
    checkout_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    amount_minor: Mapped[int] = minor()
    reason: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="requested")
    gateway_refund_id: Mapped[str | None] = mapped_column(String(80))
    credit_note_id: Mapped[int | None] = mapped_column(BigInteger)
    actor_user_id: Mapped[int | None] = mapped_column(Integer)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class MembershipTier(Base):
    __tablename__ = "membership_tiers"
    __table_args__ = (
        UniqueConstraint("channel_id", "rank", name="uq_membership_tiers_rank"),
        CheckConstraint("rank BETWEEN 1 AND 5", name="ck_membership_tiers_rank"),
        CheckConstraint("price_inr_minor > 0", name="ck_membership_tiers_price"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = pk()
    tenant_id: Mapped[int] = tenant_fk()
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kv_social.channels.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    price_inr_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    perks: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    badge: Mapped[str] = mapped_column(String(16), nullable=False, default="Member", server_default="Member")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
