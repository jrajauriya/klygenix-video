from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.core.messages import err
from app.video.models.media import Video
from app.video.models.social import Channel, Playlist, PlaylistItem
from app.video.present import channel_card, iso
from app.video.routers.deps import Ctx, StudioCtx, Viewer, optional_viewer, signed_in, studio
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video", tags=["playlists"])

VISIBILITY = ("public", "unlisted", "private")
KINDS = ("playlist", "series")
MAX_ITEMS = 500


def playlist_out(p: Playlist, count: int, cover: str | None = None) -> dict:
    return {"id": p.id, "title": p.title, "description": p.description, "kind": p.kind, "visibility": p.visibility,
            "video_count": count, "cover": cover, "created_at": iso(p.created_at)}


def counts_and_covers(db, playlists: list[Playlist], public_only: bool) -> tuple[dict, dict]:
    from app.video.media import service as media

    if not playlists:
        return {}, {}
    q = select(PlaylistItem.playlist_id, Video).join(Video, Video.id == PlaylistItem.video_id).where(
        PlaylistItem.playlist_id.in_([p.id for p in playlists]), Video.is_deleted.is_(False))
    if public_only:
        q = q.where(Video.status == "published", Video.visibility.in_(("public", "unlisted")))
    counts: dict[int, int] = {}
    covers: dict[int, str | None] = {}
    for pid, v in db.execute(q.order_by(PlaylistItem.playlist_id, PlaylistItem.position, PlaylistItem.id)).all():
        counts[pid] = counts.get(pid, 0) + 1
        if pid not in covers:
            covers[pid] = media.thumb(v)
    return counts, covers


@router.get("/channels/{handle}/playlists")
def channel_playlists(handle: str):
    with platform_session() as db:
        c = db.execute(select(Channel).where(Channel.handle == handle.lower().lstrip("@"))).scalars().first()
        if c is None or c.is_suspended:
            raise err(404, "channel_not_found")
        rows = db.execute(select(Playlist).where(Playlist.channel_id == c.id, Playlist.visibility == "public")
                          .order_by(Playlist.created_at.desc())).scalars().all()
        counts, covers = counts_and_covers(db, rows, True)
        return [playlist_out(p, counts.get(p.id, 0), covers.get(p.id)) for p in rows if counts.get(p.id, 0)]


@router.get("/playlists/{playlist_id}")
def playlist_detail(playlist_id: int, viewer: Viewer = Depends(optional_viewer)):
    from app.video.social.cards import cards

    with platform_session() as db:
        p = db.get(Playlist, playlist_id)
        owner = p is not None and viewer.user is not None and viewer.user.tenant_id == p.tenant_id
        if p is None or (p.visibility == "private" and not owner):
            raise err(404, "playlist_not_found")
        c = db.get(Channel, p.channel_id)
        if c is None or (c.is_suspended and not owner):
            raise err(404, "playlist_not_found")
        q = select(Video).join(PlaylistItem, PlaylistItem.video_id == Video.id).where(
            PlaylistItem.playlist_id == p.id, Video.is_deleted.is_(False))
        if not owner:
            q = q.where(Video.status == "published", Video.visibility.in_(("public", "unlisted")))
        videos = db.execute(q.order_by(PlaylistItem.position, PlaylistItem.id)).scalars().all()
        out = playlist_out(p, len(videos))
        out["channel"] = channel_card(c)
        out["videos"] = cards(db, videos, viewer.user.id if viewer.user else None)
        return out


class PlaylistIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=5000)
    kind: str = "playlist"
    visibility: str = "public"


class PlaylistPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=5000)
    kind: str | None = None
    visibility: str | None = None


class ItemIn(BaseModel):
    video_id: int


class OrderIn(BaseModel):
    video_ids: list[int] = Field(max_length=MAX_ITEMS)


def own_playlist(ctx: StudioCtx, playlist_id: int) -> Playlist:
    p = ctx.db.get(Playlist, playlist_id)
    if p is None or p.tenant_id != ctx.tenant_id:
        raise err(404, "playlist_not_found")
    return p


def validate(kind: str | None, visibility: str | None) -> None:
    if kind is not None and kind not in KINDS:
        raise err(400, "action_not_allowed")
    if visibility is not None and visibility not in VISIBILITY:
        raise err(400, "action_not_allowed")


@router.get("/studio/playlists")
def studio_playlists(ctx: StudioCtx = Depends(studio("video.channels"))):
    rows = ctx.db.execute(select(Playlist).where(Playlist.tenant_id == ctx.tenant_id)
                          .order_by(Playlist.created_at.desc())).scalars().all()
    counts, covers = counts_and_covers(ctx.db, rows, False)
    return [playlist_out(p, counts.get(p.id, 0), covers.get(p.id)) for p in rows]


@router.post("/studio/playlists", status_code=201)
def create_playlist(data: PlaylistIn, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    validate(data.kind, data.visibility)
    p = Playlist(tenant_id=ctx.tenant_id, channel_id=ctx.channel.id, title=data.title.strip(),
                 description=data.description, kind=data.kind, visibility=data.visibility)
    ctx.db.add(p)
    ctx.db.commit()
    return playlist_out(p, 0)


@router.patch("/studio/playlists/{playlist_id}")
def patch_playlist(playlist_id: int, data: PlaylistPatch, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    p = own_playlist(ctx, playlist_id)
    validate(data.kind, data.visibility)
    for field in ("title", "description", "kind", "visibility"):
        value = getattr(data, field)
        if value is not None:
            setattr(p, field, value.strip() if field == "title" else value)
    ctx.db.commit()
    count = ctx.db.execute(select(func.count(PlaylistItem.id)).where(PlaylistItem.playlist_id == p.id)).scalar() or 0
    return playlist_out(p, count)


@router.delete("/studio/playlists/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: int, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    p = own_playlist(ctx, playlist_id)
    ctx.db.delete(p)
    ctx.db.commit()
    return Response(status_code=204)


@router.post("/studio/playlists/{playlist_id}/items", status_code=201)
def add_item(playlist_id: int, data: ItemIn, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    p = own_playlist(ctx, playlist_id)
    v = ctx.db.get(Video, data.video_id)
    if v is None or v.is_deleted or v.tenant_id != ctx.tenant_id:
        raise err(404, "video_not_found")
    count, last = ctx.db.execute(select(func.count(PlaylistItem.id), func.max(PlaylistItem.position))
                                 .where(PlaylistItem.playlist_id == p.id)).one()
    if count >= MAX_ITEMS:
        raise err(400, "action_not_allowed")
    try:
        ctx.db.add(PlaylistItem(tenant_id=ctx.tenant_id, playlist_id=p.id, video_id=v.id, position=(last or 0) + 1))
        ctx.db.commit()
    except IntegrityError:
        ctx.db.rollback()
    return {"added": True}


@router.delete("/studio/playlists/{playlist_id}/items/{video_id}", status_code=204)
def remove_item(playlist_id: int, video_id: int, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    p = own_playlist(ctx, playlist_id)
    ctx.db.execute(delete(PlaylistItem).where(PlaylistItem.playlist_id == p.id, PlaylistItem.video_id == video_id))
    ctx.db.commit()
    return Response(status_code=204)


@router.put("/studio/playlists/{playlist_id}/order")
def reorder(playlist_id: int, data: OrderIn, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    p = own_playlist(ctx, playlist_id)
    items = {i.video_id: i for i in ctx.db.execute(select(PlaylistItem).where(PlaylistItem.playlist_id == p.id)).scalars().all()}
    if set(data.video_ids) != set(items) or len(data.video_ids) != len(items):
        raise err(400, "action_not_allowed")
    for n, vid in enumerate(data.video_ids, start=1):
        items[vid].position = n
    ctx.db.commit()
    return {"ordered": len(items)}


@router.get("/me/playlists/{playlist_id}/progress")
def series_progress(playlist_id: int, ctx: Ctx = Depends(signed_in)):
    from app.video.models.social import WatchProgress

    viewer = Viewer(db=ctx.db, user=ctx.user)
    detail = playlist_detail(playlist_id, viewer)
    with platform_session() as db:
        ids = {v.id: v.public_id for v in db.execute(select(Video).where(
            Video.public_id.in_([c["id"] for c in detail["videos"]]))).scalars().all()}
        rows = db.execute(select(WatchProgress).where(WatchProgress.user_id == viewer.user.id,
                                                      WatchProgress.video_id.in_(list(ids)))).scalars().all() if ids else []
    done = {ids[r.video_id] for r in rows if r.completed}
    started = {ids[r.video_id]: r.position_ms for r in rows}
    nxt = next((c["id"] for c in detail["videos"] if c["id"] not in done), None)
    total = len(detail["videos"])
    return {"playlist_id": playlist_id, "total": total, "completed": len(done),
            "percent": round(100 * len(done) / total) if total else 0, "next": nxt,
            "videos": [{"id": c["id"], "completed": c["id"] in done, "position_ms": started.get(c["id"], 0)}
                       for c in detail["videos"]]}
