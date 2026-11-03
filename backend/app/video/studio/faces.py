from __future__ import annotations

import subprocess

import numpy as np

from app.config import settings
from app.video.media.ffmpeg import FFMPEG, MediaError, probe

SAMPLE_FPS = 4
WIDTH = 320


def frames(src: str, start_ms: int, end_ms: int, width: int = WIDTH, fps: int = SAMPLE_FPS):
    info = probe(src)
    height = max(2, int(round(width * info.height / max(info.width, 1) / 2)) * 2)
    dur = max(0.1, (end_ms - start_ms) / 1000)
    proc = subprocess.run([FFMPEG, "-v", "error", "-ss", f"{start_ms / 1000:.3f}", "-t", f"{dur:.3f}", "-i", src,
                           "-vf", f"fps={fps},scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                          capture_output=True, timeout=900)
    if proc.returncode != 0:
        raise MediaError((proc.stderr or b"ffmpeg failed")[-400:].decode(errors="replace"))
    step = width * height * 3
    raw = proc.stdout
    for i in range(len(raw) // step):
        yield start_ms + int(i * 1000 / fps), np.frombuffer(raw[i * step:(i + 1) * step], np.uint8).reshape(height, width, 3)


class MarkerDetector:
    name = "sandbox"

    def centre(self, img: np.ndarray) -> float | None:
        r, g, b = img[..., 0].astype(int), img[..., 1].astype(int), img[..., 2].astype(int)
        mask = (r > 225) & (b > 225) & (g < 70)
        if mask.sum() < max(20, img.shape[0] * img.shape[1] // 600):
            return None
        return float(np.nonzero(mask)[1].mean() / img.shape[1])


class OpenCvDetector:
    name = "opencv"

    def __init__(self) -> None:
        import cv2

        self.cv2 = cv2
        self.cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    def centre(self, img: np.ndarray) -> float | None:
        gray = self.cv2.cvtColor(img, self.cv2.COLOR_RGB2GRAY)
        found = self.cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=5, minSize=(24, 24))
        if len(found) == 0:
            return None
        x, _, w, _ = max(found, key=lambda f: f[2] * f[3])
        return float((x + w / 2) / img.shape[1])


def detector():
    if settings.FACE_PROVIDER == "opencv":
        return OpenCvDetector()
    return MarkerDetector()


def detect(src: str, start_ms: int, end_ms: int) -> list[tuple[int, float | None]]:
    d = detector()
    return [(t, d.centre(img)) for t, img in frames(src, start_ms, end_ms)]
