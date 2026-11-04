from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.models.tenant import Tenant
from app.video.models.ledger import Account
from app.video.models.social import Channel
from app.video.services.text import is_valid_handle, slugify

CHART = [
    ("1100", "Bank", "asset", "bank"),
    ("1200", "Gateway clearing", "asset", "gateway_clearing"),
    ("1300", "GST input credit", "asset", "tax_input"),
    ("1400", "Payouts on the way", "asset", "payout_clearing"),
    ("1500", "TCS credit", "asset", "tcs_receivable"),
    ("1510", "TDS credit", "asset", "tds_receivable"),
    ("2100", "CGST output", "liability", "tax_output_cgst"),
    ("2110", "SGST output", "liability", "tax_output_sgst"),
    ("2120", "IGST output", "liability", "tax_output_igst"),
    ("2400", "Refunds payable", "liability", "refunds_payable"),
    ("2500", "Owed to creators", "liability", "seller_payable"),
    ("2510", "Creator reserve", "liability", "seller_reserve"),
    ("2600", "TCS payable", "liability", "tcs_payable"),
    ("2610", "TDS payable", "liability", "tds_payable"),
    ("2700", "Unearned advertising", "liability", "ad_unearned"),
    ("3100", "Retained earnings", "equity", "retained_earnings"),
    ("4100", "Subscription revenue", "income", "sales"),
    ("4200", "Platform commission", "income", "commission_income"),
    ("4300", "Advertising revenue", "income", "ad_income"),
    ("4400", "Ad revenue share", "income", "ad_share_income"),
    ("5100", "Gateway fees", "expense", "gateway_fees"),
    ("5200", "Platform commission", "expense", "commission_expense"),
    ("5300", "Creators' ad revenue share", "expense", "ad_share_expense"),
]


def free_handle(db: Session, wanted: str) -> str:
    base = slugify(wanted, "channel")[:34]
    if not is_valid_handle(base):
        base = f"{base}-tv" if base else "channel"
    handle, n = base, 1
    from app.video.services import handles

    while handles.taken(db, handle):
        n += 1
        handle = f"{base}-{n}"
    return handle


def ensure_books(db: Session, tenant_id: int) -> None:
    have = set(db.execute(select(Account.role).where(Account.tenant_id == tenant_id)).scalars().all())
    for code, name, typ, role in CHART:
        if role not in have:
            db.add(Account(tenant_id=tenant_id, code=code, name=name, type=typ, role=role, currency="INR"))
    db.flush()


def provision(db: Session, tenant: Tenant) -> None:
    db.flush()


def open_channel(db: Session, tenant: Tenant, *, name: str, handle: str | None = None, language: str = "en",
                 country: str = "IN") -> Channel:
    channel = db.execute(select(Channel).where(Channel.tenant_id == tenant.id)).scalars().first()
    if channel is not None:
        return channel
    channel = Channel(
        tenant_id=tenant.id, handle=handle or free_handle(db, name or tenant.slug), name=name or tenant.name,
        language=language, country=country,
    )
    db.add(channel)
    db.flush()
    return channel


def provision_admin_tenant(db: Session) -> None:
    from app.video.sessions import bind_tenant

    tenant = db.execute(select(Tenant).where(Tenant.slug == settings.ADMIN_TENANT_SLUG)).scalars().first()
    if tenant is None:
        return
    bind_tenant(db, tenant.id)
    ensure_books(db, tenant.id)
    channel = open_channel(db, tenant, name="Klygenix", handle=settings.ADMIN_CHANNEL_HANDLE)
    if not channel.about:
        channel.about = "Official channel of Klygenix Play."
    db.commit()
