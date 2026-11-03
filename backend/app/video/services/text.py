from __future__ import annotations

import re
import secrets
import unicodedata

HANDLE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
RESERVED = {
    "admin", "api", "studio", "play", "klygenix", "support", "help", "about", "login", "signup",
    "settings", "watch", "reels", "search", "channel", "channels", "legal", "terms", "privacy",
    "official", "staff", "moderator", "root", "www", "mail", "upload", "uploads",
}


def slugify(value: str, fallback: str = "channel") -> str:
    norm = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", norm.lower()).strip("-")
    return slug or fallback


def is_valid_handle(handle: str) -> bool:
    return bool(HANDLE.match(handle or ""))


def is_valid_creator_handle(handle: str) -> bool:
    return is_valid_handle(handle) and handle not in RESERVED


def public_id() -> str:
    alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(11))
