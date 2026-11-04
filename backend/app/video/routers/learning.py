from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text

from app.ai import embed as embedder
from app.ai import multi, study
from app.ai.textkit import fmt_ts, lexical
from app.core.messages import err
from app.video.commerce import access, quotas
from app.video.models.ai import AskMessage, Segment, StudySet, Transcript
from app.video.models.community import Note, QuizAttempt
from app.video.models.media import Video
from app.video.models.social import Channel, Playlist, PlaylistItem
from app.video.present import iso
from app.video.routers import limits
from app.video.routers.deps import Ctx, Viewer, optional_viewer, signed_in
from app.video.routers.watch import insight_for, readable
from app.video.sessions import platform_session
from app.video.services import handles

router = APIRouter(prefix="/api/video", tags=["learning"])


def _public(item: dict, kind: str) -> dict:
    if kind == "quiz":
        return {k: v for k, v in item.items() if k != "answer"}
    return item


def _set(db, video: Video, kind: str, lang: str, user=None, tenant_id: int | None = None) -> StudySet:
    from app.video.pipeline.jobs import current_cues

    row = db.execute(select(StudySet).where(StudySet.video_id == video.id, StudySet.kind == kind,
                                            StudySet.language == lang)).scalars().first()
    if row is not None:
        return row
    if video.ai_status != "ready":
        raise err(409, "ai_not_available_for_video")
    if user is None:
        raise err(401, "action_not_allowed")
    per = None
    try:
        per = quotas.reserve(db, user.tenant_id, user.id, "ask", 1)
        db.commit()
    except quotas.QuotaExceeded as exc:
        db.rollback()
        raise quotas.refuse(exc)
    try:
        cues = current_cues(db, video.id)
        insight = insight_for(db, video, lang)
        items, model = study.generate(kind, cues, video.duration_ms, insight.chapters if insight else [], lang,
                                      video.tenant_id)
        if not study.grounded(items, {c.start_ms for c in cues}, video.duration_ms):
            items = []
    except Exception:
        quotas.release(db, user.tenant_id, user.id, "ask", 1, per)
        db.commit()
        raise err(503, "ai_not_available_for_video")
    row = StudySet(tenant_id=video.tenant_id, video_id=video.id, language=lang, kind=kind, items=items, model=model)
    db.add(row)
    quotas.commit(db, user.tenant_id, user.id, "ask", 1, per)
    try:
        db.commit()
    except Exception:
        db.rollback()
        row = db.execute(select(StudySet).where(StudySet.video_id == video.id, StudySet.kind == kind,
                                                StudySet.language == lang)).scalars().one()
    return row


@router.get("/videos/{public_id}/study/{kind}")
def get_study(public_id: str, kind: str, lang: str | None = None, viewer: Viewer = Depends(optional_viewer)):
    if kind not in study.KINDS:
        raise err(404, "video_not_found")
    v = readable(viewer, public_id)
    access.guard(viewer.user, v)
    with platform_session() as db:
        row = _set(db, db.get(Video, v.id), kind, lang or v.language, viewer.user)
        return {"kind": kind, "language": row.language, "model": row.model,
                "items": [_public(i, kind) for i in row.items]}


class QuizIn(BaseModel):
    answers: list[int] = Field(max_length=20)


@router.post("/videos/{public_id}/quiz/attempts", status_code=201)
def quiz_attempt(public_id: str, data: QuizIn, lang: str | None = None, ctx: Ctx = Depends(signed_in)):
    v = readable(Viewer(db=ctx.db, user=ctx.user), public_id)
    access.guard(ctx.user, v)
    with platform_session() as db:
        row = db.execute(select(StudySet).where(StudySet.video_id == v.id, StudySet.kind == "quiz",
                                                StudySet.language == (lang or v.language))).scalars().first()
    if row is None or not row.items:
        raise err(409, "ai_not_available_for_video")
    graded = []
    for i, q in enumerate(row.items):
        given = data.answers[i] if i < len(data.answers) else None
        graded.append({"index": i, "given": given, "correct": q["answer"], "right": given == q["answer"],
                       "t_ms": q["t_ms"], "label": q["label"]})
    score = sum(1 for g in graded if g["right"])
    a = QuizAttempt(tenant_id=ctx.tenant_id, user_id=ctx.user.id, video_id=v.id, study_set_id=row.id, score=score,
                    total=len(graded), answers=graded)
    ctx.db.add(a)
    ctx.db.commit()
    return {"id": a.id, "score": score, "total": len(graded), "results": graded}


@router.get("/videos/{public_id}/quiz/attempts")
def quiz_attempts(public_id: str, ctx: Ctx = Depends(signed_in)):
    v = readable(Viewer(db=ctx.db, user=ctx.user), public_id)
    rows = ctx.db.execute(select(QuizAttempt).where(QuizAttempt.user_id == ctx.user.id, QuizAttempt.video_id == v.id)
                          .order_by(QuizAttempt.id.desc()).limit(20)).scalars().all()
    return [{"id": a.id, "score": a.score, "total": a.total, "created_at": iso(a.created_at)} for a in rows]


class NoteIn(BaseModel):
    t_ms: int = Field(ge=0)
    body: str = Field(min_length=1, max_length=2000)


def note_out(n: Note) -> dict:
    return {"id": n.id, "t_ms": n.t_ms, "label": fmt_ts(n.t_ms), "body": n.body, "created_at": iso(n.created_at)}


@router.get("/me/study")
def my_study(limit: int = 50, ctx: Ctx = Depends(signed_in)):
    uid = ctx.user.id
    notes = dict(ctx.db.execute(select(Note.video_id, func.count(Note.id)).where(Note.user_id == uid)
                                .group_by(Note.video_id)).all())
    noted = dict(ctx.db.execute(select(Note.video_id, func.max(Note.created_at)).where(Note.user_id == uid)
                                .group_by(Note.video_id)).all())
    best: dict[int, tuple[int, int]] = {}
    tried: dict = {}
    for vid, score, total, at in ctx.db.execute(select(QuizAttempt.video_id, QuizAttempt.score, QuizAttempt.total,
                                                       QuizAttempt.created_at).where(QuizAttempt.user_id == uid)).all():
        if vid not in best or score * best[vid][1] > best[vid][0] * total:
            best[vid] = (score, total)
        tried[vid] = max(tried.get(vid, at), at)
    ids = set(notes) | set(best)
    if not ids:
        return []
    videos = {v.id: v for v in ctx.db.execute(select(Video).where(Video.id.in_(ids), Video.is_deleted.is_(False),
                                                                  Video.status == "published")).scalars()}
    out = []
    for vid, v in videos.items():
        last = max(x for x in (noted.get(vid), tried.get(vid)) if x is not None)
        score = best.get(vid)
        out.append({"video": {"id": v.public_id, "title": v.title, "duration_ms": v.duration_ms},
                    "notes": notes.get(vid, 0), "best_score": score[0] if score else None,
                    "best_total": score[1] if score else None, "last_activity_at": iso(last)})
    out.sort(key=lambda x: x["last_activity_at"] or "", reverse=True)
    return out[:max(1, min(limit, 200))]


@router.get("/videos/{public_id}/notes")
def list_notes(public_id: str, ctx: Ctx = Depends(signed_in)):
    v = readable(Viewer(db=ctx.db, user=ctx.user), public_id)
    rows = ctx.db.execute(select(Note).where(Note.user_id == ctx.user.id, Note.video_id == v.id)
                          .order_by(Note.t_ms, Note.id)).scalars().all()
    return [note_out(n) for n in rows]


@router.post("/videos/{public_id}/notes", status_code=201)
def add_note(public_id: str, data: NoteIn, ctx: Ctx = Depends(signed_in)):
    v = readable(Viewer(db=ctx.db, user=ctx.user), public_id)
    if ctx.db.execute(select(func.count(Note.id)).where(Note.user_id == ctx.user.id, Note.video_id == v.id)).scalar() >= 200:
        raise err(409, "action_not_allowed")
    n = Note(tenant_id=ctx.tenant_id, user_id=ctx.user.id, video_id=v.id, t_ms=min(data.t_ms, max(v.duration_ms, 0)),
             body=data.body.strip())
    ctx.db.add(n)
    ctx.db.commit()
    return note_out(n)


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int, ctx: Ctx = Depends(signed_in)):
    n = ctx.db.get(Note, note_id)
    if n is None or n.user_id != ctx.user.id:
        raise err(404, "action_not_allowed")
    ctx.db.delete(n)
    ctx.db.commit()
    return Response(status_code=204)


def _scope_videos(db, user, scope: str, ref: str) -> tuple[int, list[Video]]:
    if scope == "channel":
        ch = handles.resolve(db, ref)[0]
        if ch is None or ch.is_suspended:
            raise err(404, "channel_not_found")
        vids = db.execute(select(Video).where(Video.channel_id == ch.id, Video.status == "published",
                                              Video.visibility == "public", Video.is_deleted.is_(False),
                                              Video.ai_status == "ready")).scalars().all()
        scope_id = ch.id
    else:
        pl = db.get(Playlist, int(ref)) if ref.isdigit() else None
        if pl is None or pl.visibility != "public":
            raise err(404, "playlist_not_found")
        vids = db.execute(select(Video).join(PlaylistItem, PlaylistItem.video_id == Video.id).where(
            PlaylistItem.playlist_id == pl.id, Video.status == "published", Video.is_deleted.is_(False),
            Video.ai_status == "ready")).scalars().all()
        scope_id = pl.id
    open_ = [v for v in vids if access.allowed(db, user, v)]
    return scope_id, open_, len(vids) - len(open_)


def _passages(db, videos: list[Video], question: str, k: int = 10) -> list[multi.Passage]:
    if not videos:
        return []
    by_id = {v.id: v for v in videos}
    vec = embedder.embed([question])[0]
    dist = Segment.embedding.cosine_distance(vec)
    vrows = db.execute(select(Segment, dist.label("d")).join(Transcript, Transcript.id == Segment.transcript_id).where(
        Segment.video_id.in_(by_id), Transcript.is_current.is_(True), Segment.embedding.is_not(None))
        .order_by(dist).limit(k * 2)).all()
    tsq = func.websearch_to_tsquery("simple", question)
    trows = db.execute(select(Segment, func.ts_rank(Segment.search, tsq).label("r")).join(
        Transcript, Transcript.id == Segment.transcript_id).where(
        Segment.video_id.in_(by_id), Transcript.is_current.is_(True), Segment.search.op("@@")(tsq))
        .order_by(text("r DESC")).limit(k * 2)).all()
    best: dict[int, multi.Passage] = {}

    def put(seg, score):
        v = by_id[seg.video_id]
        if seg.id not in best or best[seg.id].score < score:
            best[seg.id] = multi.Passage(v.public_id, v.title, seg.start_ms, seg.end_ms, seg.text, score)

    for seg, d in vrows:
        sim = 1 - float(d)
        put(seg, max(sim if sim >= 0.2 else 0.0, lexical(question, seg.text) * 0.6))
    for seg, r in trows:
        lex = lexical(question, seg.text)
        put(seg, max(min(1.0, float(r) * 2) if lex else 0.0, lex * 0.6))
    return sorted(best.values(), key=lambda p: -p.score)[:k]


class ScopedAsk(BaseModel):
    question: str = Field(min_length=2, max_length=500)


def _ask(scope: str, ref: str, data: ScopedAsk, request: Request, ctx: Ctx) -> dict:
    limits.ask(request)
    with platform_session() as db:
        scope_id, vids, skipped = _scope_videos(db, ctx.user, scope, ref)
        if not vids:
            raise err(409, "ai_not_available_for_video")
        try:
            per = quotas.reserve(ctx.db, ctx.tenant_id, ctx.user.id, "ask", 1)
            ctx.db.commit()
        except quotas.QuotaExceeded as exc:
            ctx.db.rollback()
            raise quotas.refuse(exc)
        try:
            passages = _passages(db, vids, data.question)
            durations = {v.public_id: max([v.duration_ms] + [p.end_ms for p in passages if p.video == v.public_id]) for v in vids}
            lang = (ctx.user.settings or {}).get("language") or vids[0].language
            answer = multi.ask(data.question.strip(), passages, durations, lang, ctx.tenant_id)
        except Exception:
            quotas.release(ctx.db, ctx.tenant_id, ctx.user.id, "ask", 1, per)
            ctx.db.commit()
            raise err(503, "ai_not_available_for_video")
    m = AskMessage(tenant_id=ctx.tenant_id, user_id=ctx.user.id, video_id=None, scope=scope, scope_id=scope_id,
                   question=data.question.strip(), answer=answer.text, citations=answer.citations, status=answer.status,
                   model=answer.model)
    ctx.db.add(m)
    if answer.status == "answered":
        quotas.commit(ctx.db, ctx.tenant_id, ctx.user.id, "ask", 1, per)
    else:
        quotas.release(ctx.db, ctx.tenant_id, ctx.user.id, "ask", 1, per)
    ctx.db.commit()
    return {"id": m.id, "scope": scope, "question": m.question, "answer": m.answer, "citations": m.citations,
            "status": m.status, "model": m.model, "videos": len(vids), "skipped_locked": skipped,
            "quota": quotas.usage(ctx.db, ctx.user.id, "ask")}


@router.post("/channels/{handle}/ask")
def ask_channel(handle: str, data: ScopedAsk, request: Request, ctx: Ctx = Depends(signed_in)):
    return _ask("channel", handle, data, request, ctx)


@router.post("/playlists/{playlist_id}/ask")
def ask_series(playlist_id: int, data: ScopedAsk, request: Request, ctx: Ctx = Depends(signed_in)):
    return _ask("series", str(playlist_id), data, request, ctx)
