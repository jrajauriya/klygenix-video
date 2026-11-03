from __future__ import annotations

import os
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

from app.ai.captions import Cue
from app.video.media.ffmpeg import FFMPEG, Probe, run

FONT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "documents", "fonts",
                    "NotoSansDevanagari-Regular.ttf")
SIZES = {"9:16": (720, 1280), "1:1": (720, 720), "16:9": (1280, 720)}
RATIOS = {"9:16": 9 / 16, "1:1": 1.0, "16:9": 16 / 9}


@dataclass(frozen=True, slots=True)
class Spec:
    start_ms: int
    end_ms: int
    aspect: str = "9:16"
    center_x: float = 0.5
    caption_style: str = "bold"
    watermark: bool = False
    brand: str = "Klygenix Play"


def crop_filter(p: Probe, spec: Spec) -> str:
    W, H = SIZES[spec.aspect]
    ratio = RATIOS[spec.aspect]
    src_ratio = p.width / max(p.height, 1)
    if src_ratio > ratio:
        ch = p.height
        cw = int(round(ch * ratio / 2) * 2)
        x = int(max(0, min(p.width - cw, spec.center_x * p.width - cw / 2)))
        crop = f"crop={cw}:{ch}:{x}:0"
    else:
        cw = p.width
        ch = int(round(cw / ratio / 2) * 2)
        y = int(max(0, (p.height - ch) / 2))
        crop = f"crop={cw}:{ch}:0:{y}"
    return f"{crop},scale={W}:{H},setsar=1"


def chunks(cues: list[Cue], start_ms: int, end_ms: int, words_per: int = 4) -> list[tuple[int, int, list[str]]]:
    out = []
    for c in cues:
        if c.end_ms <= start_ms or c.start_ms >= end_ms:
            continue
        ws = c.text.split()
        if not ws:
            continue
        a, b = max(c.start_ms, start_ms), min(c.end_ms, end_ms)
        per = (c.end_ms - c.start_ms) / len(ws)
        for i in range(0, len(ws), words_per):
            group = ws[i:i + words_per]
            t0 = c.start_ms + per * i
            t1 = c.start_ms + per * (i + len(group))
            t0, t1 = max(t0, a), min(t1, b)
            if t1 - t0 >= 120:
                out.append((int(t0 - start_ms), int(t1 - start_ms), group))
    return out


def _font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def _frame(W: int, H: int, words: list[str], style: str, highlight: int | None, watermark: bool, brand: str) -> Image.Image:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if watermark:
        wf = _font(max(18, W // 32))
        draw.text((W - 16, 16), brand, font=wf, fill=(255, 255, 255, 190), anchor="ra",
                  stroke_width=2, stroke_fill=(0, 0, 0, 160))
    if not words or style == "none":
        return img
    bold = style in ("bold", "karaoke")
    size = max(28, W // (11 if bold else 16))
    font = _font(size)
    text_words = [w.upper() if bold else w for w in words]
    line = " ".join(text_words)
    max_w = W * 0.86
    lines = [line]
    if draw.textlength(line, font=font) > max_w and len(text_words) > 1:
        mid = (len(text_words) + 1) // 2
        lines = [" ".join(text_words[:mid]), " ".join(text_words[mid:])]
    y = int(H * (0.70 if W < H else 0.80))
    line_h = int(size * 1.25)
    idx = 0
    for ln in lines:
        lw = draw.textlength(ln, font=font)
        x = (W - lw) / 2
        if style == "clean":
            pad = size // 3
            draw.rounded_rectangle((x - pad, y - pad // 2, x + lw + pad, y + line_h), radius=pad,
                                   fill=(0, 0, 0, 150))
        for w in ln.split(" "):
            fill = (255, 230, 0, 255) if highlight is not None and idx == highlight else (255, 255, 255, 255)
            draw.text((x, y), w, font=font, fill=fill, stroke_width=(max(3, size // 12) if bold else 0),
                      stroke_fill=(0, 0, 0, 255))
            x += draw.textlength(w + " ", font=font)
            idx += 1
        y += line_h
    return img


def caption_track(work: str, cues: list[Cue], spec: Spec) -> str | None:
    W, H = SIZES[spec.aspect]
    dur = spec.end_ms - spec.start_ms
    items = chunks(cues, spec.start_ms, spec.end_ms) if spec.caption_style != "none" else []
    if not items and not spec.watermark:
        return None
    frames: list[tuple[str, int]] = []
    blank = os.path.join(work, "blank.png")
    _frame(W, H, [], spec.caption_style, None, spec.watermark, spec.brand).save(blank)
    t = 0
    n = 0
    for t0, t1, group in items:
        if t0 > t:
            frames.append((blank, t0 - t))
        if spec.caption_style == "karaoke":
            per = (t1 - t0) / len(group)
            for k in range(len(group)):
                path = os.path.join(work, f"cap_{n:05d}.png")
                _frame(W, H, group, "karaoke", k, spec.watermark, spec.brand).save(path)
                frames.append((path, int(per)))
                n += 1
        else:
            path = os.path.join(work, f"cap_{n:05d}.png")
            _frame(W, H, group, spec.caption_style, None, spec.watermark, spec.brand).save(path)
            frames.append((path, t1 - t0))
            n += 1
        t = t1
    if t < dur:
        frames.append((blank, dur - t))
    listing = os.path.join(work, "captions.txt")
    with open(listing, "w") as fh:
        for path, ms in frames:
            fh.write(f"file '{path}'\nduration {max(ms, 40) / 1000:.3f}\n")
        fh.write(f"file '{frames[-1][0]}'\n")
    return listing


def render(src: str, out: str, work: str, probe: Probe, cues: list[Cue], spec: Spec) -> None:
    dur = (spec.end_ms - spec.start_ms) / 1000
    listing = caption_track(work, cues, spec)
    args = [FFMPEG, "-y", "-v", "error", "-ss", f"{spec.start_ms / 1000:.3f}", "-t", f"{dur:.3f}", "-i", src]
    vf = crop_filter(probe, spec)
    if listing:
        args += ["-f", "concat", "-safe", "0", "-i", listing]
        graph = f"[0:v]{vf}[base];[1:v]format=rgba[cap];[base][cap]overlay=0:0:shortest=1:format=auto[v]"
    else:
        graph = f"[0:v]{vf}[v]"
    args += ["-filter_complex", graph, "-map", "[v]"]
    if probe.has_audio:
        args += ["-map", "0:a:0", "-c:a", "aac", "-b:a", "128k"]
    args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30",
             "-movflags", "+faststart", "-t", f"{dur:.3f}", out]
    run(args, timeout=1800)
