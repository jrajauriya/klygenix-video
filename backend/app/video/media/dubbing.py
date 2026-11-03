from __future__ import annotations

import os
import shutil
import subprocess

from sqlalchemy import select

from app.ai import intel, tts
from app.ai.captions import Cue, parse
from app.video.jobs import job
from app.video.media.ffmpeg import FFMPEG, run
from app.video.media.paths import work_dir
from app.video.models.media import CaptionTrack, DubTrack, Video
from app.video.sessions import platform_session
from app.video.storage import backend

LABEL = "AI-dubbed"


def _seconds(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, timeout=60).stdout.strip()
    return float(out or 0)


def _cues(db, video: Video, lang: str) -> list[Cue]:
    from app.video.pipeline.jobs import current_cues

    tracks = db.execute(select(CaptionTrack).where(CaptionTrack.video_id == video.id)).scalars().all()
    own = next((t for t in tracks if t.language == lang), None)
    if own is not None:
        return parse(own.vtt)
    base = current_cues(db, video.id)
    if lang == video.language:
        return base
    cues, _ = intel.translate(base, lang, video.tenant_id)
    return cues


def assemble(cues: list[Cue], lang: str, duration_ms: int, work: str) -> str:
    parts = []
    cursor = 0
    for i, c in enumerate(cues):
        if c.start_ms > cursor:
            gap = os.path.join(work, f"g{i:05d}.wav")
            run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t",
                 f"{(c.start_ms - cursor) / 1000:.3f}", gap])
            parts.append(gap)
            cursor = c.start_ms
        slot = (cues[i + 1].start_ms if i + 1 < len(cues) else max(duration_ms, c.end_ms)) - c.start_ms
        if slot <= 50:
            continue
        raw = os.path.join(work, f"s{i:05d}.wav")
        tts.speak(c.text, lang, raw)
        length = _seconds(raw)
        fit = os.path.join(work, f"f{i:05d}.wav")
        tempo = min(2.0, max(1.0, length / (slot / 1000))) if length else 1.0
        run([FFMPEG, "-y", "-v", "error", "-i", raw, "-af", f"atempo={tempo:.3f},apad", "-t", f"{slot / 1000:.3f}",
             "-ar", "24000", "-ac", "1", fit])
        parts.append(fit)
        cursor += slot
    listing = os.path.join(work, "dub.txt")
    with open(listing, "w") as fh:
        fh.writelines(f"file '{p}'\n" for p in parts)
    out = os.path.join(work, "dub.m4a")
    run([FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listing, "-c:a", "aac", "-b:a", "64k", out])
    return out


def key_for(video_id: int, lang: str) -> str:
    return f"dubs/{video_id}/{lang}.m4a"


@job(queue_name="ai", timeout=3600)
def dub_video(dub_id: int) -> None:
    with platform_session() as db:
        d = db.get(DubTrack, dub_id)
        if d is None or d.status != "queued":
            return
        video = db.get(Video, d.video_id)
        work = work_dir(f"dub{dub_id}")
        try:
            cues = [c for c in _cues(db, video, d.language) if c.text.strip()]
            if not cues:
                raise ValueError("No captions to dub from.")
            path = assemble(cues, d.language, video.duration_ms, work)
            with open(path, "rb") as fh:
                backend().put(key_for(video.id, d.language), fh.read(), "audio/mp4")
            d.status, d.voice, d.model, d.error = "ready", tts.voice(d.language), tts.provider_name(), None
        except Exception as exc:
            d.status, d.error = "failed", f"{type(exc).__name__}: {exc}"[:500]
        finally:
            shutil.rmtree(work, ignore_errors=True)
        db.commit()
