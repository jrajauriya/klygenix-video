from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from app.ai import llm
from app.ai.captions import Cue
from app.ai.textkit import STOP, fmt_ts, keywords, overlap, parse_ts, sentences, title_case, words

ENGINE = "kv-intel-1"
LANG_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu"}
HOOK_WORDS = {"how", "why", "what", "secret", "mistake", "mistakes", "never", "best", "worst", "tip", "tips", "stop",
              "truth", "first", "biggest", "easy", "fast", "simple", "nobody", "everyone", "kaise", "kyun", "galti"}


@dataclass
class Insights:
    summary: str
    key_points: list[str]
    chapters: list[dict]
    tags: list[str]
    title_ideas: list[str]
    hashtags: list[str]
    model: str


@dataclass
class Answer:
    text: str
    citations: list[dict] = field(default_factory=list)
    status: str = "answered"
    model: str = "sandbox"


def full_text(cues: list[Cue]) -> str:
    return " ".join(c.text for c in cues)


def _score_sentences(text: str, top: list[str]) -> list[tuple[float, str]]:
    topset = set(top)
    scored = []
    for s in sentences(text):
        ws = [w for w in words(s) if w not in STOP]
        if len(ws) < 4:
            continue
        hits = sum(1 for w in ws if w in topset)
        scored.append((hits / (len(ws) ** 0.5), s))
    return sorted(scored, key=lambda x: -x[0])


def _sandbox_chapters(cues: list[Cue], duration_ms: int) -> list[dict]:
    if duration_ms < 120_000 or not cues:
        return [{"start_ms": 0, "title": "Introduction" if duration_ms >= 60_000 else "Full video"}] if cues else []
    target = max(60_000, duration_ms // 8)
    chapters, start, buf = [], cues[0].start_ms, []
    prev_text = ""
    for c in cues:
        buf.append(c.text)
        span = c.end_ms - start
        window = " ".join(buf[-4:])
        shift = prev_text and overlap(window, prev_text) < 0.05 and span >= 45_000
        if span >= target or shift:
            chapters.append((start, " ".join(buf)))
            prev_text = " ".join(buf[-4:])
            start, buf = c.end_ms, []
    if buf:
        chapters.append((start, " ".join(buf)))
    out = []
    for i, (ms, text) in enumerate(chapters):
        kw = keywords(text, 3)
        first = sentences(text)[:1]
        name = title_case(first[0], 48) if first and len(first[0]) < 60 else title_case(" ".join(kw), 48)
        out.append({"start_ms": 0 if i == 0 else int(ms), "title": name or f"Part {i + 1}"})
    return out


def _sandbox_insights(cues: list[Cue], duration_ms: int, title: str) -> Insights:
    text = full_text(cues)
    top = keywords(f"{title} {text}", 10)
    ranked = _score_sentences(text, top)
    summary_sents = [s for _, s in ranked[:3]]
    order = {s: i for i, s in enumerate(sentences(text))}
    summary_sents.sort(key=lambda s: order.get(s, 0))
    key_points, seen = [], set()
    for _, s in ranked:
        k = tuple(sorted(set(keywords(s, 3))))
        if k in seen:
            continue
        seen.add(k)
        key_points.append(s)
        if len(key_points) == 5:
            break
    tags = top[:8]
    ideas = [title_case(f"{top[0]} {top[1]} explained", 70)] if len(top) >= 2 else []
    if ranked:
        ideas.append(title_case(ranked[0][1], 70))
    if title:
        ideas.append(title_case(f"{title} — the short version", 70))
    return Insights(
        summary=" ".join(summary_sents) or (text[:280] if text else "No speech was found in this video."),
        key_points=key_points, chapters=_sandbox_chapters(cues, duration_ms), tags=tags,
        title_ideas=[i for i in ideas if i][:3], hashtags=[f"#{t.replace('-', '')}" for t in tags[:5]], model="sandbox",
    )


def _transcript_block(cues: list[Cue], limit: int = 60_000) -> str:
    lines, size = [], 0
    for c in cues:
        line = f"[{fmt_ts(c.start_ms)}] {c.text}"
        size += len(line)
        if size > limit:
            break
        lines.append(line)
    return "\n".join(lines)


def insights(cues: list[Cue], duration_ms: int, title: str, language: str, tenant_id: int | None) -> Insights:
    if not llm.is_configured() or not cues:
        return _sandbox_insights(cues, duration_ms, title)
    lang = LANG_NAMES.get(language, "English")
    system = (
        "You write video metadata for a video platform. Use only the transcript. Reply with one JSON object: "
        '{"summary": str (<= 80 words), "key_points": [str] (3-5), "chapters": [{"start": "mm:ss", "title": str}] '
        '(first at 00:00, only real timestamps from the transcript, 3-10 for videos over 3 minutes, else 1), '
        '"tags": [str] (<= 8, lowercase), "title_ideas": [str] (3), "hashtags": [str] (5)}. '
        f"Write in {lang}. No advice you cannot ground in the transcript."
    )
    data, reply = llm.complete_json("insights", system, f"Title: {title}\n\nTranscript:\n{_transcript_block(cues)}",
                                    tenant_id=tenant_id)
    starts = sorted({c.start_ms for c in cues})
    chapters = []
    for ch in data.get("chapters") or []:
        ms = parse_ts(str(ch.get("start") or "0:00"))
        if ms is None or ms > duration_ms:
            continue
        snapped = min(starts, key=lambda s: abs(s - ms)) if starts else 0
        chapters.append({"start_ms": 0 if not chapters else int(snapped), "title": str(ch.get("title") or "")[:80]})
    fallback = _sandbox_insights(cues, duration_ms, title)
    return Insights(
        summary=str(data.get("summary") or fallback.summary)[:1200],
        key_points=[str(k)[:300] for k in (data.get("key_points") or fallback.key_points)][:6],
        chapters=chapters or fallback.chapters,
        tags=[str(t).lower()[:30] for t in (data.get("tags") or fallback.tags)][:8],
        title_ideas=[str(t)[:100] for t in (data.get("title_ideas") or fallback.title_ideas)][:3],
        hashtags=[("#" + str(h).lstrip("#"))[:30] for h in (data.get("hashtags") or fallback.hashtags)][:6],
        model=reply.model,
    )


def translate(cues: list[Cue], target: str, tenant_id: int | None) -> tuple[list[Cue], str]:
    if not llm.is_configured():
        return [Cue(c.start_ms, c.end_ms, c.text) for c in cues], "sandbox"
    lang = LANG_NAMES.get(target, target)
    out: list[Cue] = []
    model = ""
    for i in range(0, len(cues), 60):
        chunk = cues[i:i + 60]
        payload = json.dumps([{"i": n, "t": c.text} for n, c in enumerate(chunk)], ensure_ascii=False)
        data, reply = llm.complete_json(
            "translate",
            f'Translate subtitle lines into {lang}. Keep meaning, keep it short, keep names. Reply as JSON '
            '{"lines": [{"i": int, "t": str}]} with every input index.',
            payload, tenant_id=tenant_id,
        )
        model = reply.model
        got = {int(x.get("i")): str(x.get("t") or "") for x in data.get("lines") or [] if str(x.get("i", "")).isdigit()}
        for n, c in enumerate(chunk):
            out.append(Cue(c.start_ms, c.end_ms, got.get(n) or c.text))
    return out, model


CITE = re.compile(r"\[(\d{1,2}:\d{2}(?::\d{2})?)\]")


@dataclass
class Passage:
    start_ms: int
    end_ms: int
    text: str
    score: float


def guard(answer: str, passages: list[Passage], duration_ms: int) -> tuple[bool, list[dict]]:
    found = CITE.findall(answer or "")
    if not found:
        return False, []
    cites, ok = [], True
    for ts in found:
        ms = parse_ts(ts)
        if ms is None or ms > duration_ms + 1000:
            ok = False
            continue
        match = next((p for p in passages if p.start_ms - 1500 <= ms <= p.end_ms + 1500), None)
        if match is None:
            ok = False
            continue
        cites.append({"start_ms": match.start_ms, "end_ms": match.end_ms, "label": fmt_ts(match.start_ms),
                      "text": match.text[:240]})
    unique, seen = [], set()
    for c in cites:
        if c["start_ms"] not in seen:
            seen.add(c["start_ms"])
            unique.append(c)
    return ok and bool(unique), unique


DECLINE = "This video doesn't cover that. Try searching for it, or ask about something the video talks about."


def ask(question: str, passages: list[Passage], duration_ms: int, language: str, tenant_id: int | None,
        threshold: float = 0.08) -> Answer:
    relevant = [p for p in passages if p.score >= threshold]
    if not relevant:
        return Answer(DECLINE, [], "declined", "guard")
    if not llm.is_configured():
        best = sorted(relevant, key=lambda p: -p.score)[:3]
        best.sort(key=lambda p: p.start_ms)
        parts = [f"[{fmt_ts(p.start_ms)}] {p.text.strip()}" for p in best]
        text = "Here is what the video says about that:\n" + "\n".join(parts)
        ok, cites = guard(text, relevant, duration_ms)
        return Answer(text, cites, "answered" if ok else "declined", "sandbox")
    lang = LANG_NAMES.get(language, "English")
    context = "\n".join(f"[{fmt_ts(p.start_ms)}] {p.text}" for p in sorted(relevant, key=lambda p: p.start_ms))
    system = (
        "You answer questions about one video using ONLY the transcript passages given. "
        "Cite every claim with the passage timestamp in square brackets exactly as given, e.g. [04:12]. "
        f"If the passages do not answer the question, reply exactly: {DECLINE} "
        f"Answer in {lang}, at most 120 words."
    )
    for _ in range(2):
        reply = llm.complete("ask", system, f"Passages:\n{context}\n\nQuestion: {question}", tenant_id=tenant_id,
                             fast=True, max_tokens=600)
        text = reply.text.strip()
        if text.startswith(DECLINE[:30]):
            return Answer(DECLINE, [], "declined", reply.model)
        ok, cites = guard(text, relevant, duration_ms)
        if ok:
            return Answer(text, cites, "answered", reply.model)
    return Answer(DECLINE, [], "declined", "guard")


@dataclass
class ClipIdea:
    start_ms: int
    end_ms: int
    score: float
    title: str
    reason: str
    hook: str


def _terminal(text: str) -> bool:
    return text.rstrip().endswith((".", "!", "?", "।"))


def find_clips(cues: list[Cue], title: str, duration_ms: int, *, min_ms: int = 15_000, max_ms: int = 60_000,
               count: int = 8) -> list[ClipIdea]:
    if not cues or duration_ms < min_ms:
        return []
    top = set(keywords(f"{title} {full_text(cues)}", 12))
    candidates: list[ClipIdea] = []
    for i, first in enumerate(cues):
        text, end = [], first.start_ms
        for j in range(i, len(cues)):
            c = cues[j]
            if c.end_ms - first.start_ms > max_ms:
                break
            text.append(c.text)
            end = c.end_ms
            span = end - first.start_ms
            if span < min_ms or not _terminal(c.text):
                continue
            joined = " ".join(text)
            ws = words(joined)
            density = min(1.0, (len(ws) / max(span / 1000, 1)) / 3.0)
            opening = words(first.text)[:6]
            hook = 1.0 if (first.text.strip().endswith("?") or any(w in HOOK_WORDS for w in opening)
                           or any(w.isdigit() for w in opening)) else 0.3
            relevance = min(1.0, sum(1 for w in set(ws) if w in top) / 5)
            length_fit = 1.0 - abs(span - 35_000) / 45_000
            score = round(0.3 * density + 0.3 * hook + 0.25 * relevance + 0.15 * max(length_fit, 0), 4)
            reasons = []
            if hook >= 1:
                reasons.append("opens with a hook")
            if relevance >= 0.6:
                reasons.append("stays on the video's main topic")
            if density >= 0.7:
                reasons.append("dense, fast-moving speech")
            reasons.append(f"ends on a complete sentence at {fmt_ts(end)}")
            candidates.append(ClipIdea(first.start_ms, end, score, title_case(first.text, 70) or "Highlight",
                                       "; ".join(reasons).capitalize() + ".", first.text.strip()))
    candidates.sort(key=lambda c: -c.score)
    picked: list[ClipIdea] = []
    for c in candidates:
        if all(c.end_ms <= p.start_ms or c.start_ms >= p.end_ms for p in picked):
            picked.append(c)
        if len(picked) == count:
            break
    return sorted(picked, key=lambda c: -c.score)
