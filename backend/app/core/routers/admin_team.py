import secrets

from fastapi import APIRouter, Depends, HTTPException
from typing import Literal
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.config import settings
from app.database import get_db
from app.core.models.user import User
from app.core.models.tenant import Tenant
from app.core.middleware.auth import get_current_user, require_admin_tenant
from app.core.services.auth_service import hash_password
from app.core.services.email_service import send_email
from app.core.services.welcome_email import build_welcome_html

router = APIRouter(prefix="/api/admin/team", tags=["admin-team"])


class AdminTeamMemberCreate(BaseModel):
    email: str
    name: str
    role: Literal["admin", "user"] = "user"
    products: list[str] = ["video"]
    phone: str | None = None


class AdminTeamMemberUpdate(BaseModel):
    name: str | None = None
    role: Literal["admin", "user"] | None = None
    products: list[str] | None = None
    is_active: bool | None = None
    phone: str | None = None


class AdminTeamMemberResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    is_active: bool
    products: list[str]
    phone: str | None = None

    model_config = {"from_attributes": True}


class TeamInfoOut(BaseModel):
    max_users: int
    current_count: int


class TeamMemberAddedOut(BaseModel):
    id: int
    name: str
    email: str
    welcome_email_sent: bool
    message: str


class TeamMemberChangedOut(BaseModel):
    ok: bool
    message: str


def _get_admin_tenant(db: Session) -> Tenant:
    tenant = db.query(Tenant).filter(Tenant.slug == settings.ADMIN_TENANT_SLUG).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Admin tenant not found")
    return tenant


@router.get("/info", response_model=TeamInfoOut)
def team_info(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.team")),
):
    tenant = _get_admin_tenant(db)
    current_count = (
        db.query(func.count(User.id))
        .filter(User.tenant_id == tenant.id, User.is_active == True)
        .scalar()
    )
    return {
        "max_users": tenant.max_users or 50,
        "current_count": current_count or 0,
    }


@router.get("", response_model=list[AdminTeamMemberResponse])
def list_team_members(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.team")),
):
    tenant = _get_admin_tenant(db)
    members = (
        db.query(User)
        .filter(
            User.tenant_id == tenant.id,
            User.role != "global_admin",
        )
        .order_by(User.name)
        .all()
    )
    return [AdminTeamMemberResponse.model_validate(m) for m in members]


@router.post("", response_model=TeamMemberAddedOut, status_code=201)
def add_team_member(
    data: AdminTeamMemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_tenant("admin.team", "full")),
):
    tenant = _get_admin_tenant(db)

    # Check email uniqueness
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        # 409, not 400: the request is well-formed and a rule declines it.
        raise HTTPException(status_code=409, detail="That email already has an account")

    # Generated, never chosen here and never defaulted. A console operator created with
    # a password this code knows is a predictable credential on the platform console.
    plaintext_password = secrets.token_urlsafe(8)

    new_user = User(
        tenant_id=tenant.id,
        email=data.email,
        name=data.name,
        password_hash=hash_password(plaintext_password),
        role=data.role,
        products=data.products,
        phone=data.phone,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    sent = True
    try:
        html = build_welcome_html(
            user_name=new_user.name,
            email=new_user.email,
            password=plaintext_password,
            login_url=settings.APP_LOGIN_URL,
            tenant_name=tenant.name,
            products=data.products,
        )
        send_email(
            db=db,
            to_email=new_user.email,
            subject="Welcome",
            body_html=html,
            tenant_name=tenant.name,
            cc_emails=[current_user.email, settings.SMTP_FROM_EMAIL],
        )
    except Exception:  # noqa: BLE001 — the account is made; the email is the part that failed
        sent = False

    return TeamMemberAddedOut(
        id=new_user.id,
        name=new_user.name,
        email=new_user.email,
        welcome_email_sent=sent,
        message=(
            f"{new_user.name} added, and their password is on its way to {new_user.email}"
            if sent
            else f"{new_user.name} added, but the welcome email did not go. "
            "Nobody holds their password — check the email configuration and add them again."
        ),
    )


@router.patch("/{member_id}", response_model=TeamMemberChangedOut)
def update_team_member(
    member_id: int,
    data: AdminTeamMemberUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.team", "full")),
):
    tenant = _get_admin_tenant(db)

    member = db.query(User).filter(
        User.id == member_id,
        User.tenant_id == tenant.id,
        User.role != "global_admin",
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(member, field, value)

    db.commit()
    db.refresh(member)
    return TeamMemberChangedOut(ok=True, message=f"{member.name} updated")


@router.delete("/{member_id}", response_model=TeamMemberChangedOut)
def remove_team_member(
    member_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.team", "full")),
):
    tenant = _get_admin_tenant(db)

    member = db.query(User).filter(
        User.id == member_id,
        User.tenant_id == tenant.id,
        User.role != "global_admin",
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")

    member.is_active = False
    db.commit()
    return TeamMemberChangedOut(ok=True, message=f"{member.name} deactivated")
