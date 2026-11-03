from __future__ import annotations

import base64
import hashlib
import os
import re
from dataclasses import dataclass, field

import httpx

from app.config import settings

LEXICON = {
    "sexual": ["porn", "nude", "nudes", "xxx", "onlyfans"],
    "violence": ["behead", "massacre", "gore"],
    "hate": ["kill all", "exterminate"],
    "scam": ["guaranteed returns", "double your money", "100% profit"],
}
BLOCK_MARK = "kv-test-block"
REVIEW_MARK = "kv-test-review"
HASHLIST = os.path.join(os.path.dirname(__file__), "hashlist.txt")


@dataclass
class Verdict:
    verdict: str
    labels: list[str] = field(default_factory=list)
    score: float = 0.0
    hash_match: bool = False
    provider: str = "sandbox"


def file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _hashlist() -> set[str]:
    if not os.path.exists(HASHLIST):
        return set()
    with open(HASHLIST) as fh:
        return {ln.strip().lower() for ln in fh if re.fullmatch(r"[0-9a-fA-F]{64}", ln.strip())}


def scan(*, text: str, source_path: str | None, frames: list[str] | None = None) -> Verdict:
    if source_path and os.path.exists(source_path) and file_hash(source_path) in _hashlist():
        return Verdict("block", ["hash_match"], 1.0, True)
    low = (text or "").lower()
    if BLOCK_MARK in low:
        return Verdict("block", ["test_block"], 1.0, True)
    if settings.SCAN_PROVIDER != "sandbox" and settings.SCAN_API_URL:
        payload = {"text": text[:20000], "frames": []}
        for f in (frames or [])[:6]:
            with open(f, "rb") as fh:
                payload["frames"].append(base64.b64encode(fh.read()).decode())
        resp = httpx.post(settings.SCAN_API_URL, json=payload, headers={"Authorization": f"Bearer {settings.SCAN_API_KEY}"},
                          timeout=httpx.Timeout(60.0, connect=10.0))
        resp.raise_for_status()
        body = resp.json()
        return Verdict(body.get("verdict", "review"), list(body.get("labels") or []), float(body.get("score") or 0),
                       bool(body.get("hash_match")), settings.SCAN_PROVIDER)
    labels = [k for k, terms in LEXICON.items() if any(t in low for t in terms)]
    if REVIEW_MARK in low:
        labels.append("test_review")
    if labels:
        return Verdict("review", labels, 0.7)
    return Verdict("clear", [], 0.0)
