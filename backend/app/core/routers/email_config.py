"""SMTP configuration, per tenant and platform-wide.

A tenant with no row of its own falls back to the global one. Without either, a dunning
run defers its email rather than failing, so this screen is the difference between a
ladder that previews forever and one that sends.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.middleware.auth import require_admin_tenant
from app.core.models.email_config import EmailConfig
from app.core.models.user import User
from app.core.services import email_service, secrets
from app.database import get_db

router = APIRouter(prefix="/api/admin/email-configs", tags=["admin-email"])


class EmailConfigIn(BaseModel):
    config_type: str = "global"
    tenant_id: int | None = None
    smtp_host: str
    smtp_port: int = 587
    smtp_username: str
    smtp_password: str | None = None
    from_email: str
    from_name: str = "Klygenix"
    use_tls: bool = True
    is_active: bool = True


class EmailConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    config_type: str
    tenant_id: int | None
    smtp_host: str
    smtp_port: int
    smtp_username: str
    from_email: str
    from_name: str
    use_tls: bool
    is_active: bool
    has_password: bool = False
    created_at: datetime | None
    updated_at: datetime | None


class TestIn(BaseModel):
    recipient: str


def _attribute(db: Session, user: User) -> None:
    """These routes run on a plain session, so the audit trail has neither the tenant
    nor the actor unless they are put there. A rotated SMTP password with nobody's name
    on it is the thing §22 exists to prevent."""
    audit.attribute(
        db,
        tenant_id=user.tenant_id,
        actor=audit.Actor(audit.USER, user_id=user.id, label=user.email),
    )


def _out(row: EmailConfig) -> EmailConfigOut:
    payload = EmailConfigOut.model_validate(row)
    return payload.model_copy(update={"has_password": bool(row.smtp_password)})


@router.get("", response_model=list[EmailConfigOut])
def list_configs(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.email")),
):
    rows = db.execute(select(EmailConfig).order_by(EmailConfig.id)).scalars().all()
    return [_out(row) for row in rows]


@router.post("", response_model=EmailConfigOut, status_code=201)
def create_config(
    data: EmailConfigIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin_tenant("admin.email", "full")),
):
    _attribute(db, user)
    row = EmailConfig(**data.model_dump(exclude={"smtp_password"}))
    if data.smtp_password:
        row.smtp_password = secrets.encrypt(data.smtp_password)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.patch("/{config_id}", response_model=EmailConfigOut)
def update_config(
    config_id: int,
    data: EmailConfigIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin_tenant("admin.email", "full")),
):
    _attribute(db, user)
    row = db.get(EmailConfig, config_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")

    for field, value in data.model_dump(exclude={"smtp_password"}).items():
        setattr(row, field, value)
    if data.smtp_password:
        row.smtp_password = secrets.encrypt(data.smtp_password)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.delete("/{config_id}")
def delete_config(
    config_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin_tenant("admin.email", "full")),
):
    _attribute(db, user)
    row = db.get(EmailConfig, config_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(row)
    db.commit()
    return {"success": True}


@router.post("/{config_id}/test")
def test_config(
    config_id: int,
    data: TestIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.email")),
):
    """Send one message, to an address the operator names."""
    row = db.get(EmailConfig, config_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        ok = email_service.test_smtp_connection(row, data.recipient)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)[:200])
    return {"success": bool(ok)}
