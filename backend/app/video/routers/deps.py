from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.messages import err, reading_as_viewer
from app.core.middleware.auth import assert_permission, get_current_user, require_admin_tenant, security
from app.core.middleware.tenancy import get_tenant_db
from app.core.models.tenant_feature import TenantFeature
from app.core.models.user import User
from app.database import get_db
from app.video.models.social import Channel
from app.video.sessions import bind_tenant


@dataclass
class Viewer:
    db: Session
    user: User | None

    @property
    def tenant_id(self) -> int | None:
        return self.user.tenant_id if self.user else None


@dataclass
class Ctx:
    db: Session
    user: User
    tenant_id: int


@dataclass
class StudioCtx(Ctx):
    channel: Channel | None


def optional_viewer(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> Viewer:
    user = None
    if credentials is not None:
        try:
            user = get_current_user(request, credentials, None, db)
        except HTTPException:
            user = None
    if user is not None and user.tenant_id:
        bind_tenant(db, user.tenant_id)
        reading_as_viewer(user)
    return Viewer(db=db, user=user)


def signed_in(db: Session = Depends(get_tenant_db), user: User = Depends(get_current_user)) -> Ctx:
    reading_as_viewer(user)
    return Ctx(db=db, user=user, tenant_id=user.tenant_id)


def feature_on(db: Session, tenant_id: int, key: str) -> bool:
    row = db.execute(select(TenantFeature.is_enabled).where(
        TenantFeature.tenant_id == tenant_id, TenantFeature.feature_key == key)).first()
    return True if row is None else bool(row[0])


def studio(key: str, level: str = "view", need_channel: bool = True):
    def dep(db: Session = Depends(get_tenant_db), user: User = Depends(get_current_user)) -> StudioCtx:
        if not feature_on(db, user.tenant_id, key):
            raise err(status.HTTP_403_FORBIDDEN, "feature_not_part_plan")
        assert_permission(db, user, key, level)
        channel = db.execute(select(Channel).where(Channel.tenant_id == user.tenant_id)).scalars().first()
        if need_channel and channel is None:
            raise err(status.HTTP_409_CONFLICT, "channel_needed")
        if need_channel and channel.is_suspended and level == "full":
            raise err(status.HTTP_403_FORBIDDEN, "channel_suspended")
        return StudioCtx(db=db, user=user, tenant_id=user.tenant_id, channel=channel)

    return dep


def platform_mode(db: Session) -> Session:
    db.info["platform"] = True
    db.execute(text("SELECT set_config('app.platform', 'on', true)"))
    return db


def platform(key: str, level: str = "view"):
    checker = require_admin_tenant(key, level)

    def dep(request: Request, user: User = Depends(checker), db: Session = Depends(get_db)) -> Ctx:
        from app.core.audit import USER, Actor, acting_as

        bind_tenant(db, user.tenant_id)
        platform_mode(db)
        acting_as(db, Actor(USER, user_id=user.id, label=user.email, ip=request.client.host if request.client else None))
        return Ctx(db=db, user=user, tenant_id=user.tenant_id)

    return dep
