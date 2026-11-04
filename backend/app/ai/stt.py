from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass

import httpx

from app.ai.captions import Cue, parse
from app.config import settings
from app.video.media.ffmpeg import FFMPEG, MediaError, probe, run


@dataclass(frozen=True, slots=True)
class Transcription:
    language: str
    cues: list[Cue]
    provider: str


class SttError(Exception):
    pass


def provider_name() -> str:
    return settings.STT_PROVIDER


def _embedded_subtitles(src: str, work: str) -> list[Cue]:
    out = os.path.join(work, "embedded.vtt")
    proc = subprocess.run([FFMPEG, "-y", "-v", "error", "-i", src, "-map", "0:s:0", out],
                          capture_output=True, text=True, timeout=120)
    if proc.returncode != 0 or not os.path.exists(out):
        return []
    with open(out, encoding="utf-8", errors="replace") as fh:
        return parse(fh.read())


def _placeholder(src: str) -> list[Cue]:
    try:
        duration = probe(src).duration_ms
    except MediaError:
        duration = 0
    cues, t = [], 0
    while t < duration:
        end = min(duration, t + 6000)
        cues.append(Cue(t, end, "Speech in this part of the video."))
        t = end
    return cues


def _chunks(src: str, work: str, seconds: int = 600) -> list[tuple[str, int]]:
    wav = os.path.join(work, "audio.wav")
    run([FFMPEG, "-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav])
    pattern = os.path.join(work, "part_%03d.wav")
    run([FFMPEG, "-y", "-v", "error", "-i", wav, "-f", "segment", "-segment_time", str(seconds), "-c", "copy", pattern])
    parts = sorted(p for p in os.listdir(work) if p.startswith("part_"))
    return [(os.path.join(work, p), i * seconds * 1000) for i, p in enumerate(parts)]


def _openai(src: str, work: str, language: str | None) -> Transcription:
    cues: list[Cue] = []
    detected = language or "en"
    for path, offset in _chunks(src, work):
        with open(path, "rb") as fh:
            data = {"response_format": "verbose_json", "timestamp_granularities[]": "segment"}
            if language:
                data["language"] = language
            resp = httpx.post(settings.OPENAI_TRANSCRIBE_URL, headers={"api-key": settings.OPENAI_TRANSCRIBE_KEY,
                              "Authorization": f"Bearer {settings.OPENAI_TRANSCRIBE_KEY}"},
                              files={"file": ("audio.wav", fh, "audio/wav")}, data=data,
                              timeout=httpx.Timeout(600.0, connect=10.0))
        if resp.status_code >= 400:
            raise SttError(f"transcription refused: {resp.status_code} {resp.text[:200]}")
        body = resp.json()
        detected = (body.get("language") or detected)[:8]
        for seg in body.get("segments") or []:
            text = (seg.get("text") or "").strip()
            if text:
                cues.append(Cue(offset + int(float(seg["start"]) * 1000), offset + int(float(seg["end"]) * 1000), text))
    return Transcription(_lang_code(detected), cues, "openai")


def _azure(src: str, work: str, language: str | None) -> Transcription:
    import json

    url = (f"https://{settings.AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speechtotext/"
           "transcriptions:transcribe?api-version=2024-11-15")
    locales = [{"en": "en-IN", "hi": "hi-IN", "mr": "mr-IN", "bn": "bn-IN", "ta": "ta-IN", "te": "te-IN", "gu": "gu-IN", "kn": "kn-IN", "ml": "ml-IN", "pa": "pa-IN", "or": "or-IN"}.get(language or "en", "en-IN")]
    cues: list[Cue] = []
    for path, offset in _chunks(src, work):
        with open(path, "rb") as fh:
            resp = httpx.post(url, headers={"Ocp-Apim-Subscription-Key": settings.AZURE_SPEECH_KEY},
                              files={"audio": ("audio.wav", fh, "audio/wav"),
                                     "definition": (None, json.dumps({"locales": locales}), "application/json")},
                              timeout=httpx.Timeout(600.0, connect=10.0))
        if resp.status_code >= 400:
            raise SttError(f"transcription refused: {resp.status_code} {resp.text[:200]}")
        for ph in resp.json().get("phrases") or []:
            start = offset + int(ph.get("offsetMilliseconds") or 0)
            cues.append(Cue(start, start + int(ph.get("durationMilliseconds") or 0), (ph.get("text") or "").strip()))
    return Transcription(language or "en", [c for c in cues if c.text], "azure_speech")


LANGS = {"english": "en", "hindi": "hi", "marathi": "mr", "bengali": "bn", "tamil": "ta", "telugu": "te", "gujarati": "gu", "kannada": "kn", "malayalam": "ml", "punjabi": "pa", "odia": "or", "oriya": "or"}


def _lang_code(value: str) -> str:
    v = (value or "en").lower()
    return LANGS.get(v, v[:2])


def transcribe(src: str, work: str, language: str | None = None) -> Transcription:
    name = provider_name()
    if name == "openai" and settings.OPENAI_TRANSCRIBE_URL:
        return _openai(src, work, language)
    if name == "azure_speech" and settings.AZURE_SPEECH_KEY:
        return _azure(src, work, language)
    cues = _embedded_subtitles(src, work)
    return Transcription(language or "en", cues or _placeholder(src), "sandbox")
