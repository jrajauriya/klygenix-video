from __future__ import annotations

import re
from collections import Counter

STOP = set("""
a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that
these those i you he she we they me him her us them my your our their what which who whom whose when where why how
not no yes do does did done have has had will would can could should may might must just very really also too
there here than more most less least about into over under again further once all any both each few other some
such only own same now up down out off s t ll re ve d m o y let lets going get got gonna wanna okay ok um uh like
hai hain ka ki ke ko se mein aur ye yeh woh wo kya nahi bhi toh to
""".split())

WORD = re.compile(r"[A-Za-zऀ-ॿঀ-৿஀-௿ఀ-౿][\w'ऀ-౿-]*")
SENTENCE = re.compile(r"(?<=[.!?।])\s+")


def words(text: str) -> list[str]:
    return [w.lower() for w in WORD.findall(text or "")]


def keywords(text: str, n: int = 8) -> list[str]:
    counts = Counter(w for w in words(text) if w not in STOP and len(w) > 2)
    return [w for w, _ in counts.most_common(n)]


def sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE.split(text or "") if s.strip()]


def overlap(a: str, b: str) -> float:
    wa = {w for w in words(a) if w not in STOP}
    wb = {w for w in words(b) if w not in STOP}
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def fmt_ts(ms: int) -> str:
    s = max(0, int(ms // 1000))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def parse_ts(value: str) -> int | None:
    parts = value.strip().split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 2:
        return (nums[0] * 60 + nums[1]) * 1000
    if len(nums) == 3:
        return (nums[0] * 3600 + nums[1] * 60 + nums[2]) * 1000
    return None


def title_case(text: str, limit: int = 70) -> str:
    text = re.sub(r"\s+", " ", text or "").strip(" .,-")
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0]
    return text[:1].upper() + text[1:]


def content_words(text: str) -> set[str]:
    return {w for w in words(text) if w not in STOP and len(w) > 2}


def lexical(query: str, text: str) -> float:
    q = content_words(query)
    if not q:
        return 0.0
    hits = len(q & content_words(text))
    if hits == 0 or (hits < 2 and len(q) > 2):
        return 0.0
    return min(1.0, hits / len(q))
