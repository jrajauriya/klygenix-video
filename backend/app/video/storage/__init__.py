"""Where files live. One interface, one implementation per backend."""

from __future__ import annotations

import functools

from app.config import settings
from app.video.storage.base import Storage, StorageError, Stored
from app.video.storage.local import LocalStorage
from app.video.storage.s3 import S3Storage

__all__ = ["Storage", "StorageError", "Stored", "backend", "storage_name"]


def storage_name() -> str:
    return "s3" if settings.S3_BUCKET else "local"


@functools.lru_cache(maxsize=1)
def backend() -> Storage:
    if storage_name() == "s3":
        return S3Storage()
    return LocalStorage()
