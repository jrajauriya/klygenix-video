from __future__ import annotations

import re
from dataclasses import dataclass

from app.ai import llm
from app.ai.intel import LANG_NAMES
from app.ai.textkit import fmt_ts, parse_ts

DECLINE = "These videos don't cover that. Try asking about something they talk about."
CITE = re.compile(r"\[v:([A-Za-z0-9_-]{6,24}) (\d{1,2}:\d{2}(?::\d{2})?)\]")


@dataclass
class Passage:
    video: str
    title: str
    start_ms: int
    end_ms: int
    text: str
    score: float


@dataclass
class Answer:
    text: str
    citations: list[dict]
    status: str
    model: str


def guard(answer: str, passages: list[Passage], durations: dict[str, int]) -> tuple[bool, list[dict]]:
    found = CITE.findall(answer or "")
    if not found:
        return False, []
    ok, cites, seen = True, [], set()
    for vid, ts in found:
        ms = parse_ts(ts)
        if vid not in durations or ms is None or ms > durations[vid] + 1000:
            ok = False
            continue
        match = next((p for p in passages if p.video == vid and p.start_ms - 1500 <= ms <= p.end_ms + 1500), None)
        if match is None:
            ok = False
            continue
        if (vid, match.start_ms) in seen:
            continue
        seen.add((vid, match.start_ms))
        cites.append({"video_id": vid, "title": match.title, "start_ms": match.start_ms, "end_ms": match.end_ms,
                      "label": fmt_ts(match.start_ms), "text": match.text[:240]})
    return ok and bool(cites), cites


def ask(question: str, passages: list[Passage], durations: dict[str, int], language: str, tenant_id: int | None,
        threshold: float = 0.08) -> Answer:
    relevant = [p for p in passages if p.score >= threshold]
    if not relevant:
        return Answer(DECLINE, [], "declined", "guard")
    if not llm.is_configured():
        best = sorted(relevant, key=lambda p: -p.score)[:4]
        lines = [f"[v:{p.video} {fmt_ts(p.start_ms)}] {p.title}: {p.text.strip()}" for p in best]
        text = "Here is where the videos talk about that:\n" + "\n".join(lines)
        ok, cites = guard(text, relevant, durations)
        return Answer(text, cites, "answered" if ok else "declined", "sandbox")
    lang = LANG_NAMES.get(language, "English")
    context = "\n".join(f"[v:{p.video} {fmt_ts(p.start_ms)}] ({p.title}) {p.text}"
                        for p in sorted(relevant, key=lambda p: (p.video, p.start_ms)))
    system = (
        "You answer questions about a set of videos using ONLY the transcript passages given. Each passage starts with "
        "its tag, e.g. [v:abc123XYZ 04:12]. Cite every claim with the exact tag of the passage it came from. "
        f"If the passages do not answer the question, reply exactly: {DECLINE} Answer in {lang}, at most 150 words."
    )
    for _ in range(2):
        reply = llm.complete("ask", system, f"Passages:\n{context}\n\nQuestion: {question}", tenant_id=tenant_id,
                             fast=True, max_tokens=700)
        text = reply.text.strip()
        if text.startswith(DECLINE[:30]):
            return Answer(DECLINE, [], "declined", reply.model)
        ok, cites = guard(text, relevant, durations)
        if ok:
            return Answer(text, cites, "answered", reply.model)
    return Answer(DECLINE, [], "declined", "guard")
