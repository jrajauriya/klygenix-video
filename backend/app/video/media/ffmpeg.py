from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"


class MediaError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Probe:
    duration_ms: int
    width: int
    height: int
    has_audio: bool


def run(args: list[str], timeout: int = 1800) -> None:
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise MediaError((proc.stderr or proc.stdout or "ffmpeg failed")[-600:])


def probe(path: str) -> Probe:
    proc = subprocess.run(
        [FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise MediaError("Not a readable video file.")
    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise MediaError("The file has no video stream.")
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    rotate = int((video.get("tags") or {}).get("rotate") or 0)
    for side in video.get("side_data_list") or []:
        if "rotation" in side:
            rotate = int(side["rotation"])
    if abs(rotate) in (90, 270):
        width, height = height, width
    return Probe(int(duration * 1000), width, height, any(s.get("codec_type") == "audio" for s in streams))


def extract_audio(src: str, dst: str) -> None:
    run([FFMPEG, "-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dst])


def thumbnail(src: str, dst: str, at_ms: int) -> None:
    run([FFMPEG, "-y", "-v", "error", "-ss", f"{at_ms / 1000:.2f}", "-i", src, "-frames:v", "1",
         "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", dst])


RUNGS = ((360, 800_000), (720, 2_500_000))


def hls(src: str, out_dir: str, p: Probe) -> list[dict]:
    short = min(p.width, p.height) or 720
    rungs = [r for r in RUNGS if r[0] <= max(short, 360)] or [RUNGS[0]]
    made = []
    for side, bitrate in rungs:
        rdir = os.path.join(out_dir, f"{side}p")
        os.makedirs(rdir, exist_ok=True)
        scale = f"scale={side}:-2" if p.width < p.height else f"scale=-2:{side}"
        args = [FFMPEG, "-y", "-v", "error", "-i", src, "-map", "0:v:0"]
        if p.has_audio:
            args += ["-map", "0:a:0", "-c:a", "aac", "-b:a", "96k", "-ac", "2"]
        args += [
            "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-maxrate", str(bitrate), "-bufsize", str(bitrate * 2), "-g", "48", "-sc_threshold", "0",
            "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
            "-hls_segment_filename", os.path.join(rdir, "seg_%04d.ts"), os.path.join(rdir, "index.m3u8"),
        ]
        run(args)
        if p.width < p.height:
            w, h = side, int(round(side * p.height / max(p.width, 1) / 2) * 2)
        else:
            h, w = side, int(round(side * p.width / max(p.height, 1) / 2) * 2)
        made.append({"name": f"{side}p", "bandwidth": bitrate, "width": w, "height": h})
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for r in made:
        lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={r['bandwidth']},RESOLUTION={r['width']}x{r['height']}")
        lines.append(f"{r['name']}/index.m3u8")
    with open(os.path.join(out_dir, "master.m3u8"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    return made
