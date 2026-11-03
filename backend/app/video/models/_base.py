"""Shared column helpers for the Store models (§17 conventions).

Money is BIGINT minor units beside its currency; timestamps are TIMESTAMPTZ in UTC; every
tenant table carries `tenant_id` and is soft-deleted, except the ledger.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def tenant_fk() -> Mapped[int]:
    return mapped_column(
        Integer, ForeignKey("kv_admin.tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )


def pk() -> Mapped[int]:
    return mapped_column(BigInteger, primary_key=True, autoincrement=True)


def created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


def updated() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


def deleted() -> Mapped[bool]:
    return mapped_column(Boolean, nullable=False, default=False, server_default="false")


def minor(default: int | None = 0, nullable: bool = False) -> Mapped[int]:
    if default is None:
        return mapped_column(BigInteger, nullable=nullable)
    return mapped_column(BigInteger, nullable=nullable, default=default, server_default=str(default))
