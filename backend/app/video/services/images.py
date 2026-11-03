from __future__ import annotations

import hashlib
import io

from PIL import Image, ImageOps

from app.config import settings
from app.video.storage import backend

MAX_BYTES = 8 * 1024 * 1024


class ImageError(Exception):
    pass


def save(data: bytes, *, max_side: int = 1600) -> str:
    if len(data) > MAX_BYTES:
        raise ImageError("too large")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as exc:
        raise ImageError("unreadable") from exc
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, "WEBP", quality=82)
    blob = out.getvalue()
    key = f"img/{hashlib.sha256(blob).hexdigest()[:32]}.webp"
    backend().put(key, blob, "image/webp")
    return key


def public_url(key: str | None) -> str | None:
    if not key:
        return None
    return f"{settings.API_PUBLIC_BASE_URL.rstrip('/')}/api/video/images/{key.split('/', 1)[1]}"


def load(name: str) -> bytes:
    if "/" in name or ".." in name or not name.endswith(".webp"):
        raise ImageError("bad name")
    return backend().get(f"img/{name}")
