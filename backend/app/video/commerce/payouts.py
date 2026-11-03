from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.services import secrets as sealed
from app.video.models.payouts import PayoutAccount
from app.video.rails.base import RailError
from app.core.messages import err, refused

PAN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
GSTIN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
IFSC = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PHONE = re.compile(r"^\+?[0-9]{10,13}$")
PIN = re.compile(r"^[1-9][0-9]{5}$")
EDITABLE = ("draft", "needs_clarification", "rejected")

FIELDS = ("business_type", "legal_name", "contact_name", "email", "phone", "pan", "gstin", "address",
          "beneficiary_name", "ifsc")


def out(a: PayoutAccount | None) -> dict | None:
    if a is None:
        return None
    return {"status": a.status, "business_type": a.business_type, "legal_name": a.legal_name,
            "contact_name": a.contact_name, "email": a.email, "phone": a.phone, "pan": a.pan, "gstin": a.gstin,
            "address": a.address or {}, "beneficiary_name": a.beneficiary_name, "ifsc": a.ifsc,
            "account_last4": a.account_last4, "requirements": a.requirements or [],
            "gateway_account_id": a.gateway_account_id,
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
            "activated_at": a.activated_at.isoformat() if a.activated_at else None,
            "editable": a.status in EDITABLE}


def save(db: Session, tenant_id: int, data: dict) -> PayoutAccount:
    a = db.execute(select(PayoutAccount).where(PayoutAccount.tenant_id == tenant_id)).scalars().first()
    if a is not None and a.status not in EDITABLE:
        raise err(409, "payout_details_with_gateway_checking_cannot")
    if a is None:
        a = PayoutAccount(tenant_id=tenant_id, legal_name="", contact_name="", email="", phone="")
        db.add(a)
    for f in FIELDS:
        if f in data and data[f] is not None:
            v = data[f]
            if isinstance(v, str):
                v = v.strip()
                if f in ("pan", "gstin", "ifsc"):
                    v = v.upper() or None
            setattr(a, f, v if v != "" else None if f in ("pan", "gstin", "beneficiary_name", "ifsc") else v)
    number = (data.get("account_number") or "").replace(" ", "")
    if number:
        if not number.isdigit() or not 6 <= len(number) <= 20:
            raise err(400, "bank_account_number_does_not_look")
        a.account_number = sealed.seal(number)
        a.account_last4 = number[-4:]
    db.flush()
    return a


def problems(a: PayoutAccount) -> list[str]:
    p = []
    if len(a.legal_name or "") < 3:
        p.append("Enter your legal name as on your PAN.")
    if len(a.contact_name or "") < 3:
        p.append("Enter a contact name.")
    if "@" not in (a.email or ""):
        p.append("Enter an email address.")
    if not PHONE.match(a.phone or ""):
        p.append("Enter a 10-digit mobile number.")
    if not PAN.match(a.pan or ""):
        p.append("Enter a valid PAN (like ABCDE1234F).")
    if a.gstin and not GSTIN.match(a.gstin):
        p.append("That GSTIN does not look right — leave it empty if you are not registered.")
    if a.gstin and a.pan and a.gstin[2:12] != a.pan:
        p.append("Your GSTIN should contain your PAN.")
    addr = a.address or {}
    if not addr.get("street1") or not addr.get("city") or not addr.get("state"):
        p.append("Enter your address, city and state.")
    if not PIN.match(str(addr.get("postal_code") or "")):
        p.append("Enter a 6-digit PIN code.")
    if not IFSC.match(a.ifsc or ""):
        p.append("Enter your bank's IFSC (like HDFC0001234).")
    if not a.account_number:
        p.append("Enter your bank account number.")
    if len(a.beneficiary_name or "") < 3:
        p.append("Enter the name on the bank account.")
    return p


def submit(db: Session, tenant_id: int) -> PayoutAccount:
    from app.video.rails.route import route_client

    a = db.execute(select(PayoutAccount).where(PayoutAccount.tenant_id == tenant_id)).scalars().first()
    if a is None:
        raise err(404, "fill_payout_details_first")
    if a.status not in EDITABLE:
        raise err(409, "payout_details_already_with_gateway")
    issues = problems(a)
    if issues:
        raise refused(400, " ".join(issues))
    route = route_client()
    try:
        if not a.gateway_account_id:
            la = route.create_account(a)
            a.gateway_account_id, a.gateway_stakeholder_id, a.gateway_product_id = la.account_id, la.stakeholder_id, la.product_id
        la = route.submit_bank(a, sealed.resolve(a.account_number))
    except RailError as exc:
        raise refused(502, str(exc))
    _apply(a, la.status, la.requirements)
    a.submitted_at = datetime.now(timezone.utc)
    db.flush()
    return a


def refresh(db: Session, a: PayoutAccount, strict: bool = False) -> PayoutAccount:
    from app.video.rails.route import route_client

    if not a.gateway_account_id or not a.gateway_product_id:
        return a
    try:
        la = route_client().status(a)
    except RailError as exc:
        if strict:
            raise refused(502, str(exc))
        return a
    _apply(a, la.status, la.requirements)
    db.flush()
    return a


def _apply(a: PayoutAccount, status: str, requirements: list) -> None:
    a.status = status
    a.requirements = requirements or []
    if status == "activated" and a.activated_at is None:
        a.activated_at = datetime.now(timezone.utc)


def refresh_waiting(db: Session) -> int:
    n = 0
    for a in db.execute(select(PayoutAccount).where(PayoutAccount.status.in_(("submitted", "under_review")))).scalars().all():
        before = a.status
        refresh(db, a)
        n += a.status != before
    return n
