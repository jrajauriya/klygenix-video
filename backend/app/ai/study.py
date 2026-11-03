from __future__ import annotations

from app.ai import llm
from app.ai.captions import Cue
from app.ai.intel import LANG_NAMES
from app.ai.textkit import content_words, fmt_ts, keywords, parse_ts

KINDS = ("notes", "quiz", "flashcards")


def _snap(starts: list[int], ms: int | None, duration_ms: int) -> int | None:
    if ms is None or ms < 0 or ms > duration_ms + 1000 or not starts:
        return None
    return min(starts, key=lambda s: abs(s - ms))


def _cue_at(cues: list[Cue], ms: int) -> Cue:
    return min(cues, key=lambda c: abs(c.start_ms - ms))


def _sandbox_notes(cues: list[Cue], chapters: list[dict]) -> list[dict]:
    marks = [c["start_ms"] for c in chapters] or [cues[0].start_ms]
    bounds = list(zip(marks, marks[1:] + [10**12]))
    titles = [c.get("title", "") for c in chapters] or ["Notes"]
    out = []
    for (lo, hi), title in zip(bounds, titles):
        inside = [c for c in cues if lo <= c.start_ms < hi]
        if not inside:
            continue
        top = sorted(inside, key=lambda c: -len(content_words(c.text)))[:3]
        for c in sorted(top, key=lambda c: c.start_ms):
            out.append({"t_ms": c.start_ms, "label": fmt_ts(c.start_ms), "heading": title, "text": c.text.strip()})
    return out[:24]


def _sandbox_flashcards(cues: list[Cue]) -> list[dict]:
    text = " ".join(c.text for c in cues)
    cards, used = [], set()
    for kw in keywords(text, 12):
        hit = next((c for c in cues if kw in content_words(c.text) and c.start_ms not in used), None)
        if hit is None:
            continue
        used.add(hit.start_ms)
        cards.append({"front": f"What does the video say about {kw}?", "back": hit.text.strip(), "t_ms": hit.start_ms,
                      "label": fmt_ts(hit.start_ms)})
    return cards[:10]


def _sandbox_quiz(cues: list[Cue]) -> list[dict]:
    usable = [c for c in cues if len(content_words(c.text)) >= 3]
    if len(usable) < 4:
        return []
    out = []
    step = max(1, len(usable) // 6)
    for i in range(1, len(usable), step):
        prev, ans = usable[i - 1], usable[i]
        others = [c for c in usable if c.start_ms != ans.start_ms and c.start_ms != prev.start_ms]
        picks = [others[(i * 7 + k * 3) % len(others)] for k in range(3)] if len(others) >= 3 else others
        distract = []
        for p in picks:
            if p.text not in distract and p.text != ans.text:
                distract.append(p.text)
        if len(distract) < 3:
            continue
        options = distract[:3]
        pos = (i * 5) % 4
        options.insert(pos, ans.text)
        out.append({"question": f"What does the video say right after: “{prev.text.strip()}”", "options": [o.strip() for o in options],
                    "answer": pos, "t_ms": ans.start_ms, "label": fmt_ts(ans.start_ms)})
        if len(out) == 5:
            break
    return out


def generate(kind: str, cues: list[Cue], duration_ms: int, chapters: list[dict], language: str,
             tenant_id: int | None) -> tuple[list[dict], str]:
    if not cues:
        return [], "none"
    if not llm.is_configured():
        if kind == "notes":
            return _sandbox_notes(cues, chapters), "sandbox"
        if kind == "flashcards":
            return _sandbox_flashcards(cues), "sandbox"
        return _sandbox_quiz(cues), "sandbox"
    lang = LANG_NAMES.get(language, "English")
    block = "\n".join(f"[{fmt_ts(c.start_ms)}] {c.text}" for c in cues)[:60_000]
    shapes = {
        "notes": '{"items": [{"at": "mm:ss", "heading": str, "text": str}]} (8-20 items)',
        "flashcards": '{"items": [{"at": "mm:ss", "front": str, "back": str}]} (6-12 cards)',
        "quiz": '{"items": [{"at": "mm:ss", "question": str, "options": [str, str, str, str], "answer": 0-3}]} (5 questions)',
    }
    system = (f"You make study material from one video transcript. Use only facts in the transcript; every item cites the "
              f"timestamp of the line it comes from, exactly as given. Reply with one JSON object {shapes[kind]}. Write in {lang}.")
    data, reply = llm.complete_json("insights", system, block, tenant_id=tenant_id)
    starts = sorted({c.start_ms for c in cues})
    items = []
    for it in data.get("items") or []:
        t = _snap(starts, parse_ts(str(it.get("at") or "")), duration_ms)
        if t is None:
            continue
        base = {"t_ms": t, "label": fmt_ts(t)}
        if kind == "notes" and it.get("text"):
            items.append({**base, "heading": str(it.get("heading") or "")[:120], "text": str(it["text"])[:600]})
        elif kind == "flashcards" and it.get("front") and it.get("back"):
            items.append({**base, "front": str(it["front"])[:300], "back": str(it["back"])[:600]})
        elif kind == "quiz":
            opts = [str(o)[:300] for o in (it.get("options") or [])][:4]
            ans = it.get("answer")
            if len(opts) == 4 and isinstance(ans, int) and 0 <= ans < 4 and it.get("question"):
                items.append({**base, "question": str(it["question"])[:400], "options": opts, "answer": ans})
    if not items:
        fallback = {"notes": _sandbox_notes, "flashcards": _sandbox_flashcards}.get(kind)
        items = fallback(cues, chapters) if kind == "notes" else fallback(cues) if fallback else _sandbox_quiz(cues)
    return items, reply.model


def grounded(items: list[dict], cue_starts: set[int], duration_ms: int) -> bool:
    return all(it["t_ms"] in cue_starts and 0 <= it["t_ms"] <= duration_ms + 1000 for it in items)

