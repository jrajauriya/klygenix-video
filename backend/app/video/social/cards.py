from __future__ import annotations

from sqlalchemy import select

from app.video.models.media import CaptionTrack, Video
from app.video.models.social import Channel, Follow, Like
from app.video.present import video_card
from app.video.social import counters


def cards(db, videos: list[Video], user_id: int | None = None) -> list[dict]:
    if not videos:
        return []
    ids = [v.id for v in videos]
    ch = {c.id: c for c in db.execute(select(Channel).where(Channel.id.in_({v.channel_id for v in videos}))).scalars().all()}
    pend = counters.pending("video", ids)
    langs: dict[int, set] = {}
    for vid, lang in db.execute(select(CaptionTrack.video_id, CaptionTrack.language).where(CaptionTrack.video_id.in_(ids))).all():
        langs.setdefault(vid, set()).add(lang)
    liked: set = set()
    following: set = set()
    if user_id is not None:
        liked = set(db.execute(select(Like.video_id).where(Like.user_id == user_id, Like.video_id.in_(ids))).scalars().all())
        following = set(db.execute(select(Follow.channel_id).where(
            Follow.user_id == user_id, Follow.channel_id.in_(list(ch)))).scalars().all())
    deals = {v.sponsor_deal_id for v in videos if v.sponsor_deal_id}
    brands: dict[int, str] = {}
    if deals:
        from app.video.models.ads import BrandProfile, SponsorDeal

        for did, name in db.execute(select(SponsorDeal.id, BrandProfile.name)
                                    .join(BrandProfile, BrandProfile.tenant_id == SponsorDeal.tenant_id)
                                    .where(SponsorDeal.id.in_(deals))).all():
            brands[did] = name
    out = []
    for v in videos:
        p = pend.get(v.id) or {}
        card = video_card(v, ch.get(v.channel_id), p)
        card["comments"] = v.comment_count + p.get("comment_count", 0)
        card["captions"] = {"available": sorted(langs.get(v.id, ()))}
        card["liked"] = v.id in liked
        card["following"] = v.channel_id in following
        brand = brands.get(v.sponsor_deal_id) if v.sponsor_deal_id else None
        card["paid_partnership"] = {"brand": brand, "label": f"Paid partnership with {brand}"} if brand else None
        out.append(card)
    return out
