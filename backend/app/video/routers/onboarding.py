from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core import audit
from app.core.messages import err
from app.core.models.user import User
from app.video.channels import youtube
from app.video.jobs import job
from app.video.models.media import Video
from app.video.models.onboarding import ImportItem, ImportJob
from app.video.models.social import Channel, ConnectedChannel
from app.video.present import iso
from app.video.routers.deps import StudioCtx, studio
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video/studio", tags=["onboarding"])


class ImportIn(BaseModel):
    external_ids: list[str] = Field(min_length=1, max_length=200)


class HandleIn(BaseModel):
    handle: str = Field(min_length=3, max_length=41)


class TipsIn(BaseModel):
    enabled: bool


def _connected(ctx: StudioCtx, connected_id: int) -> ConnectedChannel:
    row = ctx.db.get(ConnectedChannel, connected_id)
    if row is None or row.tenant_id != ctx.tenant_id or row.platform != "youtube" or row.status != "active":
        raise err(status.HTTP_404_NOT_FOUND, "connected_channel_not_found")
    return row


def _job_out(db, j: ImportJob, items: bool = False) -> dict:
    out = {"id": j.id, "connected_id": j.connected_id, "status": j.status, "total": j.total, "done": j.done,
           "failed": j.failed, "created_at": iso(j.created_at), "finished_at": iso(j.finished_at)}
    if items:
        rows = db.execute(select(ImportItem, Video.public_id).outerjoin(Video, Video.id == ImportItem.video_id)
                          .where(ImportItem.job_id == j.id).order_by(ImportItem.id)).all()
        out["items"] = [{"external_id": i.external_id, "title": i.title, "status": i.status, "error": i.error,
                         "video_id": i.video_id, "public_id": pid} for i, pid in rows]
    return out


@router.get("/connected/{connected_id}/youtube/videos")
def remote_videos(connected_id: int, page_token: str | None = None,
                  ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    from app.video.routers.channels import _token

    row = _connected(ctx, connected_id)
    token = _token(ctx.db, row)
    vids, nxt = youtube.page(token, page_token)
    have = dict(ctx.db.execute(select(Video.embed_external_id, Video.public_id).where(
        Video.tenant_id == ctx.tenant_id, Video.embed_platform == "youtube",
        Video.embed_external_id.in_([v.external_id for v in vids] or [""]), Video.is_deleted.is_(False))).all())
    ctx.db.commit()
    return {"items": [{"external_id": v.external_id, "title": v.title, "duration_ms": v.duration_ms,
                       "published_at": v.published_at, "imported": v.external_id in have,
                       "public_id": have.get(v.external_id)} for v in vids], "next_page_token": nxt}


@router.post("/connected/{connected_id}/imports", status_code=202)
def start_import(connected_id: int, data: ImportIn, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    row = _connected(ctx, connected_id)
    ids = list(dict.fromkeys(x.strip() for x in data.external_ids if x and x.strip()))[:200]
    if not ids:
        raise err(status.HTTP_400_BAD_REQUEST, "import_nothing_selected")
    j = ImportJob(tenant_id=ctx.tenant_id, connected_id=row.id, status="queued", total=len(ids), created_by=ctx.user.id)
    ctx.db.add(j)
    ctx.db.flush()
    for x in ids:
        ctx.db.add(ImportItem(tenant_id=ctx.tenant_id, job_id=j.id, external_id=x[:40], status="pending"))
    audit.record(ctx.db, action="channel.import", target_table="kv_media.import_jobs", target_id=j.id, after={"count": len(ids)})
    ctx.db.commit()
    run_import.enqueue(j.id)
    return _job_out(ctx.db, j)


@router.get("/imports")
def list_imports(ctx: StudioCtx = Depends(studio("video.channels"))):
    rows = ctx.db.execute(select(ImportJob).where(ImportJob.tenant_id == ctx.tenant_id).order_by(ImportJob.id.desc()).limit(20)).scalars()
    return [_job_out(ctx.db, j) for j in rows]


@router.get("/imports/{job_id}")
def get_import(job_id: int, ctx: StudioCtx = Depends(studio("video.channels"))):
    j = ctx.db.get(ImportJob, job_id)
    if j is None or j.tenant_id != ctx.tenant_id:
        raise err(status.HTTP_404_NOT_FOUND, "import_not_found")
    return _job_out(ctx.db, j, items=True)


@router.post("/imports/{job_id}/resume", status_code=202)
def resume_import(job_id: int, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    j = ctx.db.get(ImportJob, job_id)
    if j is None or j.tenant_id != ctx.tenant_id:
        raise err(status.HTTP_404_NOT_FOUND, "import_not_found")
    ctx.db.execute(ImportItem.__table__.update().where(ImportItem.job_id == j.id, ImportItem.status == "failed")
                   .values(status="pending", error=None))
    j.status, j.finished_at = "queued", None
    _count(ctx.db, j)
    ctx.db.commit()
    run_import.enqueue(j.id)
    return _job_out(ctx.db, j)


def _count(db, j: ImportJob) -> None:
    counts = dict(db.execute(select(ImportItem.status, func.count()).where(ImportItem.job_id == j.id)
                             .group_by(ImportItem.status)).all())
    j.done, j.failed = counts.get("done", 0), counts.get("failed", 0)


@job(queue_name="ai", timeout=3600)
def run_import(job_id: int) -> None:
    from app.video.pipeline.jobs import process_captions
    from app.video.routers.channels import _token, import_remote

    with platform_session() as db:
        j = db.get(ImportJob, job_id)
        if j is None or j.status == "done":
            return
        row = db.get(ConnectedChannel, j.connected_id)
        if row is None or row.status != "active":
            j.status, j.finished_at = "failed", datetime.now(timezone.utc)
            db.commit()
            return
        j.status = "running"
        channel = db.get(Channel, row.channel_id)
        token = _token(db, row)
        db.commit()
        pending = db.execute(select(ImportItem).where(ImportItem.job_id == j.id, ImportItem.status == "pending")
                             .order_by(ImportItem.id)).scalars().all()
        found = {v.external_id: v for v in youtube.by_ids(token, [i.external_id for i in pending])} if pending else {}
        for item in pending:
            rv = found.get(item.external_id)
            cap = None
            try:
                if rv is None:
                    item.status, item.error = "failed", "Not found on this YouTube channel, or not embeddable."
                else:
                    with db.begin_nested():
                        v, cap = import_remote(db, row, channel, token, rv)
                    item.status, item.video_id, item.title = "done", v.id, (rv.title or "")[:200]
            except Exception as exc:
                item.status, item.error = "failed", str(exc)[:300]
            item.updated_at = datetime.now(timezone.utc)
            _count(db, j)
            db.commit()
            if cap:
                process_captions.enqueue(*cap, "youtube")
        _count(db, j)
        j.status = "failed" if j.failed and not j.done else "done"
        j.finished_at = datetime.now(timezone.utc)
        row.last_synced_at = j.finished_at
        db.commit()


@router.post("/channel/handle")
def rename_handle(data: HandleIn, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    from app.video.routers.studio_videos import channel_out
    from app.video.services import handles

    if ctx.member is not None:
        raise err(status.HTTP_403_FORBIDDEN, "owner_only")
    handles.rename(ctx.db, ctx.channel, data.handle)
    ctx.db.commit()
    return channel_out(ctx.channel)


@router.get("/onboarding-mails")
def tips_state(ctx: StudioCtx = Depends(studio("video.dashboard", need_channel=False))):
    owner = ctx.db.get(User, ctx.user.id)
    s = owner.settings or {}
    return {"enabled": s.get("onboarding_mails", True), "sent": s.get("onboarding_sent", {})}


@router.put("/onboarding-mails")
def tips_set(data: TipsIn, ctx: StudioCtx = Depends(studio("video.dashboard", need_channel=False))):
    owner = ctx.db.get(User, ctx.user.id)
    owner.settings = {**(owner.settings or {}), "onboarding_mails": data.enabled}
    ctx.db.commit()
    return {"enabled": data.enabled}
