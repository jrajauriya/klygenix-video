"""One writer, every report, every format.

§19: no report has its own export code. Column types drive alignment, number formatting
and the xlsx cell format, and a money column carries its currency so the caller never
formats one.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

from app.video.money import exponent_for
from app.video.reports.base import (
    DATE,
    FORMATS,
    MONEY,
    NUMBER,
    PERCENT,
    Column,
    Report,
    ReportError,
)

CONTENT_TYPES = {
    "json": "application/json",
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}

XLSX_NUMBER_FORMATS = {
    MONEY: '#,##0.00',
    NUMBER: '#,##0',
    PERCENT: '0.00"%"',
    DATE: "dd-mmm-yyyy",
}


def major(minor: Any, currency: str) -> float | int:
    exponent = exponent_for(currency)
    if exponent == 0:
        return int(minor or 0)
    return round(int(minor or 0) / (10 ** exponent), exponent)


def render(report: Report, fmt: str) -> tuple[bytes | dict, str]:
    """Returns the rendered report and its content type."""
    if fmt not in FORMATS:
        raise ReportError(f"'{fmt}' is not a format. Available: {', '.join(FORMATS)}.")

    if fmt == "json":
        return _json(report), CONTENT_TYPES[fmt]
    if fmt == "csv":
        return _csv(report), CONTENT_TYPES[fmt]
    if fmt == "pdf":
        return _pdf(report), CONTENT_TYPES[fmt]
    return _xlsx(report), CONTENT_TYPES[fmt]


def _cell(value: Any, column: Column, currency: str) -> Any:
    if value is None:
        return None
    if column.type == MONEY:
        return major(value, currency)
    if column.type == NUMBER:
        return int(value)
    if column.type == DATE and isinstance(value, (date, datetime)):
        return value
    return value


def _json(report: Report) -> dict:
    return {
        "slug": report.slug,
        "title": report.title,
        "subtitle": report.subtitle,
        "currency": report.currency,
        "columns": [
            {
                "key": c.key,
                "header": c.header,
                "type": c.type,
                "align": c.align,
                "total": c.total,
                "currency_key": c.currency_key,
            }
            for c in report.columns
        ],
        "rows": report.rows,
        "totals": report.totals(),
        "totals_by_currency": report.totals_by_currency(),
        "meta": report.meta,
        "notes": report.notes,
    }


def _text(value: Any, column: Column, currency: str) -> str:
    rendered = _cell(value, column, currency)
    if rendered is None:
        return ""
    if isinstance(rendered, (date, datetime)):
        return rendered.isoformat()[:10]
    return str(rendered)


def _csv(report: Report) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([c.header for c in report.columns])
    for row in report.rows:
        writer.writerow([_text(row.get(c.key), c, report.currency_of(row, c)) for c in report.columns])

    totals = report.totals()
    if totals:
        writer.writerow(
            [
                "Total"
                if index == 0
                else _text(totals.get(c.key), c, report.currency)
                if c.key in totals
                else ""
                for index, c in enumerate(report.columns)
            ]
        )
    for currency, sums in report.totals_by_currency().items():
        writer.writerow(
            [
                f"Total in {currency}"
                if index == 0
                else _text(sums.get(c.key), c, currency)
                if c.key in sums
                else ""
                for index, c in enumerate(report.columns)
            ]
        )
    return out.getvalue().encode("utf-8-sig")


def _xlsx(report: Report) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = report.title[:31] or "Report"

    sheet.append([c.header for c in report.columns])
    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center")

    for row in report.rows:
        sheet.append([_cell(row.get(c.key), c, report.currency_of(row, c)) for c in report.columns])

    totals = report.totals()
    if totals:
        sheet.append(
            [
                "Total"
                if index == 0
                else _cell(totals.get(c.key), c, report.currency)
                if c.key in totals
                else None
                for index, c in enumerate(report.columns)
            ]
        )
        for cell in sheet[sheet.max_row]:
            cell.font = Font(bold=True)
    for currency, sums in report.totals_by_currency().items():
        sheet.append(
            [
                f"Total in {currency}"
                if index == 0
                else _cell(sums.get(c.key), c, currency)
                if c.key in sums
                else None
                for index, c in enumerate(report.columns)
            ]
        )
        for cell in sheet[sheet.max_row]:
            cell.font = Font(bold=True)

    for index, column in enumerate(report.columns, start=1):
        letter = get_column_letter(index)
        number_format = XLSX_NUMBER_FORMATS.get(column.type)
        for cell in sheet[letter][1:]:
            cell.alignment = Alignment(horizontal=column.align)
            if number_format:
                cell.number_format = number_format
        widest = max(
            [len(column.header)]
            + [len(_text(row.get(column.key), column, report.currency_of(row, column))) for row in report.rows]
            or [10]
        )
        sheet.column_dimensions[letter].width = min(max(widest + 3, 12), 48)

    sheet.freeze_panes = "A2"

    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def _pdf(report: Report) -> bytes:
    """§19's fourth format, on the same page furniture an invoice is printed on."""
    from app.video.documents.page import Column as PageColumn
    from app.video.documents.page import Document, Party
    from app.video.documents.page import money as printed_money

    def printed(value, column, currency=None):
        # A spreadsheet formats a raw number itself; a printed page cannot.
        if value is None:
            return ""
        if column.type == MONEY:
            return printed_money(value, currency or report.currency)
        return _text(value, column, currency or report.currency)

    landscape = len(report.columns) > 6
    pdf = Document(title=report.title, footer_note=report.subtitle or "")
    pdf.default_orientation = "L" if landscape else "P"
    pdf.add_page(orientation="L" if landscape else "P")

    pdf.masthead(
        supplier=Party(name=report.title),
        doc_label="Report",
        fields=[("Period", report.subtitle or "—"), ("Currency", report.currency)],
    )

    for note in report.notes:
        pdf.note_line(note, strong=True)
    if report.notes:
        pdf.ln(1)

    usable = pdf.usable
    share = usable / max(len(report.columns), 1)
    columns = [
        PageColumn(c.key, c.header, share, "R" if c.align == "right" else "L")
        for c in report.columns
    ]
    pdf.grid(
        columns,
        [
            {c.key: printed(row.get(c.key), c, report.currency_of(row, c)) for c in report.columns}
            for row in report.rows
        ],
    )

    totals = report.totals()
    printed_totals = [
        (
            next(c.header for c in report.columns if c.key == key),
            printed(value, next(c for c in report.columns if c.key == key)),
        )
        for key, value in totals.items()
    ]
    for currency, sums in report.totals_by_currency().items():
        printed_totals.extend(
            (
                f"{next(c.header for c in report.columns if c.key == key)} ({currency})",
                printed(value, next(c for c in report.columns if c.key == key), currency),
            )
            for key, value in sums.items()
        )
    if printed_totals:
        pdf.totals(printed_totals)

    return pdf.output_bytes()
