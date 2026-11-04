from __future__ import annotations

from app.ai.textkit import fmt_ts
from app.video.media import service as media
from app.video.models.media import Video
from app.video.models.social import Channel
from app.video.social import counters


def iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def channel_card(c: Channel | None) -> dict | None:
    if c is None:
        return None
    from app.video.services.images import public_url

    pend = counters.pending("channel", [c.id]).get(c.id, {})
    return {"id": c.id, "handle": c.handle, "name": c.name, "avatar": public_url(c.avatar_key),
            "banner": public_url(c.banner_key), "followers": c.follower_count + pend.get("follower_count", 0),
            "verified": c.handle == "klygenix"}


def video_card(v: Video, channel: Channel | None, pend: dict | None = None) -> dict:
    pend = pend or {}
    return {
        "id": v.public_id, "title": v.title, "kind": v.kind, "source": v.source,
        "duration_ms": v.duration_ms, "duration": fmt_ts(v.duration_ms), "thumbnail": media.thumb(v),
        "views": v.view_count + pend.get("view_count", 0), "likes": v.like_count + pend.get("like_count", 0),
        "published_at": iso(v.published_at), "language": v.language, "ai_generated": v.ai_generated,
        "embed_platform": v.embed_platform, "channel": channel_card(channel), "access": v.access,
        "price_minor": v.price_inr_minor if v.access == "paid" else None,
    }


def studio_video(v: Video, pend: dict | None = None) -> dict:
    pend = pend or {}
    return {
        "id": v.id, "public_id": v.public_id, "title": v.title, "description": v.description, "kind": v.kind,
        "source": v.source, "status": v.status, "status_note": v.status_note, "visibility": v.visibility,
        "publish_at": iso(v.publish_at), "published_at": iso(v.published_at), "duration_ms": v.duration_ms,
        "width": v.width, "height": v.height, "language": v.language, "tags": v.tags, "ai_status": v.ai_status,
        "ai_generated": v.ai_generated, "rights_declared": v.rights_declared, "thumbnail": media.thumb(v),
        "views": v.view_count + pend.get("view_count", 0), "likes": v.like_count + pend.get("like_count", 0),
        "comments": v.comment_count + pend.get("comment_count", 0),
        "danmaku": v.danmaku_count + pend.get("danmaku_count", 0),
        "watch_ms": v.watch_ms + pend.get("watch_ms", 0), "embed_platform": v.embed_platform,
        "embed_url": v.embed_url, "created_at": iso(v.created_at), "access": v.access, "ads_enabled": v.ads_enabled,
        "sponsor_deal_id": v.sponsor_deal_id,
        "price_minor": v.price_inr_minor, "members_rank": v.members_rank, "preview_seconds": v.preview_seconds,
        "dubbing_allowed": v.dubbing_allowed,
    }
