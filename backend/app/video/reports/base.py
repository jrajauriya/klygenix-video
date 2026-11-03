"""What a report declares, so that one writer can render all of them.

§19: a report declares its columns, their types and its query. Nothing here renders
anything, and nothing here knows what a Profit and Loss is.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

TEXT = "text"
MONEY = "money"
NUMBER = "number"
DATE = "date"
PERCENT = "percent"

RIGHT_ALIGNED = (MONEY, NUMBER, PERCENT)

FORMATS = ("json", "csv", "xlsx", "pdf")


class ReportError(ValueError):
    """A report that cannot be rendered as asked."""


@dataclass(frozen=True, slots=True)
class Column:
    key: str
    header: str
    type: str = TEXT
    total: bool = False
    currency_key: str | None = None

    @property
    def align(self) -> str:
        return "right" if self.type in RIGHT_ALIGNED else "left"


@dataclass(slots=True)
class Report:
    slug: str
    title: str
    columns: list[Column]
    rows: list[dict[str, Any]]
    currency: str = "INR"
    subtitle: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def totals(self) -> dict[str, int]:
        return {
            column.key: sum(int(row.get(column.key) or 0) for row in self.rows)
            for column in self.columns
            if column.total and not column.currency_key
        }

    def currency_of(self, row: dict[str, Any], column: Column) -> str:
        if column.currency_key:
            return str(row.get(column.currency_key) or self.currency)
        return self.currency

    def totals_by_currency(self) -> dict[str, dict[str, int]]:
        keyed = [c for c in self.columns if c.total and c.currency_key]
        out: dict[str, dict[str, int]] = {}
        for row in self.rows:
            for column in keyed:
                bucket = out.setdefault(self.currency_of(row, column), {c.key: 0 for c in keyed})
                bucket[column.key] += int(row.get(column.key) or 0)
        return dict(sorted(out.items()))
