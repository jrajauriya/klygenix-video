from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.config import settings
from app.core import audit
from app.core.messages import err
from app.core.models.activity_log import ActivityLog
from app.core.models.beta import MailOutbox
from app.core.models.impersonation import ImpersonationSession
from app.core.models.team import TenantMember
from app.core.models.user import User
from app.core.services.auth_service import create_access_token
from app.video.models.commerce import Checkout, Payment
from app.video.models.onboarding import ChannelHandle
from app.video.models.payouts import Refund
from app.video.models.social import Channel
from app.video.models.trust import Report, Strike, Takedown
from app.video.present import iso
from app.video.routers.deps import Ctx, platform

router = APIRouter(prefix="/api/video/admin/support", tags=["admin-support"])
KEY = "admin.support"


class ReasonIn(BaseModel):
    reason: str = Field(min_length=5, max_length=300)


def _user(db, user_id: int) -> User:
    u = db.get(User, user_id)
    if u is None:
        raise err(status.HTTP_404_NOT_FOUND, "user_not_found")
    return u


def _card(db, u: User) -> dict:
    ch = db.execute(select(Channel).where(Channel.tenant_id == u.tenant_id)).scalars().first() if u.tenant_id else None
    return {"id": u.id, "email": u.email, "name": u.name, "tenant_id": u.tenant_id, "role": u.role, "is_active": u.is_active,
            "verified": u.email_verified_at is not None, "home_region": u.home_region, "created_at": iso(u.created_at),
            "last_login": iso(u.last_login), "two_step": u.totp_enabled_at is not None,
            "channel": {"id": ch.id, "handle": ch.handle, "name": ch.name, "strikes": ch.strike_count,
                        "suspended": ch.is_suspended} if ch else None}


@router.get("/lookup")
def lookup(q: str = Query(min_length=2, max_length=120), ctx: Ctx = Depends(platform(KEY))):
    db, term = ctx.db, q.strip()
    ids: list[int] = []
    if term.isdigit():
        ids.append(int(term))
    handle = term.lower().lstrip("@")
    owners = select(User.id).join(Channel, Channel.tenant_id == User.tenant_id).where(
        or_(Channel.handle == handle, Channel.tenant_id.in_(select(ChannelHandle.tenant_id).where(ChannelHandle.handle == handle))))
    ids += list(db.execute(owners).scalars())
    ids += list(db.execute(select(Checkout.user_id).join(Payment, Payment.checkout_id == Checkout.id).where(
        or_(Payment.gateway_payment_id == term, Checkout.gateway_order_id == term))).scalars())
    rows = db.execute(select(User).where(or_(User.id.in_(ids or [0]), func.lower(User.email).contains(term.lower()),
                                             func.lower(User.name).contains(term.lower())))
                      .order_by(User.id.desc()).limit(25)).scalars().all()
    return [_card(db, u) for u in rows]


@router.get("/users/{user_id}")
def account(user_id: int, ctx: Ctx = Depends(platform(KEY))):
    db = ctx.db
    u = _user(db, user_id)
    tid = u.tenant_id or 0
    events: list[dict] = [{"at": iso(u.created_at), "kind": "signup", "title": "Signed up", "detail": u.email}]
    if u.email_verified_at:
        events.append({"at": iso(u.email_verified_at), "kind": "verified", "title": "Email confirmed", "detail": ""})
    for a in db.execute(select(ActivityLog).where(ActivityLog.user_id == u.id, ActivityLog.kind == "login")
                        .order_by(ActivityLog.occurred_at.desc()).limit(30)).scalars():
        events.append({"at": a.occurred_at.replace(tzinfo=timezone.utc).isoformat(), "kind": "sign_in", "title": "Signed in",
                       "detail": " · ".join(x for x in (a.ip, (a.user_agent or "")[:80]) if x)})
    pays = db.execute(select(Checkout, Payment).outerjoin(Payment, Payment.checkout_id == Checkout.id)
                      .where(Checkout.user_id == u.id).order_by(Checkout.id.desc()).limit(50)).all()
    from app.video.commerce.refunds import refunded

    for chk, pay in pays:
        events.append({"at": iso(chk.paid_at or chk.created_at), "kind": "purchase", "title": f"{chk.purpose.title()} · {chk.status}",
                       "detail": f"{chk.currency} {chk.amount_minor / 100:.2f} · {chk.rail}", "payment_id": pay.id if pay else None,
                       "amount_minor": chk.amount_minor,
                       "refundable_minor": pay.amount_minor - refunded(db, pay.id) if pay else None})
    for r in db.execute(select(Refund).join(Payment, Payment.id == Refund.payment_id).join(Checkout, Checkout.id == Payment.checkout_id)
                        .where(Checkout.user_id == u.id).order_by(Refund.id.desc()).limit(50)).scalars():
        events.append({"at": iso(r.created_at), "kind": "refund", "title": f"Refund {r.status}",
                       "detail": f"{r.amount_minor / 100:.2f} · {r.reason}", "payment_id": r.payment_id, "amount_minor": r.amount_minor})
    for s in db.execute(select(Strike).where(Strike.tenant_id == tid).order_by(Strike.id.desc()).limit(20)).scalars():
        events.append({"at": iso(s.created_at), "kind": "strike", "title": "Strike" + (" (lifted)" if s.lifted_at else ""),
                       "detail": s.reason[:160], "strike_id": s.id})
    for r in db.execute(select(Report).where(or_(Report.reporter_user_id == u.id, Report.target_tenant_id == tid))
                        .order_by(Report.id.desc()).limit(30)).scalars():
        mine = r.reporter_user_id == u.id
        events.append({"at": iso(r.created_at), "kind": "report", "title": "Filed a report" if mine else "Reported by someone",
                       "detail": f"{r.target_type} · {r.reason} · {r.status}"})
    for t in db.execute(select(Takedown).where(Takedown.target_tenant_id == tid).order_by(Takedown.id.desc()).limit(20)).scalars():
        events.append({"at": iso(t.received_at), "kind": "takedown", "title": f"Takedown {t.reference}", "detail": f"{t.kind} · {t.status}"})
    for m in db.execute(select(MailOutbox).where(MailOutbox.to_email == u.email.lower()).order_by(MailOutbox.id.desc()).limit(30)).scalars():
        events.append({"at": iso(m.created_at), "kind": "mail", "title": f"Mail: {m.subject}", "detail": f"{m.template} · {m.status}"})
    for m in db.execute(select(TenantMember).where(or_(TenantMember.user_id == u.id, TenantMember.tenant_id == tid))
                        .order_by(TenantMember.id.desc()).limit(30)).scalars():
        events.append({"at": iso(m.accepted_at or m.created_at), "kind": "team",
                       "title": f"Team {m.status}: {m.role}", "detail": m.email if m.tenant_id == tid else f"channel tenant {m.tenant_id}"})
    events.sort(key=lambda e: e["at"] or "", reverse=True)
    return {"user": _card(db, u), "events": events[:200]}


@router.post("/users/{user_id}/sign-out")
def sign_out(user_id: int, data: ReasonIn, ctx: Ctx = Depends(platform(KEY, "full"))):
    u = _user(ctx.db, user_id)
    u.session_epoch = int(u.session_epoch or 0) + 1
    audit.record(ctx.db, action="support.sign_out", target_table="kv_admin.users", target_id=u.id, after={"reason": data.reason})
    ctx.db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/verify-email")
def resend_verify(user_id: int, ctx: Ctx = Depends(platform(KEY, "full"))):
    from app.core.services import account as accounts

    u = _user(ctx.db, user_id)
    if u.email_verified_at is not None:
        return {"ok": True, "sent": False}
    token = accounts.issue_token(ctx.db, u, "verify")
    audit.record(ctx.db, action="support.verify_resend", target_table="kv_admin.users", target_id=u.id)
    ctx.db.commit()
    return {"ok": True, "sent": bool(accounts.send_link(ctx.db, u, "verify", token))}


@router.post("/users/{user_id}/support-session", status_code=201)
def support_session(user_id: int, data: ReasonIn, ctx: Ctx = Depends(platform(KEY, "full"))):
    u = _user(ctx.db, user_id)
    if u.role == "global_admin" or u.id == ctx.user.id:
        raise err(status.HTTP_403_FORBIDDEN, "insufficient_permissions")
    if u.tenant_id is None:
        raise err(status.HTTP_409_CONFLICT, "tenant_context_required")
    minutes = settings.IMPERSONATION_MINUTES
    row = ImpersonationSession(tenant_id=u.tenant_id, staff_user_id=ctx.user.id, target_user_id=u.id, reason=data.reason,
                               expires_at=datetime.now(timezone.utc) + timedelta(minutes=minutes))
    ctx.db.add(row)
    ctx.db.flush()
    audit.record(ctx.db, action="support.session", target_table="kv_admin.users", target_id=u.id,
                 after={"session_id": row.id, "reason": data.reason, "minutes": minutes})
    ctx.db.commit()
    token = create_access_token({"user_id": u.id, "tenant_id": u.tenant_id, "role": u.role, "ep": u.session_epoch,
                                 "imp": row.id, "imp_by": ctx.user.email}, minutes=minutes)
    return {"access_token": token, "session_id": row.id, "expires_at": iso(row.expires_at), "read_only": True}


@router.post("/sessions/{session_id}/end")
def end_session(session_id: int, ctx: Ctx = Depends(platform(KEY, "full"))):
    row = ctx.db.get(ImpersonationSession, session_id)
    if row is None:
        raise err(status.HTTP_404_NOT_FOUND, "support_session_has_ended")
    row.ended_at = row.ended_at or datetime.now(timezone.utc)
    audit.record(ctx.db, action="support.session_end", target_table="kv_admin.impersonation_sessions", target_id=row.id)
    ctx.db.commit()
    return {"ok": True}
