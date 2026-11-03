from __future__ import annotations

import re
from contextvars import ContextVar
from dataclasses import dataclass, field
from urllib.parse import parse_qs

from fastapi import HTTPException

from app.core.message_catalog import MESSAGES

LANGS = ("en", "hi", "mr", "bn", "ta", "te")


def normalise(code) -> str | None:
    if not code or not isinstance(code, str):
        return None
    primary = code.strip().lower().replace("_", "-").split("-")[0]
    return primary if primary in LANGS else None


def parse_accept(header: str | None) -> list[str]:
    ranked = []
    for i, part in enumerate((header or "").split(",")[:20]):
        bits = part.strip().split(";")
        q = 1.0
        for b in bits[1:]:
            b = b.strip()
            if b.startswith("q="):
                try:
                    q = float(b[2:])
                except ValueError:
                    q = 0.0
        code = normalise(bits[0])
        if code and q > 0:
            ranked.append((-q, i, code))
    return [c for _, _, c in sorted(ranked)]


@dataclass
class Reader:
    query: str | None = None
    accept: list[str] = field(default_factory=list)
    api_key: bool = False
    console: bool = False
    staff: str | None = None
    buyer: str | None = None
    offered: list[str] | None = None
    store_default: str | None = None

    def lang(self) -> str:
        def ok(code):
            return code in LANGS and (self.offered is None or code in self.offered)

        if self.console:
            return "en"
        if ok(self.query):
            return self.query
        if self.staff in LANGS and not self.api_key:
            return self.staff
        if ok(self.buyer):
            return self.buyer
        for code in self.accept:
            if ok(code):
                return code
        if ok(self.store_default):
            return self.store_default
        return "en"


_reader: ContextVar[Reader | None] = ContextVar("kv_reader", default=None)


def reader() -> Reader | None:
    return _reader.get()


def current_lang() -> str:
    r = _reader.get()
    return r.lang() if r else "en"


def reading_as_staff(user) -> None:
    r = _reader.get()
    if r is not None:
        r.staff = normalise((getattr(user, "settings", None) or {}).get("language"))


def reading_as_viewer(user) -> None:
    r = _reader.get()
    if r is not None and user is not None:
        r.buyer = normalise((getattr(user, "settings", None) or {}).get("language"))


def _render(text: str, values: dict) -> str:
    if not values:
        return text
    return re.sub(r"\{(\w+)\}", lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text)


def msg(message_id: str, lang: str | None = None, **values) -> str:
    entry = MESSAGES.get(message_id)
    if entry is None:
        return message_id
    code = lang or current_lang()
    return _render(entry.get(code) or entry["en"], values)


def err(status_code: int, message_id: str, headers: dict | None = None, **values) -> HTTPException:
    return HTTPException(status_code=status_code, detail=msg(message_id, **values), headers=headers)


def _pattern(text: str) -> re.Pattern:
    parts = re.split(r"(\{\w+\})", text)
    out = []
    for p in parts:
        m = re.fullmatch(r"\{(\w+)\}", p)
        out.append(f"(?P<{m.group(1)}>.+?)" if m else re.escape(p))
    return re.compile("^" + "".join(out) + "$", re.S)


_EXACT: dict[str, str] = {}
_TEMPLATES: list[tuple[re.Pattern, str]] = []
for _id, _entry in MESSAGES.items():
    _en = _entry["en"]
    if re.search(r"\{\w+\}", _en):
        _TEMPLATES.append((_pattern(_en), _id))
    else:
        _EXACT.setdefault(_en, _id)
_TEMPLATES.sort(key=lambda t: -len(re.sub(r"\(\?P<\w+>\.\+\?\)", "", t[0].pattern)))


def localise(text) -> str:
    if not isinstance(text, str) or current_lang() == "en":
        return text
    hit = _EXACT.get(text)
    if hit:
        return msg(hit)
    for pattern, message_id in _TEMPLATES:
        m = pattern.match(text)
        if m:
            return msg(message_id, **m.groupdict())
    sentences = re.split(r"(?<=[.!?])\s+", text)
    if len(sentences) > 1:
        return " ".join(localise(s) for s in sentences)
    return text


def refused(status_code: int, text, headers: dict | None = None) -> HTTPException:
    return HTTPException(status_code=status_code, detail=localise(text), headers=headers)


class ReaderMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        query = parse_qs((scope.get("query_string") or b"").decode("latin-1")).get("lang", [None])[0]
        token = _reader.set(Reader(query=normalise(query), accept=parse_accept(headers.get("accept-language")),
                                   api_key=bool(headers.get("x-api-key")),
                                   console=headers.get("x-klygenix-app") == "admin"))
        try:
            await self.app(scope, receive, send)
        finally:
            _reader.reset(token)
