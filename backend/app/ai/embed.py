from __future__ import annotations

import hashlib
import math

import httpx

from app.ai.textkit import STOP, words
from app.config import settings


def provider_name() -> str:
    return settings.EMBED_PROVIDER if settings.EMBED_PROVIDER != "sandbox" or not settings.EMBED_URL else "sandbox"


def _hashed(text: str) -> list[float]:
    dim = settings.EMBED_DIM
    vec = [0.0] * dim
    toks = [w for w in words(text) if w not in STOP]
    grams = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
    for g in grams:
        h = int(hashlib.blake2b(g.encode(), digest_size=8).hexdigest(), 16)
        vec[h % dim] += 1.0 if (h >> 63) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embed(texts: list[str]) -> list[list[float]]:
    if provider_name() == "sandbox" or not settings.EMBED_URL:
        return [_hashed(t) for t in texts]
    out: list[list[float]] = []
    for i in range(0, len(texts), 64):
        batch = [t[:6000] for t in texts[i:i + 64]]
        resp = httpx.post(settings.EMBED_URL, headers={"api-key": settings.LLM_API_KEY, "Content-Type": "application/json"},
                          json={"input": batch, "model": settings.EMBED_MODEL}, timeout=httpx.Timeout(60.0, connect=10.0))
        resp.raise_for_status()
        data = sorted(resp.json()["data"], key=lambda d: d["index"])
        out.extend(d["embedding"] for d in data)
    return out
