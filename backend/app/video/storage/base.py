"""What a place to keep a file has to be able to do."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class StorageError(Exception):
    """The object could not be written, read or removed."""


@dataclass(frozen=True, slots=True)
class Stored:
    key: str
    size_bytes: int
    checksum: str
    backend: str


class Storage(Protocol):
    name: str

    def put(self, key: str, data: bytes, content_type: str) -> Stored: ...

    def get(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...

    def signed_url(self, key: str, *, ttl_seconds: int = 300) -> str | None: ...
