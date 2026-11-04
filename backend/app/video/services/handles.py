from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.messages import err
from app.video.models.onboarding import ChannelHandle
from app.video.models.social import Channel

RESERVE_DAYS = 180
RENAME_EVERY_DAYS = 30


def now() -> datetime:
    return datetime.now(timezone.utc)


def clean(handle: str) -> str:
    return (handle or "").strip().lower().lstrip("@")


def taken(db: Session, handle: str, channel_id: int | None = None) -> bool:
    h = clean(handle)
    if db.execute(select(Channel.id).where(Channel.handle == h, Channel.id != (channel_id or 0))).first():
        return True
    return bool(db.execute(select(ChannelHandle.id).where(ChannelHandle.handle == h, ChannelHandle.reserved_until > now(),
                                                          ChannelHandle.channel_id != (channel_id or 0))).first())


def resolve(db: Session, handle: str) -> tuple[Channel | None, bool]:
    h = clean(handle)
    c = db.execute(select(Channel).where(Channel.handle == h)).scalars().first()
    if c is not None:
        return c, False
    old = db.execute(select(ChannelHandle).where(ChannelHandle.handle == h, ChannelHandle.reserved_until > now())
                     .order_by(ChannelHandle.id.desc())).scalars().first()
    if old is None:
        return None, False
    return db.get(Channel, old.channel_id), True


def rename(db: Session, channel: Channel, new: str) -> Channel:
    from app.video.services.text import is_valid_creator_handle
    from app.video.sessions import platform_session

    h = clean(new)
    if h == channel.handle:
        return channel
    if not is_valid_creator_handle(h):
        raise err(status.HTTP_400_BAD_REQUEST, "handle_3_40_letters_numbers_hyphens")
    if taken(db, h, channel.id):
        raise err(status.HTTP_409_CONFLICT, "taken_try_another", handle=h)
    last = db.execute(select(ChannelHandle.retired_at).where(ChannelHandle.channel_id == channel.id)
                      .order_by(ChannelHandle.retired_at.desc())).scalar()
    if last is not None and last > now() - timedelta(days=RENAME_EVERY_DAYS):
        raise err(status.HTTP_429_TOO_MANY_REQUESTS, "handle_rename_too_soon", days=RENAME_EVERY_DAYS)
    old = channel.handle
    with platform_session() as pdb:
        pdb.execute(delete(ChannelHandle).where(ChannelHandle.handle == old, ChannelHandle.channel_id != channel.id,
                                                ChannelHandle.reserved_until <= now()))
        pdb.commit()
    db.execute(delete(ChannelHandle).where(ChannelHandle.channel_id == channel.id, ChannelHandle.handle.in_((old, h))))
    db.add(ChannelHandle(tenant_id=channel.tenant_id, channel_id=channel.id, handle=old, retired_at=now(),
                         reserved_until=now() + timedelta(days=RESERVE_DAYS)))
    channel.handle = h
    db.flush()
    audit.record(db, action="channel.handle_rename", target_table="kv_social.channels", target_id=channel.id,
                 before={"handle": old}, after={"handle": h})
    return channel
