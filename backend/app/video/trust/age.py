from __future__ import annotations

from datetime import date

SIXTEEN = {"DE", "NL", "IE", "LU", "SK", "HU", "RO", "HR", "PL"}


def minimum_age(country: str) -> int:
    c = (country or "IN").upper()
    if c == "IN":
        return 18
    if c in SIXTEEN:
        return 16
    return 13


def age_on(birth: date, today: date | None = None) -> int:
    today = today or date.today()
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def old_enough(birth: date | None, country: str, today: date | None = None) -> bool:
    if birth is None:
        return False
    return age_on(birth, today) >= minimum_age(country)
