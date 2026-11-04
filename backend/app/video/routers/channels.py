from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import settings
from app.core.messages import err
from app.core.services import secrets as sealed
from app.video.channels import embeds, youtube
from app.video.jobs import job
from app.video.media import service as media
from app.video.media.signing import alive, expiry, sign, valid
from app.video.models.media import Video
from app.video.models.social import Channel, ConnectedChannel
from app.video.present import iso, studio_video
from app.video.routers.deps import StudioCtx, studio
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video", tags=["channels"])


def connected_out(c: ConnectedChannel, count: int = 0) -> dict:
    return {"id": c.id, "platform": c.platform, "external_channel_id": c.external_channel_id, "title": c.title,
            "status": c.status, "last_synced_at": iso(c.last_synced_at), "videos": count,
            "sandbox": youtube.sandbox() if c.platform == "youtube" else _ig_sandbox() if c.platform == "instagram" else False}


def _ig_sandbox() -> bool:
    from app.video.channels import instagram

    return instagram.sandbox()


@router.get("/studio/connected")
def list_connected(ctx: StudioCtx = Depends(studio("video.channels"))):
    from sqlalchemy import func

    rows = ctx.db.execute(select(ConnectedChannel).where(ConnectedChannel.tenant_id == ctx.tenant_id)).scalars().all()
    counts = dict(ctx.db.execute(select(Video.embed_platform, func.count(Video.id)).where(
        Video.tenant_id == ctx.tenant_id, Video.source == "embed", Video.is_deleted.is_(False)).group_by(Video.embed_platform)).all())
    return [connected_out(c, counts.get(c.platform, 0)) for c in rows]


@router.get("/studio/connected/youtube/start")
def youtube_start(ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    exp = expiry(900)
    state = f"{ctx.tenant_id}.{ctx.user.id}.{exp}.{sign('yt', ctx.tenant_id, ctx.user.id, exp)}"
    return {"url": youtube.auth_url(state), "sandbox": youtube.sandbox()}


@router.get("/channels/youtube/callback")
def youtube_callback(code: str = "", state: str = "", error: str = ""):
    back = f"{settings.STUDIO_APP_URL.rstrip('/')}/channel"
    if error or not code:
        return RedirectResponse(f"{back}?connected=0")
    try:
        tid, uid, exp, sig = state.split(".")
        tid, uid, exp = int(tid), int(uid), int(exp)
    except ValueError:
        raise err(400, "action_not_allowed")
    if not alive(exp) or not valid(sig, "yt", tid, uid, exp):
        raise err(400, "upload_link_expired")
    tokens = youtube.exchange(code)
    ext_id, title = youtube.my_channel(tokens.access_token)
    if youtube.sandbox():
        ext_id = f"{ext_id}-t{tid}"
    with platform_session() as db:
        channel = db.execute(select(Channel).where(Channel.tenant_id == tid)).scalars().first()
        if channel is None:
            return RedirectResponse(f"{back}?connected=0")
        row = db.execute(select(ConnectedChannel).where(ConnectedChannel.platform == "youtube",
                                                        ConnectedChannel.external_channel_id == ext_id)).scalars().first()
        if row is not None and row.tenant_id != tid:
            return RedirectResponse(f"{back}?connected=taken")
        if row is None:
            row = ConnectedChannel(tenant_id=tid, channel_id=channel.id, platform="youtube", external_channel_id=ext_id,
                                   title=title)
            db.add(row)
        row.title = title
        row.access_token = sealed.seal(tokens.access_token)
        row.refresh_token = sealed.seal(tokens.refresh_token) if tokens.refresh_token else row.refresh_token
        row.expires_at = tokens.expires_at
        row.scopes = youtube.SCOPES
        row.status = "active"
        db.commit()
        sync_youtube.enqueue(row.id)
    return RedirectResponse(f"{back}?connected=1")


@router.get("/studio/connected/instagram/start")
def instagram_start(ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    from app.video.channels import instagram

    exp = expiry(900)
    state = f"{ctx.tenant_id}.{ctx.user.id}.{exp}.{sign('ig', ctx.tenant_id, ctx.user.id, exp)}"
    return {"url": instagram.auth_url(state), "sandbox": instagram.sandbox()}


@router.get("/channels/instagram/callback")
def instagram_callback(code: str = "", state: str = "", error: str = ""):
    from app.video.channels import instagram

    back = f"{settings.STUDIO_APP_URL.rstrip('/')}/channel"
    if error or not code:
        return RedirectResponse(f"{back}?connected=0")
    try:
        tid, uid, exp, sig = state.split(".")
        tid, uid, exp = int(tid), int(uid), int(exp)
    except ValueError:
        raise err(400, "action_not_allowed")
    if not alive(exp) or not valid(sig, "ig", tid, uid, exp):
        raise err(400, "upload_link_expired")
    try:
        acct = instagram.exchange(code, tid)
    except instagram.InstagramError:
        return RedirectResponse(f"{back}?connected=0")
    with platform_session() as db:
        channel = db.execute(select(Channel).where(Channel.tenant_id == tid)).scalars().first()
        if channel is None:
            return RedirectResponse(f"{back}?connected=0")
        row = db.execute(select(ConnectedChannel).where(ConnectedChannel.platform == "instagram",
                                                        ConnectedChannel.external_channel_id == acct.user_id)).scalars().first()
        if row is not None and row.tenant_id != tid:
            return RedirectResponse(f"{back}?connected=taken")
        if row is None:
            row = ConnectedChannel(tenant_id=tid, channel_id=channel.id, platform="instagram",
                                   external_channel_id=acct.user_id, title=acct.username or "Instagram")
            db.add(row)
        row.title = acct.username or row.title
        row.access_token = sealed.seal(acct.access_token)
        row.expires_at = acct.expires_at
        row.scopes = instagram.SCOPES
        row.status = "active"
        db.commit()
    return RedirectResponse(f"{back}?connected=1")


def _token(db, row: ConnectedChannel) -> str:
    from datetime import datetime, timezone

    if row.expires_at and row.expires_at > datetime.now(timezone.utc):
        return sealed.resolve(row.access_token or "")
    tokens = youtube.refresh(sealed.resolve(row.refresh_token or ""))
    row.access_token, row.expires_at = sealed.seal(tokens.access_token), tokens.expires_at
    db.flush()
    return tokens.access_token


def import_remote(db, row: ConnectedChannel, channel: Channel, token: str, rv) -> tuple[Video, tuple | None]:
    from app.ai.captions import parse

    v = db.execute(select(Video).where(Video.tenant_id == row.tenant_id, Video.embed_platform == "youtube",
                                       Video.embed_external_id == rv.external_id)).scalars().first()
    if v is None:
        v = media.create_video(db, channel=channel, user_id=None, title=rv.title or "Untitled",
                               description=rv.description, rights_declared=True, source="embed")
        v.provider = None
        v.embed_platform, v.embed_external_id = "youtube", rv.external_id
        v.embed_url = embeds.canonical_url("youtube", rv.external_id)
        v.duration_ms = rv.duration_ms
        v.kind = "reel" if rv.duration_ms and rv.duration_ms <= 60_000 else "long"
    v.embed_owner_verified = True
    if v.status == "uploading":
        v.status = "scanning"
    db.flush()
    cap = youtube.captions(token, rv.external_id)
    if cap:
        lang, vtt = cap
        cues = parse(vtt)
        if cues:
            return v, (v.id, [{"start_ms": c.start_ms, "end_ms": c.end_ms, "text": c.text} for c in cues], lang)
    if v.status == "scanning":
        from app.video.pipeline.jobs import apply_scan

        v.ai_status = "no_captions"
        apply_scan(db, v, f"{v.title}\n{v.description}", None)
    return v, None


@job(queue_name="ai", timeout=1800)
def sync_youtube(connected_id: int) -> None:
    from app.video.pipeline.jobs import process_captions

    queued: list[tuple[int, list[dict], str]] = []
    with platform_session() as db:
        row = db.get(ConnectedChannel, connected_id)
        if row is None or row.status != "active":
            return
        channel = db.get(Channel, row.channel_id)
        token = _token(db, row)
        for rv in youtube.my_videos(token):
            _, cap = import_remote(db, row, channel, token, rv)
            if cap:
                queued.append(cap)
        from datetime import datetime, timezone

        row.last_synced_at = datetime.now(timezone.utc)
        db.commit()
    for vid, payload, lang in queued:
        process_captions.enqueue(vid, payload, lang, "youtube")


@router.post("/studio/connected/{connected_id}/sync")
def resync(connected_id: int, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    row = ctx.db.get(ConnectedChannel, connected_id)
    if row is None or row.tenant_id != ctx.tenant_id:
        raise err(404, "connected_channel_not_found")
    sync_youtube.enqueue(row.id)
    return {"queued": True}


@router.delete("/studio/connected/{connected_id}")
def disconnect(connected_id: int, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    row = ctx.db.get(ConnectedChannel, connected_id)
    if row is None or row.tenant_id != ctx.tenant_id:
        raise err(404, "connected_channel_not_found")
    row.status = "revoked"
    row.access_token = row.refresh_token = None
    for v in ctx.db.execute(select(Video).where(Video.tenant_id == ctx.tenant_id, Video.source == "embed",
                                                Video.embed_platform == row.platform)).scalars().all():
        v.embed_owner_verified = False
    ctx.db.commit()
    return {"disconnected": True}


class EmbedIn(BaseModel):
    url: str = Field(min_length=8, max_length=500)
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    rights_declared: bool = False


@router.post("/studio/embeds", status_code=201)
def add_embed(data: EmbedIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    from app.video.pipeline.jobs import apply_scan

    parsed = embeds.parse_url(data.url)
    if parsed is None:
        raise err(400, "embed_url_not_supported")
    if not data.rights_declared:
        raise err(400, "rights_declaration_needed")
    platform, external_id = parsed
    existing = ctx.db.execute(select(Video).where(Video.tenant_id == ctx.tenant_id, Video.embed_platform == platform,
                                                  Video.embed_external_id == external_id,
                                                  Video.is_deleted.is_(False))).scalars().first()
    if existing is not None:
        return studio_video(existing)
    v = media.create_video(ctx.db, channel=ctx.channel, user_id=ctx.user.id, title=data.title,
                           description=data.description, rights_declared=True, source="embed")
    v.provider = None
    v.embed_platform, v.embed_external_id = platform, external_id
    v.embed_url = embeds.canonical_url(platform, external_id)
    owned = ctx.db.execute(select(ConnectedChannel.id).where(ConnectedChannel.tenant_id == ctx.tenant_id,
                                                             ConnectedChannel.platform == platform,
                                                             ConnectedChannel.status == "active")).first()
    v.embed_owner_verified = bool(owned) and platform == "youtube" and youtube.sandbox() is False
    v.status = "scanning"
    v.ai_status = "no_captions"
    apply_scan(ctx.db, v, f"{v.title}\n{v.description}", None)
    ctx.db.commit()
    return studio_video(v)
