from __future__ import annotations

from sqlalchemy import select

from app.video.commerce import entitlements
from app.video.models.commerce import Entitlement
from app.video.models.media import Video
from app.video.models.payouts import MembershipTier
from app.video.models.social import Playlist, PlaylistItem


def _rank(db, user_id: int, channel_id: int) -> int:
    rank = 0
    for e in db.execute(select(Entitlement).where(Entitlement.user_id == user_id, Entitlement.kind == "membership",
                                                  Entitlement.revoked_at.is_(None))).scalars():
        if entitlements.active(db, user_id, "membership", e.ref) is None:
            continue
        t = db.get(MembershipTier, int(e.ref.split(":")[1]))
        if t is not None and t.channel_id == channel_id:
            rank = max(rank, t.rank)
    return rank


def _series_for(db, video: Video) -> list[Playlist]:
    return db.execute(select(Playlist).join(PlaylistItem, PlaylistItem.playlist_id == Playlist.id).where(
        PlaylistItem.video_id == video.id, Playlist.kind == "series", Playlist.price_inr_minor.is_not(None),
        Playlist.visibility == "public")).scalars().all()


def allowed(db, user, video: Video) -> bool:
    if video.access == "free" or video.source == "embed":
        return True
    if user is None:
        return False
    if user.tenant_id == video.tenant_id:
        return True
    if video.access == "members":
        return _rank(db, user.id, video.channel_id) >= (video.members_rank or 1)
    refs = [video.public_id] + [f"series:{p.id}" for p in _series_for(db, video)]
    return bool(db.execute(select(Entitlement.id).where(Entitlement.user_id == user.id, Entitlement.kind == "video",
                                                        Entitlement.ref.in_(refs),
                                                        Entitlement.revoked_at.is_(None))).first())


def lock(db, user, video: Video) -> dict | None:
    if allowed(db, user, video):
        return None
    out = {"access": video.access, "preview_seconds": video.preview_seconds, "signed_in": user is not None}
    if video.access == "members":
        tiers = db.execute(select(MembershipTier).where(MembershipTier.channel_id == video.channel_id,
                                                        MembershipTier.is_active.is_(True),
                                                        MembershipTier.rank >= (video.members_rank or 1))
                           .order_by(MembershipTier.rank)).scalars().all()
        out.update(members_rank=video.members_rank or 1,
                   tiers=[{"id": t.id, "name": t.name, "rank": t.rank, "price_minor": t.price_inr_minor, "badge": t.badge}
                          for t in tiers])
    else:
        out.update(price_minor=video.price_inr_minor, currency="INR",
                   series=[{"id": p.id, "title": p.title, "price_minor": p.price_inr_minor} for p in _series_for(db, video)])
    return out


def guard(user, video: Video) -> None:
    from app.core.messages import err
    from app.video.sessions import platform_session

    if video.access == "free":
        return
    with platform_session() as db:
        if not allowed(db, user, video):
            raise err(402, "video_locked")


def locked_ids(db, user, videos: list[Video]) -> set[int]:
    return {v.id for v in videos if v.access != "free" and not allowed(db, user, v)}
