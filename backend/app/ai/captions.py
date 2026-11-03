from __future__ import annotations

import re
from dataclasses import dataclass

from app.ai.textkit import fmt_ts

TS = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")


@dataclass(frozen=True, slots=True)
class Cue:
    start_ms: int
    end_ms: int
    text: str


def _ms(m: re.Match) -> int:
    h = int(m.group(1) or 0)
    return ((h * 60 + int(m.group(2))) * 60 + int(m.group(3))) * 1000 + int(m.group(4).ljust(3, "0")[:3])


def parse(text: str) -> list[Cue]:
    cues: list[Cue] = []
    blocks = re.split(r"\r?\n\r?\n+", (text or "").replace("﻿", ""))
    for block in blocks:
        lines = [ln.strip() for ln in block.strip().splitlines() if ln.strip()]
        for i, line in enumerate(lines):
            if "-->" in line:
                left, right = line.split("-->", 1)
                a, b = TS.search(left), TS.search(right)
                if not a or not b:
                    break
                body = " ".join(re.sub(r"<[^>]+>", "", ln) for ln in lines[i + 1:]).strip()
                if body:
                    cues.append(Cue(_ms(a), _ms(b), body))
                break
    return sorted(cues, key=lambda c: c.start_ms)


def _vtt_ts(ms: int) -> str:
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, milli = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{milli:03d}"


def to_vtt(cues: list[Cue]) -> str:
    out = ["WEBVTT", ""]
    for c in cues:
        out.append(f"{_vtt_ts(c.start_ms)} --> {_vtt_ts(c.end_ms)}")
        out.append(c.text)
        out.append("")
    return "\n".join(out)


def stamp(ms: int) -> str:
    return fmt_ts(ms)
