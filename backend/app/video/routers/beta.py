from __future__ import annotations

import base64
import binascii
import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import Response as RawResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.config import settings
from app.core import audit
from app.core.messages import err
from app.core.models.beta import Feedback, InviteCode, MailOutbox, WaitlistEntry
from app.core.services import beta, mailer
from app.database import SessionLocal
from app.video.present import iso
from app.video.routers import limits
from app.video.routers.deps import Ctx, StudioCtx, Viewer, optional_viewer, platform, studio

router = APIRouter(prefix="/api/video", tags=["beta"])
EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def now() -> datetime:
    return datetime.now(timezone.utc)


class WaitlistIn(BaseModel):
    email: str = Field(pattern=EMAIL, max_length=200)
    name: str = Field(default="", max_length=120)
    role: str = "viewer"
    country: str = Field(default="IN", min_length=2, max_length=2)
    language: str = "en"
    note: str = Field(default="", max_length=1000)
    channel_url: str | None = Field(default=None, max_length=300)


@router.post("/waitlist", status_code=202, dependencies=[Depends(limits.waitlist)])
def join_waitlist(data: WaitlistIn):
    if data.role not in ("viewer", "creator", "brand"):
        raise err(400, "action_not_allowed")
    email = data.email.strip().lower()
    token = secrets.token_urlsafe(24)
    db = SessionLocal()
    try:
        row = db.execute(select(WaitlistEntry).where(WaitlistEntry.email == email)).scalars().first()
        if row is None:
            row = WaitlistEntry(email=email, status="pending")
            db.add(row)
        if row.status in ("pending", "removed"):
            row.name, row.role, row.country = data.name.strip(), data.role, data.country.upper()
            row.language = "hi" if data.language == "hi" else "en"
            row.note, row.channel_url = data.note.strip(), (data.channel_url or "").strip() or None
            row.status, row.confirm_hash = "pending", hashlib.sha256(token.encode()).hexdigest()
            link = f"{settings.WEB_BASE_URL.rstrip('/')}/waitlist/confirm?token={token}"
            mailer.send(db, "waitlist_confirm", email, {"name": row.name or email.split("@")[0], "link": link}, row.language)
        db.commit()
    finally:
        db.close()
    return {"ok": True, "message": "Check your inbox to confirm your place."}


class ConfirmIn(BaseModel):
    token: str = Field(min_length=10, max_length=100)


@router.post("/waitlist/confirm")
def confirm_waitlist(data: ConfirmIn):
    db = SessionLocal()
    try:
        row = db.execute(select(WaitlistEntry).where(
            WaitlistEntry.confirm_hash == hashlib.sha256(data.token.encode()).hexdigest())).scalars().first()
        if row is None:
            raise err(404, "link_invalid_or_used")
        if row.status == "pending":
            row.status, row.confirmed_at = "confirmed", now()
        row.confirm_hash = None
        db.commit()
        return {"ok": True, "status": row.status}
    finally:
        db.close()


class CodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=40)


@router.post("/invites/check", dependencies=[Depends(limits.invite_check)])
def check_invite(data: CodeIn):
    db = SessionLocal()
    try:
        row = beta.lookup(db, data.code)
        return {"valid": row is not None, "role": row.role if row else None}
    finally:
        db.close()


@router.get("/beta")
def beta_state():
    return {"signup": beta.signup_mode(), "creator": beta.creator_mode()}


@router.get("/company")
def company(response: Response):
    from app.core.models.tenant import Tenant
    from app.video.sessions import platform_session

    with platform_session() as db:
        t = db.execute(select(Tenant).where(Tenant.slug == settings.ADMIN_TENANT_SLUG)).scalars().first()
        extra = dict((t.settings or {}) if t else {})
        officer = extra.get("grievance_officer") or {}
        place = ", ".join(p for p in (t.address, t.city, t.state, t.pin_code) if p) if t else ""
        out = {"name": t.name if t else "", "address": place, "gstin": (t.gst_number or "") if t else "",
               "cin": str(extra.get("cin") or ""), "email": (t.email or "") if t else "", "phone": (t.phone or "") if t else "",
               "privacy_email": str(extra.get("privacy_email") or ""), "legal_email": str(extra.get("legal_email") or ""),
               "grievance_officer": {k: str(officer.get(k) or "") for k in ("name", "email", "phone")}}
    response.headers["Cache-Control"] = "public, max-age=300"
    return out


class FeedbackIn(BaseModel):
    kind: str = "other"
    body: str = Field(min_length=3, max_length=5000)
    page: str = Field(default="", max_length=300)
    app: str = Field(default="web", max_length=12)
    app_version: str = Field(default="", max_length=40)
    email: str | None = Field(default=None, pattern=EMAIL, max_length=200)
    screenshot: str | None = Field(default=None, max_length=2_100_000)


def _image(data_url: str) -> tuple[bytes, str]:
    head, _, b64 = data_url.partition(",")
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise err(400, "screenshot_not_image")
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, "image/png"
    if raw[:3] == b"\xff\xd8\xff":
        return raw, "image/jpeg"
    raise err(400, "screenshot_not_image")


@router.post("/feedback", status_code=201, dependencies=[Depends(limits.feedback)])
def send_feedback(data: FeedbackIn, request: Request, viewer: Viewer = Depends(optional_viewer)):
    if data.kind not in ("bug", "idea", "other"):
        raise err(400, "action_not_allowed")
    if data.app not in ("web", "studio", "admin", "mobile", "tv"):
        raise err(400, "action_not_allowed")
    user = viewer.user
    db = SessionLocal()
    try:
        row = Feedback(user_id=user.id if user else None, tenant_id=user.tenant_id if user else None,
                       email=(user.email if user else (data.email or "").lower()) or None, kind=data.kind,
                       body=data.body.strip(), page=data.page[:300], app=data.app, app_version=data.app_version,
                       user_agent=(request.headers.get("user-agent") or "")[:300])
        db.add(row)
        db.flush()
        if data.screenshot:
            raw, ctype = _image(data.screenshot)
            from app.video.storage import backend

            key = f"feedback/{row.id}-{secrets.token_hex(6)}.{'png' if ctype == 'image/png' else 'jpg'}"
            backend().put(key, raw, ctype)
            row.screenshot_key = key
        reference = f"FB-{row.id:06d}"
        if row.email:
            lang = (user.settings or {}).get("language", "en") if user else "en"
            mailer.send(db, "feedback_received", row.email, {"reference": reference}, "hi" if lang == "hi" else "en")
        db.commit()
        return {"id": row.id, "reference": reference}
    finally:
        db.close()


@router.get("/studio/onboarding")
def onboarding(ctx: StudioCtx = Depends(studio("video.dashboard", need_channel=False))):
    from app.video.models.media import LiveStream, Video
    from app.video.models.payouts import PayoutAccount
    from app.video.models.social import ConnectedChannel

    db, tid, ch = ctx.db, ctx.tenant_id, ctx.channel
    videos = db.execute(select(func.count(Video.id)).where(Video.tenant_id == tid, Video.is_deleted.is_(False))).scalar() or 0
    published = db.execute(select(func.count(Video.id)).where(Video.tenant_id == tid, Video.status == "published",
                                                               Video.is_deleted.is_(False))).scalar() or 0
    payout = db.execute(select(PayoutAccount.status).where(PayoutAccount.tenant_id == tid)).scalar()
    yt = db.execute(select(ConnectedChannel.id).where(ConnectedChannel.tenant_id == tid, ConnectedChannel.platform == "youtube",
                                                      ConnectedChannel.status == "active")).first()
    live = db.execute(select(LiveStream.id).where(LiveStream.tenant_id == tid, LiveStream.started_at.is_not(None))).first()
    steps = [
        {"key": "channel", "label": "Open your channel", "done": ch is not None, "href": "/channel"},
        {"key": "profile", "label": "Add an avatar and an about line", "done": bool(ch and ch.avatar_key and (ch.about or "").strip()),
         "href": "/channel"},
        {"key": "upload", "label": "Upload your first video", "done": videos > 0, "href": "/videos?upload=1"},
        {"key": "publish", "label": "Publish a video", "done": published > 0, "href": "/videos"},
        {"key": "youtube", "label": "Connect your YouTube channel (optional)", "done": yt is not None, "href": "/channel",
         "optional": True},
        {"key": "payouts", "label": "Set up payouts to earn", "done": payout == "activated", "href": "/earnings", "optional": True},
        {"key": "live", "label": "Go live once", "done": live is not None, "href": "/live", "optional": True},
    ]
    if ctx.member is not None:
        from app.core.services import teams

        steps = [s for s in steps if s["key"] != "payouts" and not (s["key"] in ("channel", "profile", "youtube") and
                                                                    teams.level(db, tid, ctx.member.role, "video.channels") < 2)]
    need = [s for s in steps if not s.get("optional")]
    return {"steps": steps, "done": sum(s["done"] for s in need), "total": len(need),
            "complete": all(s["done"] for s in need)}


def _code_out(c: InviteCode) -> dict:
    return {"id": c.id, "hint": c.hint, "role": c.role, "email": c.email, "note": c.note, "max_uses": c.max_uses,
            "used": c.used, "expires_at": iso(c.expires_at), "revoked_at": iso(c.revoked_at), "created_at": iso(c.created_at)}


def _wait_out(w: WaitlistEntry) -> dict:
    return {"id": w.id, "email": w.email, "name": w.name, "role": w.role, "country": w.country, "language": w.language,
            "note": w.note, "channel_url": w.channel_url, "status": w.status, "created_at": iso(w.created_at),
            "confirmed_at": iso(w.confirmed_at), "invited_at": iso(w.invited_at)}


@router.get("/admin/beta/waitlist")
def admin_waitlist(response: Response, status: str | None = None, role: str | None = None, q: str | None = None,
                   limit: int = Query(100, le=500), offset: int = 0, ctx: Ctx = Depends(platform("admin.beta"))):
    query = select(WaitlistEntry)
    if status:
        query = query.where(WaitlistEntry.status == status)
    if role:
        query = query.where(WaitlistEntry.role == role)
    if q:
        query = query.where(WaitlistEntry.email.ilike(f"%{q.strip()}%"))
    total = ctx.db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = ctx.db.execute(query.order_by(WaitlistEntry.created_at).limit(limit).offset(offset)).scalars().all()
    response.headers["X-Total-Count"] = str(total)
    counts = dict(ctx.db.execute(select(WaitlistEntry.status, func.count(WaitlistEntry.id)).group_by(WaitlistEntry.status)).all())
    return {"items": [_wait_out(w) for w in rows], "counts": counts}


class InviteWaitlistIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)
    days: int = Field(default=30, ge=1, le=365)


@router.post("/admin/beta/waitlist/invite")
def invite_waitlist(data: InviteWaitlistIn, ctx: Ctx = Depends(platform("admin.beta", "full"))):
    sent = 0
    for w in ctx.db.execute(select(WaitlistEntry).where(WaitlistEntry.id.in_(data.ids))).scalars().all():
        if w.status not in ("pending", "confirmed"):
            continue
        role = "creator" if w.role == "creator" else "viewer"
        row, code = beta.make(ctx.db, role=role, days=data.days, email=w.email, note=f"waitlist #{w.id}",
                              created_by=ctx.user.id)
        w.status, w.invited_at, w.invite_id = "invited", now(), row.id
        link = f"{settings.WEB_BASE_URL.rstrip('/')}/signup?invite={code}"
        mailer.send(ctx.db, "invite", w.email, {"name": w.name or w.email.split("@")[0], "code": code, "link": link,
                                                "uses": 1, "expires": row.expires_at.strftime("%d %b %Y")}, w.language)
        sent += 1
    audit.record(ctx.db, action="beta.invite_waitlist", target_table="kv_admin.waitlist", target_id=None,
                 after={"ids": data.ids, "sent": sent})
    ctx.db.commit()
    return {"invited": sent}


class NewCodeIn(BaseModel):
    role: str = "viewer"
    max_uses: int = Field(default=1, ge=1, le=10000)
    days: int | None = Field(default=30, ge=1, le=365)
    email: str | None = Field(default=None, pattern=EMAIL, max_length=200)
    note: str = Field(default="", max_length=200)
    send: bool = False


@router.post("/admin/beta/codes", status_code=201)
def new_code(data: NewCodeIn, ctx: Ctx = Depends(platform("admin.beta", "full"))):
    if data.role not in ("viewer", "creator"):
        raise err(400, "action_not_allowed")
    row, code = beta.make(ctx.db, role=data.role, max_uses=data.max_uses, days=data.days, email=data.email, note=data.note,
                          created_by=ctx.user.id)
    if data.send and data.email:
        mailer.send(ctx.db, "invite", data.email, {"name": data.email.split("@")[0], "code": code,
                                                   "link": f"{settings.WEB_BASE_URL.rstrip('/')}/signup?invite={code}",
                                                   "uses": row.max_uses,
                                                   "expires": row.expires_at.strftime("%d %b %Y") if row.expires_at else "never"})
    audit.record(ctx.db, action="beta.code_created", target_table="kv_admin.invite_codes", target_id=row.id,
                 after={"role": row.role, "max_uses": row.max_uses, "hint": row.hint})
    ctx.db.commit()
    return {**_code_out(row), "code": code}


@router.get("/admin/beta/codes")
def list_codes(response: Response, limit: int = Query(100, le=500), offset: int = 0,
               ctx: Ctx = Depends(platform("admin.beta"))):
    total = ctx.db.execute(select(func.count(InviteCode.id))).scalar() or 0
    rows = ctx.db.execute(select(InviteCode).order_by(InviteCode.id.desc()).limit(limit).offset(offset)).scalars().all()
    response.headers["X-Total-Count"] = str(total)
    return [_code_out(c) for c in rows]


@router.post("/admin/beta/codes/{code_id}/revoke")
def revoke_code(code_id: int, ctx: Ctx = Depends(platform("admin.beta", "full"))):
    row = ctx.db.get(InviteCode, code_id)
    if row is None:
        raise err(404, "action_not_allowed")
    row.revoked_at = row.revoked_at or now()
    audit.record(ctx.db, action="beta.code_revoked", target_table="kv_admin.invite_codes", target_id=row.id)
    ctx.db.commit()
    return _code_out(row)


@router.get("/admin/beta/outbox")
def outbox(response: Response, to: str | None = None, template: str | None = None, limit: int = Query(50, le=200),
           offset: int = 0, ctx: Ctx = Depends(platform("admin.beta"))):
    query = select(MailOutbox)
    if to:
        query = query.where(MailOutbox.to_email == to.strip().lower())
    if template:
        query = query.where(MailOutbox.template == template)
    total = ctx.db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = ctx.db.execute(query.order_by(MailOutbox.id.desc()).limit(limit).offset(offset)).scalars().all()
    response.headers["X-Total-Count"] = str(total)
    return [{"id": m.id, "template": m.template, "language": m.language, "to": m.to_email, "subject": m.subject,
             "body_text": m.body_text, "body_html": m.body_html, "provider": m.provider, "status": m.status, "error": m.error,
             "created_at": iso(m.created_at)} for m in rows]


@router.get("/admin/feedback")
def list_feedback(response: Response, status: str | None = None, kind: str | None = None, app: str | None = None,
                  limit: int = Query(50, le=200), offset: int = 0, ctx: Ctx = Depends(platform("admin.beta"))):
    query = select(Feedback)
    if status:
        query = query.where(Feedback.status == status)
    if kind:
        query = query.where(Feedback.kind == kind)
    if app:
        query = query.where(Feedback.app == app)
    total = ctx.db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = ctx.db.execute(query.order_by(Feedback.id.desc()).limit(limit).offset(offset)).scalars().all()
    response.headers["X-Total-Count"] = str(total)
    return [{"id": f.id, "reference": f"FB-{f.id:06d}", "kind": f.kind, "body": f.body, "page": f.page, "app": f.app,
             "app_version": f.app_version, "email": f.email, "user_id": f.user_id, "status": f.status,
             "admin_note": f.admin_note, "has_screenshot": bool(f.screenshot_key), "user_agent": f.user_agent,
             "created_at": iso(f.created_at)} for f in rows]


class FeedbackPatch(BaseModel):
    status: str
    admin_note: str = Field(default="", max_length=2000)


@router.patch("/admin/feedback/{feedback_id}")
def triage_feedback(feedback_id: int, data: FeedbackPatch, ctx: Ctx = Depends(platform("admin.beta", "full"))):
    row = ctx.db.get(Feedback, feedback_id)
    if row is None or data.status not in ("new", "triaged", "done", "wontfix"):
        raise err(404, "action_not_allowed")
    row.status, row.admin_note = data.status, data.admin_note.strip()
    ctx.db.commit()
    return {"id": row.id, "status": row.status, "admin_note": row.admin_note}


@router.get("/admin/feedback/{feedback_id}/screenshot")
def feedback_screenshot(feedback_id: int, ctx: Ctx = Depends(platform("admin.beta"))):
    row = ctx.db.get(Feedback, feedback_id)
    if row is None or not row.screenshot_key:
        raise err(404, "action_not_allowed")
    from app.video.storage import backend

    data = backend().get(row.screenshot_key)
    return RawResponse(data, media_type="image/png" if row.screenshot_key.endswith(".png") else "image/jpeg",
                       headers={"Cache-Control": "private, no-store"})
