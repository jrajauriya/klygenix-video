from __future__ import annotations

import logging
import math
import os
import shutil
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.ai import embed as embedder
from app.ai import intel, stt
from app.ai.captions import Cue, to_vtt
from app.video.commerce import quotas
from app.video.jobs import job
from app.video.media import ffmpeg
from app.video.media.paths import video_dir, work_dir
from app.video.media.providers import provider
from app.video.media.service import apply_encoded, publish_if_ready, write_meta
from app.video.models.ai import AiJob, ClipSuggestion, Insight, Segment, Transcript
from app.video.models.commerce import ProviderEvent
from app.video.models.media import CaptionTrack, Video
from app.video.models.trust import ScanResult
from app.video.sessions import platform_session

logger = logging.getLogger(__name__)


def now() -> datetime:
    return datetime.now(timezone.utc)


@job(queue_name="render", timeout=3600)
def sandbox_encode(video_id: int) -> None:
    from app.video.media.providers.sandbox import SandboxProvider
    from app.video.media.service import ingest_event

    prov = SandboxProvider()
    with platform_session() as db:
        video = db.get(Video, video_id)
        if video is None or video.status != "processing":
            return
        pvid = video.provider_video_id
        src = prov.source_path(video)
    try:
        info = ffmpeg.probe(src)
        out = video_dir(video_id)
        hls_dir = os.path.join(out, "hls")
        shutil.rmtree(hls_dir, ignore_errors=True)
        os.makedirs(hls_dir, exist_ok=True)
        ffmpeg.hls(src, hls_dir, info)
        ffmpeg.thumbnail(src, os.path.join(out, "thumb.jpg"), max(0, min(info.duration_ms // 10, 5000)))
        write_meta(video_id, {"duration_ms": info.duration_ms, "width": info.width, "height": info.height})
        body = prov.event_body("encoded", pvid, duration_ms=info.duration_ms, width=info.width, height=info.height)
    except ffmpeg.MediaError as exc:
        body = prov.event_body("failed", pvid, detail=str(exc)[:300])
    ingest_event("sandbox", body, {"x-sandbox-signature": prov.signature(body)}, {})


@job
def process_media_event(event_row_id: int) -> None:
    with platform_session() as db:
        row = db.get(ProviderEvent, event_row_id)
        if row is None or row.processed_at is not None:
            return
        rail = row.rail.split(":", 1)[1]
        prov = provider(rail)
        start_ai: int | None = None
        for ev in prov.parse_webhook(row.body.encode()):
            video = db.execute(select(Video).where(Video.provider == rail,
                                                   Video.provider_video_id == ev.provider_video_id)).scalars().first()
            if video is None:
                continue
            row.tenant_id = video.tenant_id
            if ev.kind == "encoded" and video.status in ("uploading", "processing"):
                apply_encoded(db, video, duration_ms=ev.duration_ms, width=ev.width, height=ev.height)
                start_ai = video.id
            elif ev.kind == "failed" and video.status in ("uploading", "processing"):
                video.status = "failed"
                video.status_note = (ev.detail or "The video could not be processed.")[:500]
        row.processed_at = now()
        row.attempts += 1
        db.commit()
    if start_ai:
        process_video.enqueue(start_ai)


def _record(db, video: Video, kind: str, status: str, **kw) -> AiJob:
    j = AiJob(tenant_id=video.tenant_id, video_id=video.id, kind=kind, status=status, finished_at=now(), **kw)
    db.add(j)
    db.flush()
    return j


def store_transcript(db, video: Video, cues: list[Cue], language: str, source: str, provider_name: str) -> Transcript:
    db.execute(update(Transcript).where(Transcript.video_id == video.id).values(is_current=False))
    version = (db.execute(select(Transcript.version).where(Transcript.video_id == video.id)
                          .order_by(Transcript.version.desc())).scalar() or 0) + 1
    tr = Transcript(tenant_id=video.tenant_id, video_id=video.id, language=language, source=source,
                    provider=provider_name, version=version, is_current=True)
    db.add(tr)
    db.flush()
    db.execute(Segment.__table__.delete().where(Segment.video_id == video.id, Segment.transcript_id != tr.id))
    for i, c in enumerate(cues):
        db.add(Segment(tenant_id=video.tenant_id, transcript_id=tr.id, video_id=video.id, idx=i,
                       start_ms=c.start_ms, end_ms=c.end_ms, text=c.text[:4000]))
    existing = db.execute(select(CaptionTrack).where(CaptionTrack.video_id == video.id,
                                                     CaptionTrack.source == "ai")).scalars().all()
    for t in existing:
        db.delete(t)
    for t in db.execute(select(CaptionTrack).where(CaptionTrack.video_id == video.id,
                                                   CaptionTrack.source == "translation")).scalars().all():
        db.delete(t)
    if source == "stt":
        db.add(CaptionTrack(tenant_id=video.tenant_id, video_id=video.id, language=language, source="ai", vtt=to_vtt(cues)))
    db.flush()
    return tr


def current_cues(db, video_id: int) -> list[Cue]:
    rows = db.execute(select(Segment).join(Transcript, Transcript.id == Segment.transcript_id).where(
        Segment.video_id == video_id, Transcript.is_current.is_(True)).order_by(Segment.idx)).scalars().all()
    return [Cue(r.start_ms, r.end_ms, r.text) for r in rows]


def apply_scan(db, video: Video, text: str, source: str | None) -> str:
    from app.video.trust import scan as scanner

    v = scanner.scan(text=text, source_path=source)
    db.add(ScanResult(tenant_id=video.tenant_id, video_id=video.id, provider=v.provider, verdict=v.verdict,
                      labels=v.labels, score=v.score, hash_match=v.hash_match))
    if v.verdict == "block":
        video.status = "blocked"
        video.status_note = "Removed by the automatic safety check."
        from app.video.trust.service import auto_block

        auto_block(db, video, v.labels)
    elif v.verdict == "review":
        video.status = "in_review"
        video.status_note = "Waiting for a moderator."
    else:
        publish_if_ready(db, video)
    db.flush()
    return v.verdict


def analyse(db, video: Video, cues: list[Cue]) -> None:
    info = intel.insights(cues, video.duration_ms, video.title, video.language, video.tenant_id)
    db.add(Insight(tenant_id=video.tenant_id, video_id=video.id, language=video.language, summary=info.summary,
                   key_points=info.key_points, chapters=info.chapters, tags=info.tags, title_ideas=info.title_ideas,
                   hashtags=info.hashtags, model=info.model, version=1))
    if not video.tags:
        video.tags = info.tags[:8]
    _record(db, video, "insights", "done", provider=info.model)
    segs = db.execute(select(Segment).join(Transcript, Transcript.id == Segment.transcript_id).where(
        Segment.video_id == video.id, Transcript.is_current.is_(True)).order_by(Segment.idx)).scalars().all()
    if segs:
        vectors = embedder.embed([f"{video.title}. {s.text}" for s in segs])
        for s, vec in zip(segs, vectors):
            s.embedding = vec
        _record(db, video, "embed", "done", provider=embedder.provider_name(), units=len(segs), units_kind="segments")
    if video.duration_ms >= 30_000 and video.source != "embed":
        db.execute(ClipSuggestion.__table__.delete().where(ClipSuggestion.video_id == video.id))
        for c in intel.find_clips(cues, video.title, video.duration_ms):
            db.add(ClipSuggestion(tenant_id=video.tenant_id, video_id=video.id, start_ms=c.start_ms, end_ms=c.end_ms,
                                  score=c.score, title=c.title, reason=c.reason, hook=c.hook))
        _record(db, video, "clips", "done", provider="kv-clip-1")


def thumbnail_ideas(db, video: Video, src: str, work: str) -> None:
    from app.video.media import ffmpeg
    from app.video.services import images

    insight = db.execute(select(Insight).where(Insight.video_id == video.id).order_by(Insight.id.desc())).scalars().first()
    picks: list[tuple[int, str]] = []
    for ch in (insight.chapters if insight else [])[:4]:
        picks.append((int(ch.get("start_ms", 0)) + 1500, f"Chapter: {ch.get('title', '')}"[:80]))
    best = db.execute(select(ClipSuggestion).where(ClipSuggestion.video_id == video.id)
                      .order_by(ClipSuggestion.score.desc()).limit(2)).scalars().all()
    for c in best:
        picks.append((c.start_ms + 1000, f"Strong moment: {c.title}"[:80]))
    picks.append((video.duration_ms // 3, "A third of the way in"))
    chosen: list[tuple[int, str]] = []
    for at, why in picks:
        at = max(500, min(at, max(500, video.duration_ms - 500)))
        if all(abs(at - other) >= 3000 for other, _ in chosen):
            chosen.append((at, why))
        if len(chosen) == 4:
            break
    ideas = []
    for at, why in chosen:
        jpg = os.path.join(work, f"idea-{at}.jpg")
        try:
            ffmpeg.thumbnail(src, jpg, at)
            with open(jpg, "rb") as fh:
                ideas.append({"at_ms": at, "key": images.save(fh.read(), max_side=1280), "reason": why})
        except Exception:
            logger.warning("thumbnail idea failed", extra={"video": video.id, "at_ms": at})
    video.thumbnail_ideas = ideas


@job(queue_name="ai", timeout=3600)
def process_video(video_id: int) -> None:
    work = work_dir(f"v{video_id}")
    try:
        with platform_session() as db:
            video = db.get(Video, video_id)
            if video is None or video.status != "scanning":
                return
            prov = provider(video.provider)
            owner = quotas.owner_user_id(db, video.tenant_id)
            minutes = max(1, math.ceil(video.duration_ms / 60_000))
            per = None
            try:
                per = quotas.reserve(db, video.tenant_id, owner, "ai_minutes", minutes) if owner else None
                db.commit()
            except quotas.QuotaExceeded:
                db.rollback()
                video = db.get(Video, video_id)
                video.ai_status = "quota"
                _record(db, video, "transcribe", "skipped", error="AI minutes used up for this month")
                apply_scan(db, video, f"{video.title}\n{video.description}", None)
                db.commit()
                return
            src = os.path.join(work, "source")
            try:
                prov.fetch_source(video, src)
            except Exception as exc:
                logger.warning("source not available for AI", extra={"video": video_id, "error": str(exc)})
                src = None
            video.ai_status = "running"
            db.commit()
            try:
                result = stt.transcribe(src, work, video.language) if src else None
            except stt.SttError as exc:
                result = None
                _record(db, video, "transcribe", "failed", error=str(exc)[:500])
            cues = result.cues if result else []
            if result:
                store_transcript(db, video, cues, result.language or video.language, "stt", result.provider)
                _record(db, video, "transcribe", "done", provider=result.provider, units=minutes, units_kind="minutes")
            text = f"{video.title}\n{video.description}\n" + " ".join(c.text for c in cues)
            apply_scan(db, video, text, src)
            db.commit()
            if video.status == "blocked":
                if per:
                    quotas.release(db, video.tenant_id, owner, "ai_minutes", minutes, per)
                    db.commit()
                return
            try:
                analyse(db, video, cues)
                video.ai_status = "ready"
                if src:
                    thumbnail_ideas(db, video, src, work)
            except Exception as exc:
                logger.exception("analysis failed", extra={"video": video_id})
                db.rollback()
                video = db.get(Video, video_id)
                video.ai_status = "failed"
                _record(db, video, "insights", "failed", error=str(exc)[:500])
            if per:
                quotas.commit(db, video.tenant_id, owner, "ai_minutes", minutes, per)
            db.commit()
    finally:
        shutil.rmtree(work, ignore_errors=True)


@job(queue_name="ai", timeout=1800)
def process_captions(video_id: int, cues_payload: list[dict], language: str, source: str) -> None:
    cues = [Cue(int(c["start_ms"]), int(c["end_ms"]), str(c["text"])) for c in cues_payload]
    with platform_session() as db:
        video = db.get(Video, video_id)
        if video is None:
            return
        store_transcript(db, video, cues, language, "captions", source)
        if cues and not video.duration_ms:
            video.duration_ms = max(c.end_ms for c in cues)
        kind = "youtube" if source == "youtube" else "creator"
        for t in db.execute(select(CaptionTrack).where(CaptionTrack.video_id == video.id, CaptionTrack.source == kind,
                                                       CaptionTrack.language == language)).scalars().all():
            db.delete(t)
        db.flush()
        db.add(CaptionTrack(tenant_id=video.tenant_id, video_id=video.id, language=language,
                            source="youtube" if source == "youtube" else "creator", vtt=to_vtt(cues)))
        _record(db, video, "transcribe", "done", provider=source, units=len(cues), units_kind="cues")
        if video.status == "scanning":
            apply_scan(db, video, f"{video.title}\n{video.description}\n" + " ".join(c.text for c in cues), None)
        db.commit()
        if video.status == "blocked":
            return
        try:
            analyse(db, video, cues)
            video.ai_status = "ready"
        except Exception as exc:
            db.rollback()
            video = db.get(Video, video_id)
            video.ai_status = "failed"
            _record(db, video, "insights", "failed", error=str(exc)[:500])
        db.commit()
