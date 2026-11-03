from datetime import date, datetime, timezone
from sqlalchemy import BigInteger, String, Boolean, Integer, Date, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    """Timezone-aware UTC. datetime.utcnow() is naive and deprecated."""
    return datetime.now(timezone.utc)


class Tenant(Base):
    __tablename__ = "tenants"
    __table_args__ = {"schema": "kv_admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    plan: Mapped[str] = mapped_column(String(50), default="standard")
    gst_number: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    pin_code: Mapped[str | None] = mapped_column(String(10))
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(200))
    logo_url: Mapped[str | None] = mapped_column(String(500))
    primary_color: Mapped[str | None] = mapped_column(String(20))
    max_users: Mapped[int] = mapped_column(Integer, default=5)
    license_start: Mapped[date] = mapped_column(Date, default=date.today)
    license_end: Mapped[date] = mapped_column(Date)
    amc_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    require_totp: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    users = relationship("User", back_populates="tenant")
    modules = relationship("TenantModule", back_populates="tenant")
    payments = relationship("TenantPayment", back_populates="tenant")
    features = relationship("TenantFeature", back_populates="tenant", cascade="all, delete-orphan")


class TenantModule(Base):
    __tablename__ = "tenant_modules"
    __table_args__ = {"schema": "kv_admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("kv_admin.tenants.id"), index=True)
    module_name: Mapped[str] = mapped_column(String(50), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    tenant = relationship("Tenant", back_populates="modules")


class TenantPayment(Base):
    __tablename__ = "tenant_payments"
    __table_args__ = {"schema": "kv_admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("kv_admin.tenants.id"), index=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_type: Mapped[str] = mapped_column(String(20), nullable=False)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    method: Mapped[str | None] = mapped_column(String(50))
    reference: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    tenant = relationship("Tenant", back_populates="payments")


class CustomField(Base):
    __tablename__ = "custom_fields"
    __table_args__ = {"schema": "kv_admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("kv_admin.tenants.id"), index=True)
    module_name: Mapped[str] = mapped_column(String(50), nullable=False)
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    field_label: Mapped[str] = mapped_column(String(200), nullable=False)
    field_type: Mapped[str] = mapped_column(String(20), nullable=False)
    options: Mapped[dict | None] = mapped_column(JSONB)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
