from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.messages import err
from app.video.media import service as media
from app.video.models.ai import AiJob, LlmCall
from app.video.models.commerce import Payment, Subscription
from app.video.models.media import Video
from app.video.models.social import Channel, Comment, Danmaku
from app.video.models.trust import Appeal, ModerationAction, Report, ScanResult, Strike, Takedown
from app.video.present import iso
from app.video.routers.deps import Ctx, platform
from app.video.trust import service as trust

router = APIRouter(prefix="/api/video/admin", tags=["admin-video"])


def now() -> datetime:
    return datetime.now(timezone.utc)


def _target_summary(db, target_type: str, target_id: int) -> dict:
    row = trust.target_row(db, target_type, target_id)
    if row is None:
        return {"missing": True}
    if target_type == "video":
        ch = db.get(Channel, row.channel_id)
        return {"title": row.title, "public_id": row.public_id, "status": row.status, "channel": ch.handle if ch else None,
                "thumbnail": media.thumb(row), "kind": row.kind, "description": row.description[:500]}
    if target_type in ("comment", "danmaku"):
        v = db.get(Video, row.video_id)
        return {"text": getattr(row, "body", None) or getattr(row, "text", ""), "status": row.status,
                "video": v.public_id if v else None, "video_title": v.title if v else None}
    return {"handle": row.handle, "name": row.name, "suspended": row.is_suspended, "strikes": row.strike_count}


@router.get("/queue")
def queue(response: Response, limit: int = Query(50, le=200), offset: int = 0,
          ctx: Ctx = Depends(platform("admin.moderation"))):
    db = ctx.db
    held = db.execute(select(Video).where(Video.status == "in_review", Video.is_deleted.is_(False))
                      .order_by(Video.updated_at)).scalars().all()
    reports = db.execute(select(Report.target_type, Report.target_id, func.count(Report.id), func.min(Report.created_at),
                                func.array_agg(Report.reason))
                         .where(Report.status == "open").group_by(Report.target_type, Report.target_id)
                         .order_by(func.count(Report.id).desc(), func.min(Report.created_at))).all()
    items = []
    seen = set()
    for v in held:
        scan = db.execute(select(ScanResult).where(ScanResult.video_id == v.id).order_by(ScanResult.id.desc())).scalars().first()
        items.append({"target_type": "video", "target_id": v.id, "why": "held", "reports": 0,
                      "labels": scan.labels if scan else [], "since": iso(v.updated_at),
                      "target": _target_summary(db, "video", v.id)})
        seen.add(("video", v.id))
    for ttype, tid, n, first, reasons in reports:
        if (ttype, tid) in seen:
            items[[i for i, x in enumerate(items) if (x["target_type"], x["target_id"]) == (ttype, tid)][0]]["reports"] = n
            continue
        items.append({"target_type": ttype, "target_id": tid, "why": "reported", "reports": n,
                      "labels": sorted(set(reasons or [])), "since": iso(first), "target": _target_summary(db, ttype, tid)})
    response.headers["X-Total-Count"] = str(len(items))
    return items[offset:offset + limit]


@router.get("/reports")
def reports(target_type: str, target_id: int, ctx: Ctx = Depends(platform("admin.moderation"))):
    rows = ctx.db.execute(select(Report).where(Report.target_type == target_type, Report.target_id == target_id)
                          .order_by(Report.id.desc())).scalars().all()
    return [{"id": r.id, "reason": r.reason, "details": r.details, "status": r.status, "created_at": iso(r.created_at)}
            for r in rows]


class ActionIn(BaseModel):
    target_type: str
    target_id: int
    action: str
    reason: str = Field(min_length=3, max_length=2000)
    strike: bool = False
    takedown_id: int | None = None


@router.post("/actions", status_code=201)
def act(data: ActionIn, ctx: Ctx = Depends(platform("admin.moderation", "full"))):
    if data.action not in ("approve", "remove", "restrict", "restore", "warn", "suspend", "unsuspend"):
        raise err(400, "action_not_allowed")
    try:
        a = trust.apply_action(ctx.db, target_type=data.target_type, target_id=data.target_id, action=data.action,
                               reason=data.reason, actor_user_id=ctx.user.id, takedown_id=data.takedown_id,
                               strike=data.strike)
    except LookupError:
        raise err(404, "video_not_found")
    ctx.db.commit()
    return {"id": a.id, "action": a.action, "target": _target_summary(ctx.db, data.target_type, data.target_id)}


@router.get("/actions")
def actions(response: Response, limit: int = Query(50, le=200), offset: int = 0,
            ctx: Ctx = Depends(platform("admin.moderation"))):
    total = ctx.db.execute(select(func.count(ModerationAction.id))).scalar() or 0
    rows = ctx.db.execute(select(ModerationAction).order_by(ModerationAction.id.desc()).limit(limit).offset(offset)).scalars().all()
    response.headers["X-Total-Count"] = str(total)
    return [{"id": a.id, "target_type": a.target_type, "target_id": a.target_id, "action": a.action, "reason": a.reason,
             "actor_user_id": a.actor_user_id, "created_at": iso(a.created_at)} for a in rows]


@router.get("/appeals")
def appeals(status: str = "open", ctx: Ctx = Depends(platform("admin.moderation"))):
    rows = ctx.db.execute(select(Appeal).where(Appeal.status == status).order_by(Appeal.created_at)).scalars().all()
    out = []
    for a in rows:
        act_row = ctx.db.get(ModerationAction, a.action_id)
        out.append({"id": a.id, "text": a.text, "status": a.status, "created_at": iso(a.created_at),
                    "action": None if act_row is None else {"id": act_row.id, "action": act_row.action, "reason": act_row.reason,
                                                            "target_type": act_row.target_type, "target_id": act_row.target_id,
                                                            "target": _target_summary(ctx.db, act_row.target_type, act_row.target_id)}})
    return out


class AppealDecision(BaseModel):
    decision: str
    note: str = Field(min_length=3, max_length=2000)


@router.post("/appeals/{appeal_id}")
def decide_appeal(appeal_id: int, data: AppealDecision, ctx: Ctx = Depends(platform("admin.moderation", "full"))):
    a = ctx.db.get(Appeal, appeal_id)
    if a is None or a.status != "open":
        raise err(404, "action_not_allowed")
    if data.decision not in ("upheld", "overturned"):
        raise err(400, "action_not_allowed")
    a.status, a.decision_note, a.decided_by, a.decided_at = data.decision, data.note, ctx.user.id, now()
    if data.decision == "overturned":
        act_row = ctx.db.get(ModerationAction, a.action_id)
        restore = "unsuspend" if act_row.action == "suspend" else "restore"
        trust.apply_action(ctx.db, target_type=act_row.target_type, target_id=act_row.target_id, action=restore,
                           reason=f"Appeal overturned: {data.note}", actor_user_id=ctx.user.id)
        for s in ctx.db.execute(select(Strike).where(Strike.action_id == act_row.id, Strike.lifted_at.is_(None))).scalars().all():
            s.lifted_at = now()
            ch = ctx.db.get(Channel, s.channel_id)
            if ch is not None:
                ch.strike_count = max(0, ch.strike_count - 1)
    ctx.db.commit()
    return {"id": a.id, "status": a.status}


def takedown_out(t: Takedown) -> dict:
    n = now()
    return {"id": t.id, "reference": t.reference, "kind": t.kind, "complainant_name": t.complainant_name,
            "complainant_email": t.complainant_email, "target_url": t.target_url, "video_id": t.video_id,
            "details": t.details, "sworn": t.sworn, "status": t.status, "received_at": iso(t.received_at),
            "ack_due_at": iso(t.ack_due_at), "resolve_due_at": iso(t.resolve_due_at),
            "acknowledged_at": iso(t.acknowledged_at), "resolved_at": iso(t.resolved_at),
            "ack_overdue": t.acknowledged_at is None and t.ack_due_at < n,
            "resolve_overdue": t.resolved_at is None and t.resolve_due_at < n, "decision_note": t.decision_note}


@router.get("/takedowns")
def takedowns(status: str | None = None, ctx: Ctx = Depends(platform("admin.takedowns"))):
    q = select(Takedown)
    if status:
        q = q.where(Takedown.status == status)
    rows = ctx.db.execute(q.order_by(Takedown.resolve_due_at)).scalars().all()
    return [takedown_out(t) for t in rows]


class TakedownDecision(BaseModel):
    status: str
    note: str = Field(default="", max_length=2000)


@router.post("/takedowns/{takedown_id}")
def decide_takedown(takedown_id: int, data: TakedownDecision, ctx: Ctx = Depends(platform("admin.takedowns", "full"))):
    t = ctx.db.get(Takedown, takedown_id)
    if t is None:
        raise err(404, "action_not_allowed")
    if data.status not in ("acknowledged", "actioned", "rejected", "restored"):
        raise err(400, "action_not_allowed")
    if data.status == "acknowledged":
        t.acknowledged_at = t.acknowledged_at or now()
    else:
        t.acknowledged_at = t.acknowledged_at or now()
        t.resolved_at = now()
        if data.status == "actioned" and t.video_id:
            trust.apply_action(ctx.db, target_type="video", target_id=t.video_id, action="remove",
                               reason=f"Takedown {t.reference}: {data.note or t.kind}", actor_user_id=ctx.user.id,
                               takedown_id=t.id, strike=t.kind == "copyright")
        if data.status == "restored" and t.video_id:
            trust.apply_action(ctx.db, target_type="video", target_id=t.video_id, action="restore",
                               reason=f"Takedown {t.reference} restored: {data.note}", actor_user_id=ctx.user.id,
                               takedown_id=t.id)
    t.status = data.status
    t.decision_note = data.note or t.decision_note
    ctx.db.commit()
    return takedown_out(t)


@router.get("/ai-usage")
def ai_usage(days: int = Query(30, le=365), ctx: Ctx = Depends(platform("admin.ai_usage"))):
    since = now() - timedelta(days=days)
    jobs = ctx.db.execute(select(AiJob.kind, AiJob.status, func.count(AiJob.id), func.coalesce(func.sum(AiJob.units), 0),
                                 func.coalesce(func.sum(AiJob.cost_minor), 0))
                          .where(AiJob.created_at >= since).group_by(AiJob.kind, AiJob.status)).all()
    calls = ctx.db.execute(select(LlmCall.purpose, LlmCall.status, func.count(LlmCall.id),
                                  func.coalesce(func.sum(LlmCall.input_tokens), 0), func.coalesce(func.sum(LlmCall.output_tokens), 0),
                                  func.coalesce(func.sum(LlmCall.cost_minor), 0))
                           .where(LlmCall.created_at >= since).group_by(LlmCall.purpose, LlmCall.status)).all()
    from app.config import settings

    return {
        "days": days,
        "providers": {"video": settings.VIDEO_PROVIDER, "stt": settings.STT_PROVIDER, "llm": settings.LLM_PROVIDER,
                      "embed": settings.EMBED_PROVIDER, "scan": settings.SCAN_PROVIDER},
        "jobs": [{"kind": k, "status": s, "count": n, "units": int(u), "cost_minor": int(c)} for k, s, n, u, c in jobs],
        "llm": [{"purpose": p, "status": s, "count": n, "input_tokens": int(i), "output_tokens": int(o), "cost_minor": int(c)}
                for p, s, n, i, o, c in calls],
        "budget_minor": settings.LLM_MONTHLY_BUDGET_MINOR,
    }


@router.get("/stats")
def stats(ctx: Ctx = Depends(platform("admin.dashboard"))):
    db = ctx.db
    by_status = dict(db.execute(select(Video.status, func.count(Video.id)).where(Video.is_deleted.is_(False))
                                .group_by(Video.status)).all())
    by_kind = dict(db.execute(select(Video.kind, func.count(Video.id)).where(Video.status == "published",
                                                                             Video.is_deleted.is_(False)).group_by(Video.kind)).all())
    return {
        "videos": {"by_status": by_status, "published_by_kind": by_kind,
                   "minutes": int((db.execute(select(func.coalesce(func.sum(Video.duration_ms), 0))).scalar() or 0) // 60000),
                   "views": int(db.execute(select(func.coalesce(func.sum(Video.view_count), 0))).scalar() or 0)},
        "channels": db.execute(select(func.count(Channel.id))).scalar() or 0,
        "comments": db.execute(select(func.count(Comment.id))).scalar() or 0,
        "danmaku": db.execute(select(func.count(Danmaku.id))).scalar() or 0,
        "open_reports": db.execute(select(func.count(Report.id)).where(Report.status == "open")).scalar() or 0,
        "held_videos": by_status.get("in_review", 0),
        "open_takedowns": db.execute(select(func.count(Takedown.id)).where(Takedown.resolved_at.is_(None))).scalar() or 0,
        "overdue_takedowns": db.execute(select(func.count(Takedown.id)).where(Takedown.resolved_at.is_(None),
                                                                             Takedown.resolve_due_at < now())).scalar() or 0,
        "active_subscriptions": dict(db.execute(select(Subscription.plan_key, func.count(Subscription.id))
                                               .where(Subscription.status.in_(("active", "grace"))).group_by(Subscription.plan_key)).all()),
        "revenue_minor": dict(db.execute(select(Payment.currency, func.coalesce(func.sum(Payment.amount_minor), 0))
                                         .group_by(Payment.currency)).all()),
    }


@router.get("/videos")
def admin_videos(response: Response, status: str | None = None, q: str | None = None, limit: int = Query(50, le=200),
                 offset: int = 0, ctx: Ctx = Depends(platform("admin.moderation"))):
    from app.video.present import studio_video

    query = select(Video).where(Video.is_deleted.is_(False))
    if status:
        query = query.where(Video.status == status)
    if q:
        query = query.where(Video.title.ilike(f"%{q}%"))
    total = ctx.db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = ctx.db.execute(query.order_by(Video.created_at.desc()).limit(limit).offset(offset)).scalars().all()
    chans = {c.id: c for c in ctx.db.execute(select(Channel).where(Channel.id.in_({v.channel_id for v in rows}))).scalars().all()} if rows else {}
    response.headers["X-Total-Count"] = str(total)
    out = []
    for v in rows:
        item = studio_video(v)
        item["channel"] = chans[v.channel_id].handle if v.channel_id in chans else None
        out.append(item)
    return out
