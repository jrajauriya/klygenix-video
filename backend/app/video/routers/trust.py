from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.messages import err
from app.video.models.media import Video
from app.video.models.trust import Appeal, ModerationAction, Report, Strike, Takedown
from app.video.present import iso
from app.video.routers import limits
from app.video.routers.deps import Ctx, signed_in
from app.video.sessions import platform_session
from app.video.trust import service as trust

router = APIRouter(prefix="/api/video", tags=["trust"])

REASONS = ("spam", "sexual", "violence", "hate", "harassment", "self_harm", "child_safety", "copyright",
           "misinformation", "scam", "impersonation", "other")
SLA = {"intimate": (timedelta(hours=24), timedelta(hours=24)), "court_order": (timedelta(hours=24), timedelta(hours=36)),
       "copyright": (timedelta(hours=24), timedelta(days=15)), "it_rules": (timedelta(hours=24), timedelta(days=15)),
       "other": (timedelta(hours=24), timedelta(days=15))}


class ReportIn(BaseModel):
    target_type: str
    target_id: str
    reason: str
    details: str = Field(default="", max_length=2000)


def _resolve_target(db, target_type: str, target_id: str) -> tuple[int, int]:
    if target_type == "video":
        v = db.execute(select(Video).where(Video.public_id == target_id)).scalars().first()
        if v is None:
            raise err(404, "video_not_found")
        return v.id, v.tenant_id
    if target_type == "channel":
        from app.video.models.social import Channel

        c = db.execute(select(Channel).where(Channel.handle == target_id.lower().lstrip("@"))).scalars().first()
        if c is None:
            raise err(404, "channel_not_found")
        return c.id, c.tenant_id
    if target_type in ("comment", "danmaku"):
        if not target_id.isdigit():
            raise err(404, "video_not_found")
        row = trust.target_row(db, target_type, int(target_id))
        if row is None:
            raise err(404, "video_not_found")
        return row.id, row.tenant_id
    raise err(400, "report_reason_needed")


@router.post("/reports", status_code=201, dependencies=[Depends(limits.report)])
def report(data: ReportIn, ctx: Ctx = Depends(signed_in)):
    if data.reason not in REASONS:
        raise err(400, "report_reason_needed")
    with platform_session() as db:
        tid, owner_tenant = _resolve_target(db, data.target_type, data.target_id)
        dup = db.execute(select(Report.id).where(Report.reporter_user_id == ctx.user.id, Report.target_type == data.target_type,
                                                 Report.target_id == tid, Report.status == "open")).first()
        if dup:
            raise err(409, "already_reported")
        r = Report(tenant_id=ctx.tenant_id, reporter_user_id=ctx.user.id, target_type=data.target_type, target_id=tid,
                   target_tenant_id=owner_tenant, reason=data.reason, details=data.details.strip())
        db.add(r)
        db.flush()
        if data.target_type in ("comment", "danmaku"):
            row = trust.target_row(db, data.target_type, tid)
            row.report_count += 1
            if row.report_count >= 3 and row.status == "visible":
                row.status = "hidden"
        if data.reason == "child_safety" and data.target_type == "video":
            v = db.get(Video, tid)
            if v.status == "published":
                v.status = "in_review"
                v.status_note = "Held for review after a child-safety report."
        db.commit()
        return {"id": r.id, "status": r.status}


class TakedownIn(BaseModel):
    kind: str
    complainant_name: str = Field(min_length=2, max_length=120)
    complainant_email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)
    target_url: str = Field(min_length=8, max_length=500)
    details: str = Field(min_length=10, max_length=5000)
    sworn: bool = False


@router.post("/takedowns", status_code=201, dependencies=[Depends(limits.takedown)])
def takedown(data: TakedownIn):
    if data.kind not in SLA and data.kind != "other":
        raise err(400, "takedown_fields_needed")
    ack, resolve = SLA.get(data.kind, SLA["other"])
    with platform_session() as db:
        admin_tid = trust.admin_tenant_id(db)
        video_id = target_tenant = None
        import re

        m = re.search(r"/watch/([A-Za-z0-9]{11})", data.target_url)
        if m:
            v = db.execute(select(Video).where(Video.public_id == m.group(1))).scalars().first()
            if v is not None:
                video_id, target_tenant = v.id, v.tenant_id
        t = Takedown(tenant_id=admin_tid, reference=f"TD-{secrets.token_hex(4).upper()}", kind=data.kind,
                     complainant_name=data.complainant_name.strip(), complainant_email=str(data.complainant_email),
                     target_url=data.target_url.strip(), video_id=video_id, target_tenant_id=target_tenant,
                     details=data.details.strip(), sworn=data.sworn,
                     ack_due_at=trust.now() + ack, resolve_due_at=trust.now() + resolve)
        db.add(t)
        if data.kind == "intimate" and video_id:
            v = db.get(Video, video_id)
            if v.status == "published":
                v.status = "in_review"
                v.status_note = "Held while a removal request is reviewed."
        db.commit()
        return {"reference": t.reference, "ack_due_at": iso(t.ack_due_at), "resolve_due_at": iso(t.resolve_due_at)}


@router.get("/me/moderation")
def my_moderation(ctx: Ctx = Depends(signed_in)):
    acts = ctx.db.execute(select(ModerationAction).where(ModerationAction.tenant_id == ctx.tenant_id)
                          .order_by(ModerationAction.id.desc()).limit(100)).scalars().all()
    strikes = ctx.db.execute(select(Strike).where(Strike.tenant_id == ctx.tenant_id).order_by(Strike.id.desc())).scalars().all()
    appeals = ctx.db.execute(select(Appeal).where(Appeal.tenant_id == ctx.tenant_id)).scalars().all()
    by_action = {a.action_id: a for a in appeals}
    return {
        "actions": [{"id": a.id, "target_type": a.target_type, "target_id": a.target_id, "action": a.action,
                     "reason": a.reason, "created_at": iso(a.created_at),
                     "appeal": None if a.id not in by_action else {"status": by_action[a.id].status,
                                                                    "note": by_action[a.id].decision_note}} for a in acts],
        "strikes": [{"id": s.id, "reason": s.reason, "expires_at": iso(s.expires_at), "lifted": s.lifted_at is not None}
                    for s in strikes],
    }


class AppealIn(BaseModel):
    action_id: int
    text: str = Field(min_length=10, max_length=3000)


@router.post("/appeals", status_code=201)
def appeal(data: AppealIn, ctx: Ctx = Depends(signed_in)):
    act = ctx.db.get(ModerationAction, data.action_id)
    if act is None or act.tenant_id != ctx.tenant_id or act.action not in ("remove", "restrict", "suspend"):
        raise err(404, "action_not_allowed")
    if ctx.db.execute(select(Appeal.id).where(Appeal.action_id == act.id)).first():
        raise err(409, "appeal_exists")
    a = Appeal(tenant_id=ctx.tenant_id, action_id=act.id, user_id=ctx.user.id, text=data.text.strip())
    ctx.db.add(a)
    ctx.db.commit()
    return {"id": a.id, "status": a.status}
