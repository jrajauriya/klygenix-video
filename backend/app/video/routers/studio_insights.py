from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.messages import err
from app.video.models.media import Video
from app.video.models.social import Comment, Danmaku, Follow, ViewDaily
from app.video.present import iso
from app.video.routers.deps import StudioCtx, studio
from app.video.sessions import platform_session
from app.video.social import counters

router = APIRouter(prefix="/api/video/studio", tags=["studio"])


def window(start: date | None, end: date | None) -> tuple[date, date]:
    end = end or date.today()
    start = start or end - timedelta(days=27)
    if start > end or (end - start).days > 366:
        raise err(400, "action_not_allowed")
    return start, end


def series(db, start: date, end: date, *where) -> list[dict]:
    rows = db.execute(select(ViewDaily.day, func.sum(ViewDaily.views), func.sum(ViewDaily.watch_ms),
                             func.sum(ViewDaily.completions), func.sum(ViewDaily.likes))
                      .where(ViewDaily.day >= start, ViewDaily.day <= end, *where).group_by(ViewDaily.day)).all()
    by_day = {d: (int(v or 0), int(w or 0), int(c or 0), int(lk or 0)) for d, v, w, c, lk in rows}
    out = []
    day = start
    while day <= end:
        v, w, c, lk = by_day.get(day, (0, 0, 0, 0))
        out.append({"day": day.isoformat(), "views": v, "watch_ms": w, "completions": c, "likes": lk})
        day += timedelta(days=1)
    return out


def mix(db, start: date, end: date, *where) -> tuple[list[int], dict]:
    curve = [0] * counters.BUCKETS
    sources: dict[str, int] = {}
    for ret, src in db.execute(select(ViewDaily.retention, ViewDaily.sources)
                               .where(ViewDaily.day >= start, ViewDaily.day <= end, *where)).all():
        for i, n in enumerate((ret or [])[:counters.BUCKETS]):
            curve[i] += int(n)
        for k, n in (src or {}).items():
            sources[k] = sources.get(k, 0) + int(n)
    return curve, sources


def retention_pct(curve: list[int]) -> list[float]:
    top = max(curve[:3] or [0]) or max(curve or [0])
    return [round(min(1.0, n / top), 4) if top else 0.0 for n in curve]


def source_rows(sources: dict) -> dict:
    main = sorted(((k, n) for k, n in sources.items() if not k.startswith("x:")), key=lambda x: -x[1])
    ext = sorted(((k[2:], n) for k, n in sources.items() if k.startswith("x:")), key=lambda x: -x[1])[:10]
    return {"sources": [{"source": k, "views": n} for k, n in main], "external": [{"host": k, "views": n} for k, n in ext]}


def revenue(db, tenant_id: int, start: date, end: date) -> dict:
    from datetime import datetime, timezone

    from app.video.models.payouts import CreatorSplit

    lo = datetime.combine(start, datetime.min.time(), timezone.utc) - timedelta(hours=5, minutes=30)
    hi = datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc) - timedelta(hours=5, minutes=30)
    rows = db.execute(select(CreatorSplit).where(CreatorSplit.tenant_id == tenant_id, CreatorSplit.paid_at >= lo,
                                                 CreatorSplit.paid_at < hi)).scalars().all()
    by_purpose: dict[str, dict] = {}
    by_day: dict[str, int] = {}
    for s in rows:
        p = by_purpose.setdefault(s.purpose, {"purpose": s.purpose, "sales": 0, "gross_minor": 0, "net_minor": 0})
        p["sales"] += 1
        p["gross_minor"] += s.gross_minor - s.refunded_minor
        p["net_minor"] += s.creator_net_minor
        day = (s.paid_at + timedelta(hours=5, minutes=30)).date().isoformat()
        by_day[day] = by_day.get(day, 0) + s.gross_minor - s.refunded_minor
    return {"currency": "INR", "by_purpose": sorted(by_purpose.values(), key=lambda x: -x["gross_minor"]),
            "by_day": [{"day": d, "gross_minor": n} for d, n in sorted(by_day.items())],
            "gross_minor": sum(p["gross_minor"] for p in by_purpose.values()),
            "net_minor": sum(p["net_minor"] for p in by_purpose.values())}


@router.get("/analytics")
def channel_analytics(start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to"),
                      ctx: StudioCtx = Depends(studio("video.analytics"))):
    start, end = window(start, end)
    db = ctx.db
    vids = db.execute(select(Video).where(Video.tenant_id == ctx.tenant_id, Video.is_deleted.is_(False))).scalars().all()
    pend = counters.pending("video", [v.id for v in vids])

    def total(field: str, pend_key: str) -> int:
        return sum(getattr(v, field) + (pend.get(v.id) or {}).get(pend_key, 0) for v in vids)

    with platform_session() as pdb:
        followers_gained = pdb.execute(select(func.count(Follow.id)).where(
            Follow.channel_id == ctx.channel.id, func.date(Follow.created_at) >= start,
            func.date(Follow.created_at) <= end)).scalar() or 0
    days = series(db, start, end, ViewDaily.tenant_id == ctx.tenant_id)
    top = sorted(vids, key=lambda v: -(v.view_count + (pend.get(v.id) or {}).get("view_count", 0)))[:10]
    return {
        "from": start.isoformat(), "to": end.isoformat(),
        "totals": {"videos": len(vids), "published": sum(1 for v in vids if v.status == "published"),
                   "views": total("view_count", "view_count"), "watch_ms": total("watch_ms", "watch_ms"),
                   "likes": total("like_count", "like_count"), "comments": total("comment_count", "comment_count"),
                   "danmaku": total("danmaku_count", "danmaku_count"), "completions": total("completions", "completions"),
                   "followers": ctx.channel.follower_count + counters.pending("channel", [ctx.channel.id]).get(
                       ctx.channel.id, {}).get("follower_count", 0)},
        "period": {"views": sum(d["views"] for d in days), "watch_ms": sum(d["watch_ms"] for d in days),
                   "completions": sum(d["completions"] for d in days), "likes": sum(d["likes"] for d in days),
                   "followers_gained": followers_gained},
        "days": days,
        **source_rows(mix(db, start, end, ViewDaily.tenant_id == ctx.tenant_id)[1]),
        "revenue": revenue(db, ctx.tenant_id, start, end),
        "top": [{"id": v.id, "public_id": v.public_id, "title": v.title, "kind": v.kind,
                 "views": v.view_count + (pend.get(v.id) or {}).get("view_count", 0),
                 "watch_ms": v.watch_ms + (pend.get(v.id) or {}).get("watch_ms", 0)} for v in top],
    }


@router.get("/videos/{video_id}/analytics")
def video_analytics(video_id: int, start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to"),
                    ctx: StudioCtx = Depends(studio("video.analytics"))):
    v = ctx.db.get(Video, video_id)
    if v is None or v.is_deleted or v.tenant_id != ctx.tenant_id:
        raise err(404, "video_not_found")
    start, end = window(start, end)
    days = series(ctx.db, start, end, ViewDaily.video_id == v.id)
    curve, sources = mix(ctx.db, start, end, ViewDaily.video_id == v.id)
    p = counters.pending("video", [v.id]).get(v.id) or {}
    views = v.view_count + p.get("view_count", 0)
    done = v.completions + p.get("completions", 0)
    watch = v.watch_ms + p.get("watch_ms", 0)
    return {
        "id": v.id, "public_id": v.public_id, "from": start.isoformat(), "to": end.isoformat(),
        "totals": {"views": views, "watch_ms": watch, "completions": done,
                   "likes": v.like_count + p.get("like_count", 0), "comments": v.comment_count + p.get("comment_count", 0),
                   "danmaku": v.danmaku_count + p.get("danmaku_count", 0),
                   "completion_rate": round(done / views, 4) if views else 0.0,
                   "avg_view_ms": watch // views if views else 0},
        "days": days,
        "retention": [{"at_pct": round((i + 0.5) * 100 / counters.BUCKETS, 1), "audience": pct}
                      for i, pct in enumerate(retention_pct(curve))] if any(curve) else [],
        **source_rows(sources),
    }


@router.get("/comments")
def comment_inbox(response: Response, status: str | None = None, video_id: int | None = None, kind: str = "comments",
                  limit: int = Query(30, le=100), offset: int = 0, ctx: StudioCtx = Depends(studio("video.comments"))):
    model = Danmaku if kind == "danmaku" else Comment
    with platform_session() as db:
        q = select(model, Video.public_id, Video.title).join(Video, Video.id == model.video_id).where(
            Video.tenant_id == ctx.tenant_id, Video.is_deleted.is_(False), model.status != "deleted")
        if status in ("visible", "hidden"):
            q = q.where(model.status == status)
        if video_id:
            q = q.where(Video.id == video_id)
        response.headers["X-Total-Count"] = str(db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0)
        rows = db.execute(q.order_by(model.created_at.desc(), model.id.desc()).limit(limit).offset(offset)).all()
        names: dict[int, str] = {}
        if kind == "danmaku" and rows:
            from app.video.models.social import Profile

            names = dict(db.execute(select(Profile.user_id, Profile.display_name).where(
                Profile.user_id.in_({r[0].user_id for r in rows}))).all())
        out = []
        for row, public_id, title in rows:
            item = {"id": row.id, "kind": "danmaku" if kind == "danmaku" else "comment", "video_id": row.video_id,
                    "video_public_id": public_id, "video_title": title, "status": row.status,
                    "report_count": getattr(row, "report_count", 0), "created_at": iso(row.created_at)}
            if kind == "danmaku":
                item.update(body=row.text, author=names.get(row.user_id, ""), t_ms=row.t_ms, mode=row.mode, color=row.color,
                            boost_tier=row.boost_tier, paid_minor=row.paid_minor)
            else:
                item.update(body=row.body, author=row.author_name, parent_id=row.parent_id, paid_minor=row.paid_minor)
            out.append(item)
        return out


class ModerateIn(BaseModel):
    status: str = Field(pattern=r"^(visible|hidden)$")
    kind: str = Field(default="comment", pattern=r"^(comment|danmaku)$")


@router.patch("/comments/{item_id}")
def moderate(item_id: int, data: ModerateIn, ctx: StudioCtx = Depends(studio("video.comments", "full"))):
    model = Danmaku if data.kind == "danmaku" else Comment
    with platform_session() as db:
        row = db.get(model, item_id)
        video = db.get(Video, row.video_id) if row is not None else None
        if row is None or video is None or video.tenant_id != ctx.tenant_id or row.status == "deleted":
            raise err(404, "video_not_found")
        before = row.status
        row.status = data.status
        db.commit()
        if data.kind == "comment" and before != data.status:
            counters.incr("video", video.id, "comment_count", 1 if data.status == "visible" else -1)
        return {"id": row.id, "kind": data.kind, "status": row.status}
