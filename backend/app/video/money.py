"""Money, as a type."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column

# ISO 4217 minor-unit exponents that are not 2. Everything absent from this map is 2.
_EXPONENT: dict[str, int] = {
    # three-decimal currencies
    "BHD": 3, "IQD": 3, "JOD": 3, "KWD": 3, "LYD": 3, "OMR": 3, "TND": 3,
    # zero-decimal currencies
    "BIF": 0, "CLP": 0, "DJF": 0, "GNF": 0, "ISK": 0, "JPY": 0, "KMF": 0,
    "KRW": 0, "PYG": 0, "RWF": 0, "UGX": 0, "VND": 0, "VUV": 0,
    "XAF": 0, "XOF": 0, "XPF": 0,
}


class MoneyError(ValueError):
    """A money operation that cannot be performed, as opposed to one that lost data."""


def exponent_for(currency: str) -> int:
    """Minor-unit exponent for a currency code. Unknown codes are assumed 2."""
    if not currency or len(currency) != 3:
        raise MoneyError(f"Not a currency code: {currency!r}")
    return _EXPONENT.get(currency.upper(), 2)


def round_half_up(value: Decimal | float | str, currency: str) -> int:
    """A major-unit amount to minor units, rounded half-up."""
    exp = exponent_for(currency)
    try:
        d = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, TypeError) as exc:
        raise MoneyError(f"Not an amount: {value!r}") from exc
    scaled = d * (10**exp)
    return int(scaled.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@dataclass(frozen=True, slots=True)
class Money:
    """An amount in a currency. Immutable, and closed under same-currency arithmetic."""

    amount_minor: int
    currency: str

    def __post_init__(self) -> None:
        if not isinstance(self.amount_minor, int) or isinstance(self.amount_minor, bool):
            raise MoneyError(f"amount_minor must be an int, got {type(self.amount_minor).__name__}")
        # Validates the code and normalises nothing else — the caller's casing is theirs.
        exponent_for(self.currency)

    # ── construction ────────────────────────────────────────────────
    @classmethod
    def zero(cls, currency: str) -> Money:
        return cls(0, currency)

    @classmethod
    def of(cls, major: Decimal | float | str, currency: str) -> Money:
        """From a major-unit amount a human typed. `Money.of("11800.00", "INR")`."""
        return cls(round_half_up(major, currency), currency)

    # ── arithmetic ──────────────────────────────────────────────────
    def _same(self, other: Money) -> None:
        if not isinstance(other, Money):
            raise MoneyError(f"Cannot combine Money with {type(other).__name__}")
        if self.currency.upper() != other.currency.upper():
            raise MoneyError(f"Cannot combine {self.currency} with {other.currency}")

    def __add__(self, other: Money) -> Money:
        self._same(other)
        return Money(self.amount_minor + other.amount_minor, self.currency)

    def __sub__(self, other: Money) -> Money:
        self._same(other)
        return Money(self.amount_minor - other.amount_minor, self.currency)

    def __neg__(self) -> Money:
        return Money(-self.amount_minor, self.currency)

    def __mul__(self, factor: Decimal | int | float | str) -> Money:
        """Scale by a quantity or a rate. Rounds half-up back to the minor unit."""
        f = factor if isinstance(factor, Decimal) else Decimal(str(factor))
        scaled = Decimal(self.amount_minor) * f
        return Money(int(scaled.quantize(Decimal("1"), rounding=ROUND_HALF_UP)), self.currency)

    __rmul__ = __mul__

    def __lt__(self, other: Money) -> bool:
        self._same(other)
        return self.amount_minor < other.amount_minor

    def __le__(self, other: Money) -> bool:
        self._same(other)
        return self.amount_minor <= other.amount_minor

    # ── inspection ──────────────────────────────────────────────────
    @property
    def is_zero(self) -> bool:
        return self.amount_minor == 0

    @property
    def major(self) -> Decimal:
        """Major units, for display and for documents. Never for further arithmetic."""
        exp = exponent_for(self.currency)
        return Decimal(self.amount_minor).scaleb(-exp)

    def __str__(self) -> str:
        return f"{self.major} {self.currency.upper()}"


def total(amounts: list[Money], currency: str) -> Money:
    """Sum already-rounded amounts."""
    out = Money.zero(currency)
    for a in amounts:
        out = out + a
    return out


def allocate(amount: Money, weights: list[int]) -> list[Money]:
    """Split an amount across weights, giving the remainder to the largest weight."""
    if not weights:
        return []
    denominator = sum(weights)
    if denominator == 0:
        # Nothing to weight by — give it all to the first line rather than dividing by zero.
        return [amount] + [Money.zero(amount.currency)] * (len(weights) - 1)

    parts = [
        Money(amount.amount_minor * w // denominator, amount.currency) for w in weights
    ]
    remainder = amount.amount_minor - sum(p.amount_minor for p in parts)
    if remainder:
        biggest = max(range(len(weights)), key=lambda i: weights[i])
        parts[biggest] = Money(parts[biggest].amount_minor + remainder, amount.currency)
    return parts


def money_columns(prefix: str, *, nullable: bool = False) -> tuple[Mapped[int], Mapped[str]]:
    """Declare a money column pair identically everywhere."""
    return (
        mapped_column(f"{prefix}_minor", BigInteger, nullable=nullable, default=0),
        mapped_column(f"{prefix}_currency", String(3), nullable=nullable),
    )
