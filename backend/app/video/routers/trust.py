from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select

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
KINDS = ("intimate", "court_order", "copyright", "it_rules", "other")


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
    if target_type == "live":
        from app.video.models.media import LiveStream

        s = db.execute(select(LiveStream).where(LiveStream.public_id == target_id)).scalars().first()
        if s is None:
            raise err(404, "live_not_found")
        return s.id, s.tenant_id
    if target_type == "live_message":
        row = trust.target_row(db, "live_message", int(target_id)) if target_id.isdigit() else None
        if row is None or row.status == "deleted":
            raise err(404, "live_not_found")
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
        hidden_live = None
        r = Report(tenant_id=ctx.tenant_id, reporter_user_id=ctx.user.id, target_type=data.target_type, target_id=tid,
                   target_tenant_id=owner_tenant, reason=data.reason, details=data.details.strip())
        db.add(r)
        db.flush()
        if data.target_type in ("comment", "danmaku"):
            row = trust.target_row(db, data.target_type, tid)
            row.report_count += 1
            if row.report_count >= 3 and row.status == "visible":
                row.status = "hidden"
        if data.target_type == "live_message":
            from app.video.models.community import LiveMessage

            n = db.execute(select(func.count(Report.id)).where(Report.target_type == "live_message", Report.target_id == tid,
                                                              Report.status == "open")).scalar() or 0
            row = db.get(LiveMessage, tid)
            if n >= 3 and row.status == "visible" and not row.paid_minor:
                row.status = "hidden"
                hidden_live = row
        if data.reason == "child_safety" and data.target_type == "video":
            v = db.get(Video, tid)
            if v.status == "published":
                v.status = "in_review"
                v.status_note = "Held for review after a child-safety report."
        db.commit()
        if hidden_live is not None:
            from app.video.models.media import LiveStream
            from app.video.routers.live import emit

            emit(db.get(LiveStream, hidden_live.stream_id), {"type": "chat_removed", "id": hidden_live.id})
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
    if data.kind not in KINDS:
        raise err(400, "takedown_fields_needed")
    table = trust.sla_table()
    ack, resolve = table.get(data.kind, table["other"])
    at = trust.now()
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
                     details=data.details.strip(), sworn=data.sworn, ack_due_at=at + ack, resolve_due_at=at + resolve)
        db.add(t)
        if data.kind == "intimate" and video_id:
            v = db.get(Video, video_id)
            if v.status == "published":
                v.status = "in_review"
                v.status_note = "Held while a removal request is reviewed."
        from app.core.services import mailer

        mailer.send(db, "takedown_received", t.complainant_email,
                    {"reference": t.reference, "kind": t.kind.replace("_", " "), "target": t.target_url,
                     "ack_due": t.ack_due_at.strftime("%d %b %Y %H:%M UTC"),
                     "resolve_due": t.resolve_due_at.strftime("%d %b %Y %H:%M UTC")})
        db.commit()
        return {"reference": t.reference, "ack_due_at": iso(t.ack_due_at), "resolve_due_at": iso(t.resolve_due_at)}


def _my_takedown(t: Takedown, v: Video | None) -> dict:
    return {"reference": t.reference, "kind": t.kind, "status": t.status, "received_at": iso(t.received_at),
            "complainant_name": t.complainant_name, "details": t.details, "target_url": t.target_url,
            "video": {"id": v.public_id, "title": v.title, "status": v.status} if v else None,
            "counter_notice": t.counter_notice, "countered_at": iso(t.countered_at), "restore_due_at": iso(t.restore_due_at),
            "can_counter": t.kind == "copyright" and t.status == "actioned" and t.counter_notice is None,
            "decision_note": t.decision_note}


@router.get("/me/takedowns")
def my_takedowns(ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        rows = db.execute(select(Takedown).where(Takedown.target_tenant_id == ctx.tenant_id)
                          .order_by(Takedown.received_at.desc()).limit(100)).scalars().all()
        return [_my_takedown(t, db.get(Video, t.video_id) if t.video_id else None) for t in rows]


class CounterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=10, max_length=500)
    phone: str = Field(min_length=6, max_length=30)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)
    statement: str = Field(min_length=20, max_length=5000)
    good_faith: bool
    consent_jurisdiction: bool
    signature: str = Field(min_length=2, max_length=120)


@router.post("/me/takedowns/{reference}/counter-notice")
def counter_notice(reference: str, data: CounterIn, ctx: Ctx = Depends(signed_in)):
    from app.config import settings
    from app.core import audit
    from app.core.audit import USER, Actor
    from app.core.services import mailer

    if not (data.good_faith and data.consent_jurisdiction):
        raise err(400, "counter_notice_statements_needed")
    if data.signature.strip().lower() != data.full_name.strip().lower():
        raise err(400, "counter_notice_signature_mismatch")
    with platform_session(Actor(USER, user_id=ctx.user.id, label=ctx.user.email)) as db:
        t = db.execute(select(Takedown).where(Takedown.reference == reference.upper())).scalars().first()
        if t is None or t.target_tenant_id != ctx.tenant_id:
            raise err(404, "action_not_allowed")
        if t.kind != "copyright" or t.status != "actioned" or t.counter_notice is not None:
            raise err(409, "counter_notice_not_open")
        t.counter_notice = {**data.model_dump(), "user_id": ctx.user.id}
        t.countered_at = trust.now()
        t.restore_due_at = trust.business_days_after(t.countered_at, settings.COUNTER_NOTICE_RESTORE_DAYS)
        t.status = "countered"
        audit.record(db, action="takedown.counter_notice", target_table="kv_trust.takedowns", target_id=t.id,
                     after={"reference": t.reference, "restore_due_at": iso(t.restore_due_at)})
        statement = (f"{data.full_name}\n{data.address}\n{data.phone} · {data.email}\n\n{data.statement}\n\n"
                     "I swear, under penalty of perjury, that I have a good faith belief that the material was removed as a "
                     "result of mistake or misidentification. I consent to the jurisdiction of the court for my address, "
                     f"and will accept service of process from the person who gave the notice.\nSigned: {data.signature}")
        mailer.send(db, "counter_notice_claimant", t.complainant_email,
                    {"reference": t.reference, "statement": statement, "restore_due": t.restore_due_at.strftime("%d %b %Y")})
        db.commit()
        return _my_takedown(t, db.get(Video, t.video_id) if t.video_id else None)


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
