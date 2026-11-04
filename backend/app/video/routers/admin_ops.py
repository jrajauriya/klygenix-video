from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core import audit
from app.core.messages import err
from app.core.models.audit import AuditEntry
from app.video.clock import IST
from app.video.models.commerce import ProviderEvent
from app.video.models.media import DubTrack, LiveStream, Video
from app.video.models.studio import Clip, PublishTarget
from app.video.present import iso
from app.video.routers.deps import Ctx, platform

router = APIRouter(prefix="/api/video/admin", tags=["admin-ops"])


def entry_out(e: AuditEntry) -> dict:
    return {"id": e.id, "tenant_id": e.tenant_id, "occurred_at": iso(e.occurred_at), "actor_kind": e.actor_kind,
            "actor_user_id": e.actor_user_id, "actor": e.actor_label, "action": e.action, "target_table": e.target_table,
            "target_id": e.target_id, "before": e.before, "after": e.after, "request_id": e.request_id, "ip": e.ip}


@router.get("/audit")
def audit_log(response: Response, action: str | None = None, actor: str | None = None, target_table: str | None = None,
              tenant_id: int | None = None, start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to"),
              limit: int = Query(100, le=500), offset: int = 0, ctx: Ctx = Depends(platform("admin.logs"))):
    q = select(AuditEntry)
    if action:
        q = q.where(AuditEntry.action.ilike(f"{action}%"))
    if actor:
        q = q.where(AuditEntry.actor_label.ilike(f"%{actor}%"))
    if target_table:
        q = q.where(AuditEntry.target_table == target_table)
    if tenant_id:
        q = q.where(AuditEntry.tenant_id == tenant_id)
    if start:
        q = q.where(AuditEntry.occurred_at >= datetime.combine(start, datetime.min.time(), IST))
    if end:
        q = q.where(AuditEntry.occurred_at < datetime.combine(end + timedelta(days=1), datetime.min.time(), IST))
    response.headers["X-Total-Count"] = str(ctx.db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0)
    rows = ctx.db.execute(q.order_by(AuditEntry.id.desc()).limit(limit).offset(offset)).scalars().all()
    return [entry_out(e) for e in rows]


@router.get("/audit/actions")
def audit_actions(ctx: Ctx = Depends(platform("admin.logs"))):
    return [a for (a,) in ctx.db.execute(select(AuditEntry.action).distinct().order_by(AuditEntry.action)).all()]


@router.get("/ops/failed")
def failed(ctx: Ctx = Depends(platform("admin.dashboard"))):
    db = ctx.db
    out = []
    for v in db.execute(select(Video).where(Video.is_deleted.is_(False), (Video.status == "failed") | (Video.ai_status == "failed"))
                        .order_by(Video.updated_at.desc()).limit(50)).scalars():
        out.append({"kind": "video", "id": v.id, "title": v.title, "tenant_id": v.tenant_id,
                    "detail": v.status_note or f"status {v.status}, AI {v.ai_status}", "at": iso(v.updated_at)})
    for c in db.execute(select(Clip).where(Clip.status == "failed").order_by(Clip.id.desc()).limit(50)).scalars():
        out.append({"kind": "render", "id": c.id, "title": c.title, "tenant_id": c.tenant_id, "detail": c.error, "at": iso(c.created_at)})
    for d in db.execute(select(DubTrack).where(DubTrack.status == "failed").order_by(DubTrack.id.desc()).limit(50)).scalars():
        out.append({"kind": "dub", "id": d.id, "title": f"Dub {d.language} of video {d.video_id}", "tenant_id": d.tenant_id,
                    "detail": d.error, "at": iso(d.updated_at)})
    for t in db.execute(select(PublishTarget).where(PublishTarget.status == "failed").order_by(PublishTarget.id.desc()).limit(50)).scalars():
        out.append({"kind": "publish", "id": t.id, "title": f"{t.platform} for clip {t.clip_id}", "tenant_id": t.tenant_id,
                    "detail": t.error, "at": iso(t.updated_at)})
    for e in db.execute(select(ProviderEvent).where(ProviderEvent.error.is_not(None)).order_by(ProviderEvent.id.desc()).limit(50)).scalars():
        out.append({"kind": "payment_event", "id": e.id, "title": f"{e.rail} {e.event_type}", "tenant_id": e.tenant_id,
                    "detail": e.error, "at": iso(e.received_at)})
    for s in db.execute(select(LiveStream).where(LiveStream.error.is_not(None)).order_by(LiveStream.id.desc()).limit(50)).scalars():
        out.append({"kind": "live", "id": s.id, "title": s.title, "tenant_id": s.tenant_id, "detail": s.error, "at": iso(s.updated_at)})
    return sorted(out, key=lambda x: x["at"] or "", reverse=True)


@router.post("/ops/failed/{kind}/{item_id}/retry")
def retry(kind: str, item_id: int, ctx: Ctx = Depends(platform("admin.dashboard", "full"))):
    db = ctx.db
    model = {"render": Clip, "dub": DubTrack, "publish": PublishTarget, "payment_event": ProviderEvent, "video": Video}.get(kind)
    row = db.get(model, item_id) if model else None
    if row is None:
        raise err(404, "not_found")
    if kind == "render":
        from app.video.commerce import quotas
        from app.video.studio.jobs import render_clip

        if row.status != "failed":
            raise err(409, "action_not_allowed")
        owner = quotas.owner_user_id(db, row.tenant_id)
        try:
            per = quotas.reserve(db, row.tenant_id, owner, "renders", 1) if owner else None
        except quotas.QuotaExceeded as exc:
            db.rollback()
            raise quotas.refuse(exc)
        row.status, row.error = "queued", None
        job, args = render_clip, (row.id, per)
    elif kind == "dub":
        from app.video.media.dubbing import dub_video

        if row.status != "failed":
            raise err(409, "action_not_allowed")
        row.status, row.error = "queued", None
        job, args = dub_video, (row.id,)
    elif kind == "publish":
        from app.video.studio.jobs import publish_target

        if row.status != "failed":
            raise err(409, "action_not_allowed")
        row.status, row.error = "queued", None
        job, args = publish_target, (row.id,)
    elif kind == "payment_event":
        from app.video.commerce.jobs import process_payment_event

        if not row.error or not row.signature_ok:
            raise err(409, "action_not_allowed")
        row.processed_at = None
        job, args = process_payment_event, (row.id,)
    else:
        from app.video.pipeline.housekeeping import reanalyse

        if row.is_deleted or row.ai_status != "failed" or row.status not in ("published", "in_review"):
            raise err(409, "action_not_allowed")
        job, args = reanalyse, (row.id,)
    audit.record(db, action=f"ops.retry.{kind}", target_table=model.__table__.fullname, target_id=item_id)
    db.commit()
    job.enqueue(*args)
    return {"ok": True, "kind": kind, "id": item_id}



def _model_out(m) -> dict:
    return {"id": m.id, "version": m.version, "status": m.status, "metrics": m.metrics, "features": m.features,
            "weights": m.weights, "trained_at": iso(m.trained_at), "promoted_at": iso(m.promoted_at), "note": m.note}


@router.get("/reco")
def reco_state(ctx: Ctx = Depends(platform("admin.reco"))):
    from app.config import settings
    from app.video.models.ai import RecoImpression, RecoModel
    from app.video.reco import service as reco_model

    rows = ctx.db.execute(select(RecoModel).order_by(RecoModel.id.desc()).limit(20)).scalars().all()
    total = ctx.db.execute(select(func.count(RecoImpression.id))).scalar() or 0
    labelled = ctx.db.execute(select(func.count(RecoImpression.id)).where(RecoImpression.labelled.is_(True))).scalar() or 0
    return {"enabled": settings.RECO_MODEL == "on", "ab_percent": settings.RECO_AB_PERCENT, "impressions": total,
            "labelled": labelled, "ctr": reco_model.ctr(ctx.db), "models": [_model_out(m) for m in rows]}


@router.post("/reco/train")
def reco_train(ctx: Ctx = Depends(platform("admin.reco", "full"))):
    from app.video.reco import service as reco_model
    from app.video.sessions import platform_session

    with platform_session() as db:
        reco_model.flush(db)
        reco_model.label(db)
        m = reco_model.train(db, auto_promote=False)
        db.commit()
        if m is None:
            raise err(409, "reco_not_enough_data")
        audit.record(db, action="reco.train", target_table="kv_ai.reco_models", target_id=m.id, after={"metrics": m.metrics})
        db.commit()
        return _model_out(m)


class RecoDecision(BaseModel):
    note: str = Field(default="", max_length=500)


@router.post("/reco/models/{model_id}/{decision}")
def reco_decide(model_id: int, decision: str, data: RecoDecision, ctx: Ctx = Depends(platform("admin.reco", "full"))):
    from app.video.models.ai import RecoModel
    from app.video.reco import service as reco_model

    m = ctx.db.get(RecoModel, model_id)
    if m is None or decision not in ("promote", "reject"):
        raise err(404, "action_not_allowed")
    if decision == "promote":
        reco_model.promote(ctx.db, m, ctx.user.id, data.note or "Promoted by an admin")
    else:
        m.status, m.note = ("rejected" if m.status != "active" else "retired"), data.note or "Rolled back by an admin"
        prev = ctx.db.execute(select(RecoModel).where(RecoModel.status == "retired", RecoModel.id != m.id)
                              .order_by(RecoModel.promoted_at.desc().nulls_last())).scalars().first()
        if prev is not None and m.status == "retired":
            reco_model.promote(ctx.db, prev, ctx.user.id, "Restored after a rollback")
        reco_model.forget()
    audit.record(ctx.db, action=f"reco.{decision}", target_table="kv_ai.reco_models", target_id=m.id, after={"status": m.status})
    ctx.db.commit()
    return _model_out(m)
