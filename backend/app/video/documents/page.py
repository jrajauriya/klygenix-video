"""The page every Klygenix Pay document is printed on.

§19 has the report PDF path reuse this rather than grow its own, which is what keeps a
statement and an invoice recognisably the same product. A document module supplies its
words and its columns; the furniture lives here.
"""

from __future__ import annotations

import os
import pathlib
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from decimal import Decimal

from fpdf import FPDF

from app.video.money import exponent_for

NAVY = (15, 23, 42)
BRAND = (13, 148, 136)
SLATE = (100, 116, 139)
LINE = (226, 232, 240)
WHITE = (255, 255, 255)

MARGIN = 14
ONES = (
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen",
)
TENS = ("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety")

CURRENCY_WORDS = {
    "INR": ("Rupees", "Paise"),
    "USD": ("Dollars", "Cents"),
    "EUR": ("Euros", "Cents"),
    "GBP": ("Pounds", "Pence"),
}



# fpdf's built-in fonts are latin-1. An em dash, a curly quote or a customer whose name
# is not Latin would raise inside the renderer, and `ensure_quietly` would swallow it —
# leaving an invoice with no document and nobody told. Everything printed goes through
# here instead. A Unicode font is the real answer for non-Latin names; see CLAUDE.md.
TRANSLITERATE = str.maketrans({
    "\u2014": "-", "\u2013": "-", "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u00b7": "-",
    "\u20b9": "INR ", "\u2022": "-", "\u00a0": " ", "\u2212": "-",
})


UNICODE_FAMILY = "noto"
FONT_DIR = pathlib.Path(__file__).parent / "fonts"
SCRIPT_FONTS = {
    "Devanagari": FONT_DIR / "NotoSansDevanagari-Regular.ttf",
    "Bengali": FONT_DIR / "NotoSansBengali-Regular.ttf",
    "Tamil": FONT_DIR / "NotoSansTamil-Regular.ttf",
    "Telugu": FONT_DIR / "NotoSansTelugu-Regular.ttf",
}
SCRIPT_RANGES = (("Devanagari", 0x0900, 0x097F), ("Bengali", 0x0980, 0x09FF),
                 ("Tamil", 0x0B80, 0x0BFF), ("Telugu", 0x0C00, 0x0C7F))
SCRIPT_TAGS = {"Devanagari": "deva", "Bengali": "beng", "Tamil": "taml", "Telugu": "telu"}
UNICODE_FILE = SCRIPT_FONTS["Devanagari"]
_BOLD: dict[str, str] = {}


def safe(value) -> str:
    """The text as written, with a few symbols spelled out.

    It used to end in `.encode("latin-1", "replace")`, which turned a customer named in
    Devanagari into ????? on their own tax invoice. The core PDF fonts are latin-1 and
    always will be, so the fix is a font rather than a sanitiser: `Document` switches to
    an embedded one for any run that needs it.
    """
    text = "" if value is None else str(value)
    return text.translate(TRANSLITERATE)


def needs_unicode(text: str) -> bool:
    try:
        text.encode("latin-1")
    except UnicodeEncodeError:
        return True
    return False


def scripts_in(text: str) -> list[str]:
    found: list[str] = []
    for ch in text or "":
        code = ord(ch)
        if code < 0x0900:
            continue
        for name, lo, hi in SCRIPT_RANGES:
            if lo <= code <= hi and name not in found:
                found.append(name)
    return found


def script_tag(text: str) -> str | None:
    found = scripts_in(text)
    return SCRIPT_TAGS.get(found[0]) if len(found) == 1 else None


def family_for(script: str) -> str:
    return f"{UNICODE_FAMILY}-{script.lower()}"


def bold_file(script: str) -> str:
    source = SCRIPT_FONTS[script]
    if script not in _BOLD:
        try:
            from fontTools.ttLib import TTFont
            from fontTools.varLib.instancer import instantiateVariableFont

            out = (pathlib.Path(tempfile.gettempdir()) / "klygenix-video-fonts"
                   / f"{source.stem.replace('-Regular', '')}-Bold-{source.stat().st_size}.ttf")
            if not out.exists():
                out.parent.mkdir(parents=True, exist_ok=True)
                font = TTFont(str(source))
                if "fvar" not in font:
                    raise ValueError("static font")
                instantiateVariableFont(font, {"wght": 700, "wdth": 100}, inplace=True)
                partial = out.with_name(f"{out.stem}.{os.getpid()}.part")
                font.save(str(partial))
                os.replace(partial, out)
            _BOLD[script] = str(out)
        except Exception:  # noqa: BLE001
            _BOLD[script] = str(source)
    return _BOLD[script]


def register_script(pdf: FPDF, script: str) -> bool:
    family = family_for(script)
    if family in pdf.fonts:
        return True
    source = SCRIPT_FONTS.get(script)
    if source is None or not source.exists():
        return False
    try:
        pdf.add_font(family, "", str(source))
        pdf.add_font(family, "B", bold_file(script))
    except Exception:  # noqa: BLE001
        return False
    return True


def families_for(pdf: FPDF, text: str, primary: str | None = None) -> list[str]:
    scripts = scripts_in(text)
    if primary:
        scripts = [primary] + [s for s in scripts if s != primary]
    return [family_for(s) for s in (scripts or ["Devanagari"]) if register_script(pdf, s)]


@dataclass(frozen=True, slots=True)
class Party:
    name: str
    lines: list[str] = field(default_factory=list)
    registration: str | None = None
    registration_label: str = "GSTIN"


@dataclass(frozen=True, slots=True)
class Column:
    key: str
    header: str
    width: float
    align: str = "L"


def _under_hundred(n: int) -> str:
    if n < 20:
        return ONES[n]
    tens, ones = divmod(n, 10)
    return TENS[tens] + (f" {ONES[ones]}" if ones else "")


def _indian_groups(n: int) -> str:
    """Lakh and crore, because an Indian invoice reads in them."""
    parts: list[str] = []
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1_000)
    hundred, rest = divmod(n, 100)

    if crore:
        parts.append(f"{_indian_groups(crore)} Crore")
    if lakh:
        parts.append(f"{_under_hundred(lakh)} Lakh")
    if thousand:
        parts.append(f"{_under_hundred(thousand)} Thousand")
    if hundred:
        parts.append(f"{ONES[hundred]} Hundred")
    if rest:
        parts.append(("and " if parts else "") + _under_hundred(rest))
    return " ".join(p for p in parts if p)


def amount_in_words(minor: int, currency: str) -> str:
    """Every Indian invoice carries this and no table holds it."""
    exponent = exponent_for(currency)
    scale = 10**exponent
    whole, fraction = divmod(abs(int(minor)), scale)
    major_word, minor_word = CURRENCY_WORDS.get(currency.upper(), (currency.upper(), "cents"))

    said = _indian_groups(whole) or "Zero"
    out = f"{major_word} {said}"
    if fraction:
        out += f" and {_under_hundred(fraction)} {minor_word}"
    return out + " only"


def money(minor: int, currency: str) -> str:
    exponent = exponent_for(currency)
    value = Decimal(int(minor)).scaleb(-exponent)
    return f"{value:,.{exponent}f}"


class Document(FPDF):
    def __init__(self, *, title: str, footer_note: str | None = None) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.doc_title = title
        self.footer_note = footer_note
        self.set_auto_page_break(auto=True, margin=20)
        self.set_margins(MARGIN, MARGIN, MARGIN)
        self.set_title(safe(title))

    def _shaping(self, on: bool, script: str | None = None) -> None:
        """Devanagari is not written in codepoint order.

        A matra is typed after its consonant and drawn before it, and a conjunct is two
        letters and one glyph. Without the shaper the letters all appear and none of them
        is where it belongs - text that looks real and says something else.
        """
        try:
            self.set_text_shaping(on, script=script) if on else self.set_text_shaping(False)
        except Exception:  # noqa: BLE001 - no shaper installed, glyphs beat nothing
            pass

    def _writable(self, text: str) -> str:
        """What can actually be drawn with the font we are about to use.

        Only reached when the embedded font is missing — a deploy that did not copy the
        fonts directory. The old ????? is a poor invoice; a 500 on every report that
        mentions the customer is a worse one.
        """
        return text.encode("latin-1", "replace").decode("latin-1")

    @contextmanager
    def _font_for(self, text: str, pin: bool = False):
        """Helvetica unless this particular run needs more than latin-1."""
        families = families_for(self, text) if needs_unicode(text) else []
        if not families:
            yield
            return
        family, style, size = self.font_family, self.font_style, self.font_size_pt
        self.set_font(families[0], "B" if "B" in (style or "") else "", size)
        if len(families) > 1:
            self.set_fallback_fonts(families[1:])
        self._shaping(True, script_tag(text) if pin else None)
        try:
            yield
        finally:
            self._shaping(False)
            if len(families) > 1:
                self.set_fallback_fonts([])
            self.set_font(family, style, size)

    def _drawable(self, args: tuple, kw: dict) -> tuple[str, tuple, dict]:
        for key in ("text", "txt"):
            if kw.get(key):
                written = str(kw[key])
                if needs_unicode(written) and not families_for(self, written):
                    kw = {**kw, key: self._writable(written)}
                return written, args, kw
        if len(args) > 2 and args[2]:
            written = str(args[2])
            if needs_unicode(written) and not families_for(self, written):
                args = (*args[:2], self._writable(written), *args[3:])
            return written, args, kw
        return "", args, kw

    def cell(self, *args, **kw):
        written, args, kw = self._drawable(args, kw)
        with self._font_for(written):
            return super().cell(*args, **kw)

    def multi_cell(self, *args, **kw):
        written, args, kw = self._drawable(args, kw)
        with self._font_for(written, pin=True):
            return super().multi_cell(*args, **kw)

    @property
    def usable(self) -> float:
        return self.w - 2 * MARGIN

    def footer(self) -> None:
        self.set_y(-16)
        self.set_font("helvetica", size=7)
        self.set_text_color(*SLATE)
        left = self.footer_note or ""
        self.cell(self.usable / 2, 4, safe(left), align="L")
        self.cell(self.usable / 2, 4, f"Page {self.page_no()} of {{nb}}", align="R")

    def masthead(self, *, supplier: Party, doc_label: str, fields: list[tuple[str, str]], split: float = 0.6) -> None:
        right = 1 - split
        chars = int(70 * split / 0.6)
        self.set_font("helvetica", "B", 15)
        self.set_text_color(*NAVY)
        self.cell(self.usable * split, 8, safe(supplier.name)[:int(60 * split / 0.6)])

        self.set_font("helvetica", "B", 12)
        self.set_text_color(*BRAND)
        self.cell(self.usable * right, 8, safe(doc_label).upper(), align="R")
        self.ln(8)

        top = self.get_y()
        self.set_font("helvetica", size=8)
        self.set_text_color(*SLATE)
        for line in supplier.lines:
            self.cell(self.usable * split, 4, safe(line)[:chars])
            self.ln(4)
        if supplier.registration:
            self.set_font("helvetica", "B", 8)
            self.cell(self.usable * split, 4, safe(f"{supplier.registration_label}: {supplier.registration}"))
            self.ln(4)
        left_bottom = self.get_y()

        self.set_y(top)
        for label, value in fields:
            self.set_x(MARGIN + self.usable * split)
            self.set_font("helvetica", size=8)
            self.set_text_color(*SLATE)
            self.cell(self.usable * (right - 0.22), 4.5, safe(label), align="R")
            self.set_font("helvetica", "B", 8)
            self.set_text_color(*NAVY)
            self.cell(self.usable * 0.22, 4.5, safe(value), align="R")
            self.ln(4.5)

        self.set_y(max(left_bottom, self.get_y()) + 2)
        self.rule()

    def rule(self, gap: float = 3) -> None:
        self.set_draw_color(*LINE)
        self.set_line_width(0.2)
        self.line(MARGIN, self.get_y(), self.w - MARGIN, self.get_y())
        self.ln(gap)

    def party_block(self, blocks: list[tuple[str, Party]]) -> None:
        width = self.usable / max(len(blocks), 1)
        top = self.get_y()
        deepest = top
        for index, (label, party) in enumerate(blocks):
            self.set_xy(MARGIN + index * width, top)
            self.set_font("helvetica", "B", 7)
            self.set_text_color(*SLATE)
            self.cell(width, 4, safe(label).upper())
            self.ln(4)

            self.set_x(MARGIN + index * width)
            self.set_font("helvetica", "B", 9)
            self.set_text_color(*NAVY)
            self.cell(width, 4.5, safe(party.name)[:45])
            self.ln(4.5)

            self.set_font("helvetica", size=8)
            self.set_text_color(*SLATE)
            for line in party.lines:
                self.set_x(MARGIN + index * width)
                self.cell(width, 4, safe(line)[:55])
                self.ln(4)
            if party.registration:
                self.set_x(MARGIN + index * width)
                self.set_font("helvetica", "B", 8)
                self.set_text_color(*NAVY)
                self.cell(width, 4, safe(f"{party.registration_label}: {party.registration}"))
                self.ln(4)
            deepest = max(deepest, self.get_y())

        self.set_y(deepest + 2)
        self.rule()

    def note_line(self, text: str, *, strong: bool = False) -> None:
        self.set_font("helvetica", "B" if strong else "", 8)
        self.set_text_color(*(NAVY if strong else SLATE))
        self.multi_cell(self.usable, 4.5, safe(text))
        self.ln(1)

    def grid(self, columns: list[Column], rows: list[dict], sub_headers: dict[str, str] | None = None) -> None:
        self.set_font("helvetica", "B", 7.5)
        self.set_text_color(*NAVY)
        self.set_fill_color(241, 245, 249)
        for column in columns:
            self.cell(column.width, 6, safe(column.header), align=column.align, fill=True)
        self.ln(6)
        if sub_headers:
            self.set_font("helvetica", "", 7)
            self.set_text_color(*SLATE)
            for column in columns:
                self.cell(column.width, 4.5, safe(sub_headers.get(column.key, "")), align=column.align, fill=True)
            self.ln(4.5)

        self.set_font("helvetica", size=8)
        self.set_text_color(*NAVY)
        for index, row in enumerate(rows):
            if self.get_y() > self.h - 45:
                self.add_page()
            if index % 2:
                self.set_fill_color(250, 251, 252)
                for column in columns:
                    self.cell(column.width, 5.5, "", fill=True)
                self.ln(5.5)
                self.set_y(self.get_y() - 5.5)
            for column in columns:
                self.cell(column.width, 5.5, safe(row.get(column.key, "")), align=column.align)
            self.ln(5.5)
        self.rule()

    def totals(self, rows: list[tuple[str, str]], *, emphasis: str | None = None) -> None:
        label_width = self.usable * 0.68
        value_width = self.usable * 0.32
        for label, value in rows:
            strong = label == emphasis
            self.set_font("helvetica", "B" if strong else "", 9.5 if strong else 8.5)
            self.set_text_color(*(NAVY if strong else SLATE))
            self.cell(label_width, 5.5, safe(label), align="R")
            self.set_text_color(*NAVY)
            self.cell(value_width, 5.5, safe(value), align="R")
            self.ln(5.5)

    def output_bytes(self) -> bytes:
        return bytes(self.output())
