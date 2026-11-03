from __future__ import annotations

import os

from app.config import settings

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def _root(rel: str) -> str:
    path = rel if os.path.isabs(rel) else os.path.join(BACKEND, rel)
    os.makedirs(path, exist_ok=True)
    return path


def media_root() -> str:
    return _root("private_uploads/media")


def work_root() -> str:
    return _root(settings.MEDIA_WORK_DIR)


def video_dir(video_id: int) -> str:
    path = os.path.join(media_root(), str(video_id))
    os.makedirs(path, exist_ok=True)
    return path


def work_dir(name: str) -> str:
    path = os.path.join(work_root(), name)
    os.makedirs(path, exist_ok=True)
    return path


def inside(root: str, *parts: str) -> str:
    resolved = os.path.realpath(os.path.join(root, *parts))
    if not resolved.startswith(os.path.realpath(root) + os.sep):
        raise ValueError("path escapes its root")
    return resolved
