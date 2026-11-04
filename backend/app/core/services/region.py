from __future__ import annotations

from app.config import settings
from app.core.messages import err


def region_for(country: str | None) -> str:
    us = {c.strip().upper() for c in settings.REGION_US_COUNTRIES.split(",") if c.strip()}
    return "us" if (country or "IN").upper() in us else "in"


def urls() -> dict[str, str]:
    out = {}
    for part in settings.REGION_URLS.split(","):
        name, _, url = part.partition("=")
        if name.strip() and url.strip():
            out[name.strip()] = url.strip().rstrip("/")
    return out


def here() -> str:
    return settings.REGION if settings.REGION in ("in", "us") else "in"


def guard(region: str) -> None:
    if settings.REGION_ENFORCE and region != here():
        raise err(409, "account_in_other_region", url=urls().get(region, ""), region=region.upper())
