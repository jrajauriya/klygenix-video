from __future__ import annotations

import base64
import io
import os
import re
import textwrap

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.messages import err
from app.video.models.ai import Insight, RepurposePack, Segment, Transcript
from app.video.models.media import Video

STYLES = (("Bold headline", (255, 214, 10), "bottom"), ("Clean title", (255, 255, 255), "left"), ("Question hook", (0, 0, 0), "badge"))


class ImageError(Exception):
    pass


def _font(size: int):
    from PIL import ImageFont

    for path in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                 "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _compose(frame: bytes, title: str, style: tuple) -> bytes:
    from PIL import Image, ImageDraw

    name, colour, mode = style
    img = Image.open(io.BytesIO(frame)).convert("RGB")
    w, h = 1280, 720
    scale = max(w / img.width, h / img.height)
    img = img.resize((int(img.width * scale) + 1, int(img.height * scale) + 1))
    left, top = (img.width - w) // 2, (img.height - h) // 2
    img = img.crop((left, top, left + w, top + h))
    shade = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(shade)
    for y in range(h):
        sd.line([(0, y), (w, y)], fill=int(200 * max(0.0, (y - h * 0.35) / (h * 0.65))) if mode != "left" else
                int(170 * max(0.0, 1 - y / h)))
    img = Image.composite(Image.new("RGB", (w, h), (0, 0, 0)), img, shade)
    d = ImageDraw.Draw(img)
    words = re.sub(r"\s+", " ", title).strip() or "Watch now"
    if mode == "badge":
        text = (words if words.endswith("?") else f"{words}?")[:60]
        lines = textwrap.wrap(text.upper(), 18)[:3]
        font = _font(64)
        y = 60
        for ln in lines:
            box = d.textbbox((0, 0), ln, font=font)
            d.rectangle([48, y - 8, 48 + box[2] + 32, y + box[3] + 12], fill=(255, 214, 10))
            d.text((64, y), ln, font=font, fill=colour)
            y += box[3] + 28
    else:
        font = _font(78 if mode == "bottom" else 70)
        lines = textwrap.wrap(words.upper() if mode == "bottom" else words, 20 if mode == "bottom" else 24)[:3]
        y = h - 70 - len(lines) * 92 if mode == "bottom" else 70
        for ln in lines:
            d.text((60, y), ln, font=font, fill=colour, stroke_width=4, stroke_fill=(0, 0, 0))
            y += 92
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88)
    return out.getvalue()


def _azure_image(prompt: str) -> bytes:
    if not (settings.IMAGE_API_URL and settings.IMAGE_API_KEY):
        raise ImageError("The image model is not configured.")
    r = httpx.post(settings.IMAGE_API_URL, headers={"api-key": settings.IMAGE_API_KEY, "Content-Type": "application/json"},
                   json={"prompt": prompt[:1000], "size": "1792x1024", "n": 1, "response_format": "b64_json"},
                   timeout=httpx.Timeout(120.0, connect=10.0))
    if r.status_code >= 400:
        raise ImageError(f"image model refused: {r.status_code}")
    return base64.b64decode(r.json()["data"][0]["b64_json"])


def thumbnails(db: Session, video: Video, work: str) -> list[dict]:
    from app.video.media import ffmpeg
    from app.video.media.providers import provider
    from app.video.services import images

    if video.source == "embed" or video.status != "published":
        raise err(409, "video_not_ready")
    ideas = list(video.thumbnail_ideas or [])
    made = []
    if settings.IMAGE_PROVIDER == "azure":
        for name, _, _ in STYLES:
            raw = _azure_image(f"YouTube-style thumbnail, 16:9, bold readable title text \"{video.title[:80]}\", style: {name}")
            made.append({"at_ms": 0, "key": images.save(raw, max_side=1280), "reason": f"AI design · {name}", "ai": True})
    else:
        src = provider(video.provider).fetch_source(video, os.path.join(work, "source"))
        for n, style in enumerate(STYLES):
            at = max(500, int(video.duration_ms * (0.2 + 0.25 * n)))
            jpg = os.path.join(work, f"ai-{n}.jpg")
            ffmpeg.thumbnail(src, jpg, at)
            with open(jpg, "rb") as fh:
                raw = _compose(fh.read(), video.title, style)
            made.append({"at_ms": at, "key": images.save(raw, max_side=1280), "reason": f"AI design · {style[0]}", "ai": True})
    video.thumbnail_ideas = [i for i in ideas if not i.get("ai")] + made
    db.flush()
    return made


def chapters(db: Session, video: Video, items: list[dict], user_id: int) -> Insight:
    cur = db.execute(select(Insight).where(Insight.video_id == video.id).order_by(Insight.id.desc())).scalars().first()
    span = max(video.duration_ms, 1)
    clean = []
    for c in items:
        start = int(c.get("start_ms", -1))
        title = re.sub(r"\s+", " ", str(c.get("title", ""))).strip()[:80]
        if not title or not 0 <= start < span:
            raise err(400, "chapters_invalid")
        clean.append({"start_ms": start, "title": title})
    clean.sort(key=lambda c: c["start_ms"])
    if not clean or clean[0]["start_ms"] != 0 or len(clean) > 50:
        raise err(400, "chapters_invalid")
    if any(b["start_ms"] - a["start_ms"] < 5000 for a, b in zip(clean, clean[1:])):
        raise err(400, "chapters_too_close")
    row = Insight(tenant_id=video.tenant_id, video_id=video.id, language=cur.language if cur else video.language,
                  summary=cur.summary if cur else "", key_points=cur.key_points if cur else [], chapters=clean,
                  tags=cur.tags if cur else [], title_ideas=cur.title_ideas if cur else [], hashtags=cur.hashtags if cur else [],
                  model=f"creator-edit:{user_id}", version=(cur.version + 1) if cur else 1)
    db.add(row)
    db.flush()
    return row


def _cues(db: Session, video: Video) -> list[tuple[int, str]]:
    tr = db.execute(select(Transcript).where(Transcript.video_id == video.id, Transcript.is_current.is_(True))).scalars().first()
    if tr is None:
        return []
    return [(s.start_ms, s.text) for s in db.execute(select(Segment).where(Segment.transcript_id == tr.id)
                                                      .order_by(Segment.start_ms)).scalars()]


def _ts(ms: int) -> str:
    s = ms // 1000
    return f"{s // 60}:{s % 60:02d}"


def _sandbox_pack(video: Video, cues: list[tuple[int, str]], insight: Insight | None) -> dict:
    points = [p for p in (insight.key_points if insight else []) if p][:5] or [t for _, t in cues[:5]]
    chapters_ = (insight.chapters if insight else []) or [{"start_ms": 0, "title": video.title}]
    cites = [(ms, t) for ms, t in cues if t][:: max(1, len(cues) // 5 or 1)][:5]
    body = "\n\n".join(f"### {c['title']}\n\n" + " ".join(t for ms, t in cues
                                                            if c["start_ms"] <= ms < c["start_ms"] + 120_000)[:600]
                       for c in chapters_[:6])
    tags = " ".join(f"#{re.sub(r'[^A-Za-z0-9]', '', t)}" for t in (insight.tags if insight else [])[:5] if t)
    summary = (insight.summary if insight else "") or (cues[0][1] if cues else video.title)
    return {
        "blog_post": f"# {video.title}\n\n{summary}\n\n" + body + "\n\n" + "\n".join(f"- {p}" for p in points),
        "x_post": f"{video.title} — {points[0] if points else summary}"[:250] + f" {tags}"[:30],
        "linkedin_post": f"{video.title}\n\n" + "\n".join(f"• {p}" for p in points[:3]) + "\n\nWatch the full video on Klygenix Play.",
        "instagram_caption": f"{video.title} ✨\n\n{points[0] if points else summary}\n\n{tags}",
        "newsletter": f"This week: {video.title}. {summary}"[:600],
        "citations": [{"start_ms": ms, "label": _ts(ms), "text": t[:160]} for ms, t in cites],
    }


def repurpose(db: Session, video: Video, tenant_id: int, language: str = "en") -> RepurposePack:
    from app.ai import llm

    cues = _cues(db, video)
    if not cues:
        raise err(409, "video_not_ready")
    insight = db.execute(select(Insight).where(Insight.video_id == video.id).order_by(Insight.id.desc())).scalars().first()
    model = "sandbox"
    content = _sandbox_pack(video, cues, insight)
    if llm.is_configured():
        transcript = "\n".join(f"[{_ts(ms)}] {t}" for ms, t in cues)[:24000]
        system = ("You turn a video transcript into publishing material. Use only facts in the transcript. Return JSON with "
                  "blog_post (markdown), x_post (max 270 chars), linkedin_post, instagram_caption, newsletter, and citations: "
                  "a list of {start_ms, label, text} pointing at the transcript lines you used.")
        try:
            data, reply = llm.complete_json("repurpose", system, f"Title: {video.title}\nLanguage: {language}\n\n{transcript}",
                                            tenant_id=tenant_id)
            if isinstance(data, dict) and data.get("blog_post"):
                content, model = {**content, **{k: data[k] for k in content if k in data}}, reply.model
        except (llm.LlmFailed, llm.LlmUnavailable):
            model = "sandbox-fallback"
    row = RepurposePack(tenant_id=video.tenant_id, video_id=video.id, language=language, content=content, model=model)
    db.add(row)
    db.flush()
    return row


def markdown(pack: RepurposePack, title: str) -> str:
    c = pack.content
    cites = "\n".join(f"- [{x['label']}] {x['text']}" for x in c.get("citations", []))
    return (f"{c['blog_post']}\n\n---\n\n## X / Twitter\n\n{c['x_post']}\n\n## LinkedIn\n\n{c['linkedin_post']}\n\n"
            f"## Instagram\n\n{c['instagram_caption']}\n\n## Newsletter\n\n{c['newsletter']}\n\n## Sources in \"{title}\"\n\n{cites}\n")
