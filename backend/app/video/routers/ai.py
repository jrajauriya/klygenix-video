from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text

from app.ai import embed as embedder
from app.ai import intel
from app.ai.captions import parse, to_vtt
from app.ai.textkit import fmt_ts, lexical
from app.core.messages import err
from app.video.commerce import access, quotas
from app.video.models.ai import AskMessage, Segment, Transcript
from app.video.models.media import CaptionTrack, Video
from app.video.services.translit import roman
from app.video.models.social import Channel
from app.video.present import video_card
from app.video.routers import limits
from app.video.routers.deps import Ctx, Viewer, optional_viewer, signed_in
from app.video.routers.watch import LANGS, readable
from app.video.sessions import platform_session
from app.video.social import counters

router = APIRouter(prefix="/api/video", tags=["ai"])


def _passages(db, video: Video, question: str, k: int = 8) -> list[intel.Passage]:
    vec = embedder.embed([question])[0]
    dist = Segment.embedding.cosine_distance(vec)
    vrows = db.execute(select(Segment, dist.label("d")).join(Transcript, Transcript.id == Segment.transcript_id).where(
        Segment.video_id == video.id, Transcript.is_current.is_(True), Segment.embedding.is_not(None))
        .order_by(dist).limit(k)).all()
    tsq = func.websearch_to_tsquery("simple", question)
    trows = db.execute(select(Segment, func.ts_rank(Segment.search, tsq).label("r")).join(
        Transcript, Transcript.id == Segment.transcript_id).where(
        Segment.video_id == video.id, Transcript.is_current.is_(True), Segment.search.op("@@")(tsq))
        .order_by(text("r DESC")).limit(k)).all()
    best: dict[int, intel.Passage] = {}
    for seg, d in vrows:
        sim = 1 - float(d)
        score = max(sim if sim >= 0.2 else 0.0, lexical(question, seg.text) * 0.6)
        best[seg.id] = intel.Passage(seg.start_ms, seg.end_ms, seg.text, score)
    for seg, r in trows:
        lex = lexical(question, seg.text)
        score = max(min(1.0, float(r) * 2) if lex else 0.0, lex * 0.6, best[seg.id].score if seg.id in best else 0)
        best[seg.id] = intel.Passage(seg.start_ms, seg.end_ms, seg.text, score)
    return sorted(best.values(), key=lambda p: -p.score)[:k]


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)


def _ask_out(m: AskMessage) -> dict:
    return {"id": m.id, "question": m.question, "answer": m.answer, "citations": m.citations, "status": m.status,
            "model": m.model, "created_at": m.created_at.isoformat() if m.created_at else None}


@router.post("/videos/{public_id}/ask")
def ask(public_id: str, data: AskIn, request: Request, ctx: Ctx = Depends(signed_in)):
    limits.ask(request)
    video = readable(Viewer(db=ctx.db, user=ctx.user), public_id)
    access.guard(ctx.user, video)
    if video.ai_status != "ready":
        raise err(409, "ai_not_available_for_video")
    try:
        per = quotas.reserve(ctx.db, ctx.tenant_id, ctx.user.id, "ask", 1)
        ctx.db.commit()
    except quotas.QuotaExceeded as exc:
        ctx.db.rollback()
        raise quotas.refuse(exc)
    try:
        passages = _passages(ctx.db, video, data.question)
        lang = (ctx.user.settings or {}).get("language") or video.language
        span = max([video.duration_ms] + [p.end_ms for p in passages])
        answer = intel.ask(data.question.strip(), passages, span, lang, ctx.tenant_id)
    except Exception:
        quotas.release(ctx.db, ctx.tenant_id, ctx.user.id, "ask", 1, per)
        ctx.db.commit()
        raise err(503, "ai_not_available_for_video")
    m = AskMessage(tenant_id=ctx.tenant_id, user_id=ctx.user.id, video_id=video.id, question=data.question.strip(),
                   answer=answer.text, citations=answer.citations, status=answer.status, model=answer.model)
    ctx.db.add(m)
    if answer.status == "answered":
        quotas.commit(ctx.db, ctx.tenant_id, ctx.user.id, "ask", 1, per)
    else:
        quotas.release(ctx.db, ctx.tenant_id, ctx.user.id, "ask", 1, per)
    ctx.db.commit()
    out = _ask_out(m)
    out["quota"] = quotas.usage(ctx.db, ctx.user.id, "ask")
    return out


@router.get("/videos/{public_id}/ask")
def ask_history(public_id: str, ctx: Ctx = Depends(signed_in)):
    video = readable(Viewer(db=ctx.db, user=ctx.user), public_id)
    rows = ctx.db.execute(select(AskMessage).where(AskMessage.user_id == ctx.user.id, AskMessage.video_id == video.id)
                          .order_by(AskMessage.id.desc()).limit(30)).scalars().all()
    return {"messages": [_ask_out(m) for m in reversed(rows)], "quota": quotas.usage(ctx.db, ctx.user.id, "ask")}


@router.get("/videos/{public_id}/transcript")
def transcript(public_id: str, viewer: Viewer = Depends(optional_viewer)):
    video = readable(viewer, public_id)
    access.guard(viewer.user, video)
    tr = viewer.db.execute(select(Transcript).where(Transcript.video_id == video.id, Transcript.is_current.is_(True))).scalars().first()
    if tr is None:
        return {"language": video.language, "segments": []}
    segs = viewer.db.execute(select(Segment).where(Segment.transcript_id == tr.id).order_by(Segment.idx)).scalars().all()
    return {"language": tr.language, "source": tr.source,
            "segments": [{"start_ms": s.start_ms, "end_ms": s.end_ms, "label": fmt_ts(s.start_ms), "text": s.text} for s in segs]}


@router.get("/videos/{public_id}/captions/{lang}.vtt", response_class=PlainTextResponse)
def captions(public_id: str, lang: str, viewer: Viewer = Depends(optional_viewer)):
    video = readable(viewer, public_id)
    access.guard(viewer.user, video)
    if lang not in LANGS:
        raise err(404, "video_not_found")
    tracks = viewer.db.execute(select(CaptionTrack).where(CaptionTrack.video_id == video.id)).scalars().all()
    own = next((t for t in tracks if t.language == lang and t.source != "translation"), None) or \
        next((t for t in tracks if t.language == lang), None)
    if own is not None:
        return PlainTextResponse(own.vtt, media_type="text/vtt", headers={"Cache-Control": "public, max-age=600"})
    base = next((t for t in tracks if t.source in ("creator", "youtube")), None) or next((t for t in tracks if t.source == "ai"), None)
    if base is None:
        raise err(404, "video_not_found")
    cues, model = intel.translate(parse(base.vtt), lang, video.tenant_id)
    vtt = to_vtt(cues)
    if model == "sandbox":
        vtt = vtt.replace("WEBVTT", f"WEBVTT - sandbox: machine translation to {lang} is off; original text shown", 1)
    with platform_session() as db:
        exists = db.execute(select(CaptionTrack.id).where(CaptionTrack.video_id == video.id, CaptionTrack.language == lang,
                                                          CaptionTrack.source == "translation")).first()
        if not exists:
            db.add(CaptionTrack(tenant_id=video.tenant_id, video_id=video.id, language=lang, source="translation", vtt=vtt))
            db.commit()
    return PlainTextResponse(vtt, media_type="text/vtt")


@router.get("/search")
def search(request: Request, response: Response, q: str = Query(min_length=2, max_length=200), limit: int = Query(20, le=50),
           offset: int = Query(0, ge=0, le=500), viewer: Viewer = Depends(optional_viewer)):
    limits.search(request)
    db = viewer.db
    tsq = func.websearch_to_tsquery("simple", q)
    vec = embedder.embed([q])[0]
    published = (Video.status == "published") & (Video.visibility == "public") & Video.is_deleted.is_(False)
    title_rows = db.execute(select(Video.id, func.ts_rank(Video.search, tsq).label("r")).where(
        published, Video.search.op("@@")(tsq)).order_by(text("r DESC"), Video.id.desc()).limit(200)).all()
    rq = roman(q)
    rtsq = func.websearch_to_tsquery("simple", rq)
    seg_roman = []
    if rq:
        title_rows += db.execute(select(Video.id, func.ts_rank(Video.search_roman, rtsq).label("r")).where(
            published, Video.search_roman.op("@@")(rtsq)).order_by(text("r DESC"), Video.id.desc()).limit(200)).all()
        seg_roman = db.execute(select(Segment.video_id, Segment.start_ms, Segment.text, Segment.roman,
                                      func.ts_rank(Segment.search_roman, rtsq).label("r"))
                               .join(Video, Video.id == Segment.video_id).join(Transcript, Transcript.id == Segment.transcript_id)
                               .where(published, Video.access == "free", Transcript.is_current.is_(True),
                                      Segment.search_roman.op("@@")(rtsq))
                               .order_by(text("r DESC"), Segment.video_id.desc()).limit(200)).all()
    seg_text = db.execute(select(Segment.video_id, Segment.start_ms, Segment.text, func.ts_rank(Segment.search, tsq).label("r"))
                          .join(Video, Video.id == Segment.video_id).join(Transcript, Transcript.id == Segment.transcript_id)
                          .where(published, Video.access == "free", Transcript.is_current.is_(True), Segment.search.op("@@")(tsq))
                          .order_by(text("r DESC"), Segment.video_id.desc()).limit(200)).all()
    dist = Segment.embedding.cosine_distance(vec)
    seg_vec = db.execute(select(Segment.video_id, Segment.start_ms, Segment.text, dist.label("d"))
                         .join(Video, Video.id == Segment.video_id).join(Transcript, Transcript.id == Segment.transcript_id)
                         .where(published, Video.access == "free", Transcript.is_current.is_(True), Segment.embedding.is_not(None))
                         .order_by(dist, Segment.video_id.desc()).limit(200)).all()
    results: dict[int, dict] = {}

    def bump(vid: int, score: float, start_ms: int | None = None, snippet: str | None = None) -> None:
        r = results.setdefault(vid, {"score": 0.0, "start_ms": None, "snippet": None, "moment_score": 0.0})
        r["score"] += score
        if start_ms is not None and score > r["moment_score"]:
            r.update(start_ms=start_ms, snippet=snippet, moment_score=score)

    best: dict[int, float] = {}
    for vid, rank in title_rows:
        best[vid] = max(best.get(vid, 0.0), float(rank))
    for vid, rank in best.items():
        bump(vid, 0.6 + min(rank, 1.0))
    for vid, start, snippet, rank in seg_text:
        lex = lexical(q, snippet)
        if lex:
            bump(vid, min(1.0, float(rank) * 2) * 0.8 + lex * 0.5, start, snippet)
    texted = {(vid, start) for vid, start, _, _ in seg_text}
    for vid, start, snippet, rsnip, rank in seg_roman:
        lex = lexical(rq, rsnip)
        if lex and (vid, start) not in texted:
            bump(vid, min(1.0, float(rank) * 2) * 0.8 + lex * 0.5, start, snippet)
    if rq and len(rq) >= 4 and not results:
        sim = func.word_similarity(rq, Video.roman)
        for vid, score in db.execute(select(Video.id, sim.label("s")).where(published, sim > 0.45)
                                     .order_by(text("s DESC"), Video.id.desc()).limit(50)).all():
            bump(vid, float(score))
    for vid, start, snippet, d in seg_vec:
        sim = 1 - float(d)
        if sim >= 0.25:
            bump(vid, sim * 0.7, start, snippet)
    everything = sorted(results.items(), key=lambda kv: (-round(kv[1]["score"], 6), -kv[0]))
    response.headers["X-Total-Count"] = str(len(everything))
    ranked = everything[offset:offset + limit]
    if not ranked:
        return {"query": q, "results": [], "total": len(everything)}
    videos = {v.id: v for v in db.execute(select(Video).where(Video.id.in_([vid for vid, _ in ranked]))).scalars().all()}
    chans = {c.id: c for c in db.execute(select(Channel).where(Channel.id.in_({v.channel_id for v in videos.values()}))).scalars().all()}
    pend = counters.pending("video", list(videos))
    out = []
    for vid, r in ranked:
        v = videos.get(vid)
        if v is None:
            continue
        card = video_card(v, chans.get(v.channel_id), pend.get(vid))
        card["moment"] = None if r["start_ms"] is None else {
            "start_ms": r["start_ms"], "label": fmt_ts(r["start_ms"]), "snippet": r["snippet"][:240]}
        card["score"] = round(r["score"], 4)
        out.append(card)
    return {"query": q, "results": out, "total": len(everything)}
