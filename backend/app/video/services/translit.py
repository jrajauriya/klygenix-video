from __future__ import annotations

import re

VOWELS = {"अ": "a", "आ": "aa", "इ": "i", "ई": "ii", "उ": "u", "ऊ": "uu", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
          "ऑ": "o", "ॲ": "e"}
MATRAS = {"ा": "aa", "ि": "i", "ी": "ii", "ु": "u", "ू": "uu", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o",
          "ॅ": "e"}
CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "d", "ढ़": "dh", "फ़": "f", "य़": "y",
}
NUKTA = "़"
VIRAMA = "्"
SIGNS = {"ं": "n", "ँ": "n", "ः": "h"}
DIGITS = {chr(0x0966 + i): str(i) for i in range(10)}
RULES = [("aa", "a"), ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u"), ("ph", "f"), ("w", "v"), ("q", "k"), ("z", "j"),
         ("ck", "k"), ("x", "ks"), ("chh", "ch"), ("sh", "s"), ("th", "t"), ("dh", "d"), ("bh", "b"), ("kh", "k"), ("gh", "g"),
         ("jh", "j"), ("ou", "o"), ("au", "o"), ("ei", "e")]


def _units(word: str) -> list[list[str]]:
    units: list[list[str]] = []
    chars = list(word)
    i = 0
    while i < len(chars):
        ch = chars[i]
        if i + 1 < len(chars) and chars[i + 1] == NUKTA and ch + NUKTA in CONSONANTS:
            ch = ch + NUKTA
            i += 1
        nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if ch in CONSONANTS:
            if nxt == VIRAMA:
                units.append([CONSONANTS[ch], ""])
                i += 2
            elif nxt in MATRAS:
                units.append([CONSONANTS[ch], MATRAS[nxt]])
                i += 2
            else:
                units.append([CONSONANTS[ch], "a*"])
                i += 1
            continue
        if ch in VOWELS:
            units.append(["", VOWELS[ch]])
        elif ch in MATRAS:
            units.append(["", MATRAS[ch]])
        elif ch in SIGNS and units:
            units[-1].append(SIGNS[ch])
        elif ch in DIGITS:
            units.append([DIGITS[ch], ""])
        elif ch not in (NUKTA, VIRAMA):
            units.append([ch, ""])
        i += 1
    return units


def _schwa(units: list[list[str]]) -> str:
    n = len(units)
    for k in range(n):
        if units[k][1] != "a*":
            continue
        last = k == n - 1 or not units[k + 1][0] and not units[k + 1][1]
        prev_vowel = k > 0 and units[k - 1][1] not in ("",)
        next_cv = k + 1 < n and units[k + 1][0] and units[k + 1][1] != ""
        if (last and k > 0 and len(units[k]) == 2) or (prev_vowel and next_cv):
            units[k][1] = ""
        else:
            units[k][1] = "a"
    return "".join("".join(u).replace("a*", "a") for u in units)


def devanagari(text: str) -> str:
    return re.sub(r"[\u0900-\u097f]+", lambda m: _schwa(_units(m.group(0))), text)


def _word(w: str) -> str:
    w = re.sub(r"c(?!h)", "k", w)
    for a, b in RULES:
        w = w.replace(a, b)
    w = re.sub(r"(.)\1+", r"\1", w)
    if len(w) > 2 and w.endswith("ay"):
        w = w[:-2] + "ai"
    if len(w) > 3 and w.endswith("a"):
        w = w[:-1]
    return w


def roman(text: str | None) -> str:
    if not text:
        return ""
    flat = devanagari(text).lower()
    words = re.findall(r"[a-z0-9]+", flat)
    return " ".join(_word(w) for w in words if w)


def has_devanagari(text: str) -> bool:
    return any("ऀ" <= c <= "ॿ" for c in text or "")



def _video(mapper, connection, target) -> None:
    target.roman = roman(" ".join([target.title or "", target.description or "", " ".join(target.tags or [])]))


def _segment(mapper, connection, target) -> None:
    target.roman = roman(target.text)


def install() -> None:
    from sqlalchemy import event

    from app.video.models.ai import Segment
    from app.video.models.media import Video

    if not event.contains(Video, "before_insert", _video):
        event.listen(Video, "before_insert", _video)
        event.listen(Video, "before_update", _video)
        event.listen(Segment, "before_insert", _segment)
        event.listen(Segment, "before_update", _segment)
