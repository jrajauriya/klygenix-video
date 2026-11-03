"""API keys: minted once, stored hashed, scoped by an allowlist (§20).

**A key is stored as a hash, and that is the opposite decision from a gateway credential.**
A provider's secret is Fernet-sealed because we have to replay it to sign a request; our
own key we only ever *verify*, so there is nothing to decrypt and a stolen database yields
nothing that can be presented to the API. Same word — credential — two different jobs.

**A key acts as the user who issued it.** That is what lets the whole product stay behind
one implementation of every route: `require_permission` runs unchanged, so a key can never
do more than the person who created it, and deactivating them stops it. Scopes narrow that
further; they never widen it.

**What is not in SCOPE_SURFACE is refused to a key**, whatever its scopes and whatever its
user may do. Gateway credentials, users and roles, and the key routes themselves are
absent on purpose: a key that can mint another key defeats revocation.
"""

from __future__ import annotations

import hashlib
import ipaddress
import re
import secrets as pysecrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

PREFIX = "kv_live_"
SECRET_BYTES = 32
PREFIX_LENGTH = 8

S = "/api/video/studio"

SCOPES = (
    "videos:read", "videos:write",
    "clips:read", "clips:write",
    "analytics:read",
)

SCOPE_SURFACE: dict[str, tuple[tuple[str, str], ...]] = {
    "videos:read": (
        ("GET", f"{S}/videos"),
        ("GET", f"{S}/videos/{{}}"),
        ("GET", f"{S}/videos/{{}}/transcript"),
        ("GET", f"{S}/videos/{{}}/suggestions"),
    ),
    "videos:write": (
        ("POST", f"{S}/videos"),
        ("PATCH", f"{S}/videos/{{}}"),
        ("POST", f"{S}/videos/{{}}/uploaded"),
        ("POST", f"{S}/videos/{{}}/captions"),
    ),
    "clips:read": (
        ("GET", f"{S}/clips"),
        ("GET", f"{S}/clips/{{}}"),
    ),
    "clips:write": (
        ("POST", f"{S}/clips"),
        ("PATCH", f"{S}/clips/{{}}"),
        ("POST", f"{S}/clips/{{}}/render"),
        ("POST", f"{S}/clips/{{}}/publish"),
    ),
    "analytics:read": (
        ("GET", f"{S}/channel"),
        ("GET", "/api/video/me"),
    ),
}

_PARAM = re.compile(r"\{[^}]*\}")


def generic(path: str) -> str:
    """`/api/pay/invoices/12` and `/api/pay/invoices/{invoice_id}` become one string."""
    collapsed = _PARAM.sub("{}", path)
    return re.sub(r"/\d+(?=/|$)", "/{}", collapsed)


def surfaces_for(scopes: list[str] | tuple[str, ...]) -> set[tuple[str, str]]:
    allowed: set[tuple[str, str]] = set()
    for scope in scopes:
        allowed.update(SCOPE_SURFACE.get(scope, ()))
    return allowed


def may_reach(scopes: list[str] | tuple[str, ...], method: str, path: str) -> bool:
    return (method.upper(), generic(path)) in surfaces_for(scopes)


def networks(values) -> list[str]:
    out: list[str] = []
    for raw in values or []:
        text_ = (raw or "").strip()
        if not text_:
            continue
        try:
            network = str(ipaddress.ip_network(text_, strict=False))
        except ValueError:
            raise ValueError(
                f"'{text_}' is not an address or a network. Write one such as 203.0.113.7 "
                "or 203.0.113.0/24."
            ) from None
        if network not in out:
            out.append(network)
    return out


def allows(allowed: list[str] | None, host: str | None) -> bool:
    if not allowed:
        return True
    if not host:
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    if address.version == 6 and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return any(address in ipaddress.ip_network(n, strict=False) for n in allowed)


def unknown_scopes(scopes: list[str]) -> list[str]:
    return [s for s in scopes if s not in SCOPES]


def mint() -> tuple[str, str, str]:
    """Returns (the whole key, its visible prefix, its hash). The key is never stored."""
    body = pysecrets.token_urlsafe(SECRET_BYTES)[:43]
    key = f"{PREFIX}{body}"
    return key, key[: len(PREFIX) + PREFIX_LENGTH], digest(key)


def digest(key: str) -> str:
    """SHA-256, not bcrypt: this is 256 bits of entropy we generated, not a human's
    password, so there is nothing to slow an attacker down about — and a key is checked on
    every request."""
    return hashlib.sha256(key.encode()).hexdigest()


# At most one write per key per minute. Every request would otherwise write a row, and the
# question this column answers — "is anything still using this key?" — is not a per-second one.
TOUCH_AFTER = timedelta(seconds=60)


def touch(key) -> None:
    """Record that a key was presented, on its own connection.

    Deliberately not part of the request's transaction. "This key was used" is true whether
    or not the request went on to succeed — and a refused or failed request is exactly the
    one somebody investigating a leaked key most wants to see. Tying it to the request would
    mean a read-only GET, which never commits, silently recorded nothing at all.
    """
    now = datetime.now(timezone.utc)
    if key.last_used_at is not None and now - key.last_used_at < TOUCH_AFTER:
        return

    from app.database import SessionLocal
    from sqlalchemy import text

    own = SessionLocal()
    try:
        own.execute(
            text("UPDATE kv_admin.api_keys SET last_used_at = :now WHERE id = :id"),
            {"now": now, "id": key.id},
        )
        own.commit()
        key.last_used_at = now
    except Exception:
        own.rollback()
    finally:
        own.close()


def resolve(db: Session, presented: str):
    """The live key this string is, or None. Never says which of the reasons it failed."""
    from app.core.models.api_key import ApiKey

    if not presented or not presented.startswith(PREFIX):
        return None

    row = db.execute(
        select(ApiKey).where(ApiKey.secret_hash == digest(presented))
    ).scalars().first()
    if row is None or not row.is_active or row.revoked_at is not None:
        return None
    if row.expires_at is not None and row.expires_at <= datetime.now(timezone.utc):
        return None
    return row
