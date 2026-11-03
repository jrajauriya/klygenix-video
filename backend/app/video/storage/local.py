"""Files on this machine's disk.

The development default, and the thing §04 says a statutory record must not end up on:
a seven-year record does not live on one VPS. Fine for a laptop, refused in production
by the check in __init__.
"""

from __future__ import annotations

import hashlib
import os

from app.video.storage.base import Stored, StorageError

ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    "private_uploads",
    "attachments",
)


class LocalStorage:
    name = "local"

    def _path(self, key: str) -> str:
        resolved = os.path.realpath(os.path.join(ROOT, key))
        if not resolved.startswith(os.path.realpath(ROOT) + os.sep):
            raise StorageError("That key points outside the store.")
        return resolved

    def put(self, key: str, data: bytes, content_type: str) -> Stored:
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(data)
        return Stored(
            key=key,
            size_bytes=len(data),
            checksum=hashlib.sha256(data).hexdigest(),
            backend=self.name,
        )

    def get(self, key: str) -> bytes:
        try:
            with open(self._path(key), "rb") as handle:
                return handle.read()
        except FileNotFoundError as exc:
            raise StorageError("That file is no longer here.") from exc

    def delete(self, key: str) -> None:
        try:
            os.remove(self._path(key))
        except FileNotFoundError:
            pass

    def signed_url(self, key: str, *, ttl_seconds: int = 300) -> str | None:
        return None
