from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from app.core.messages import err

SUPPORTED = ("en", "hi", "mr", "bn", "ta", "te")
DEFAULT = "en"
NAMES = {"en": "English", "hi": "हिन्दी", "mr": "मराठी", "bn": "বাংলা", "ta": "தமிழ்", "te": "తెలుగు"}
ENGLISH_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu"}
LOCALES = {"en": "en-IN", "hi": "hi-IN", "mr": "mr-IN", "bn": "bn-IN", "ta": "ta-IN", "te": "te-IN"}
SCRIPTS = {"en": "Latin", "hi": "Devanagari", "mr": "Devanagari", "bn": "Bengali", "ta": "Tamil", "te": "Telugu"}
MONTHS = {
    "hi": ("जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"),
    "mr": ("जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"),
    "bn": ("জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"),
    "ta": ("ஜனவரி", "பிப்ரவரி", "மார்ச்", "ஏப்ரல்", "மே", "ஜூன்", "ஜூலை", "ஆகஸ்ட்", "செப்டம்பர்", "அக்டோபர்", "நவம்பர்", "டிசம்பர்"),
    "te": ("జనవరి", "ఫిబ్రవరి", "మార్చి", "ఏప్రిల్", "మే", "జూన్", "జులై", "ఆగస్టు", "సెప్టెంబర్", "అక్టోబర్", "నవంబర్", "డిసెంబర్"),
}
FIELDS = ("title", "subtitle", "description")
LIMITS = {"title": 200, "subtitle": 300, "description": 50000}


def normalise(code) -> str | None:
    if not code or not isinstance(code, str):
        return None
    primary = code.strip().lower().replace("_", "-").split("-")[0]
    return primary if primary in SUPPORTED else None


def offered(store) -> list[str]:
    langs = [l for l in ((store.languages if store is not None else None) or []) if l in SUPPORTED]
    return [DEFAULT] + [l for l in langs if l != DEFAULT]


def store_default(store) -> str:
    lang = normalise(store.language if store is not None else None)
    return lang if lang and lang in offered(store) else DEFAULT


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


def pick(store, lang: str | None = None, accept_language: str | None = None) -> str:
    langs = offered(store)
    wanted = normalise(lang)
    if wanted and wanted in langs:
        return wanted
    if not lang and len(langs) > 1:
        for code in parse_accept(accept_language):
            if code in langs:
                return code
    return store_default(store)


def clean_languages(language: str | None, languages: list | None, store) -> tuple[str, list[str]]:
    langs = list(store.languages or [DEFAULT]) if languages is None else languages
    if not isinstance(langs, list) or any(not isinstance(l, str) for l in langs):
        raise err(400, "languages_list_language_codes")
    out: list[str] = []
    for l in langs:
        code = l.strip().lower()
        if code not in SUPPORTED:
            raise err(400, "language_not_offered", language=l, choices=", ".join(SUPPORTED))
        if code not in out:
            out.append(code)
    if DEFAULT not in out:
        out.insert(0, DEFAULT)
    default = (store.language or DEFAULT) if language is None else (language or "").strip().lower()
    if default not in SUPPORTED:
        raise err(400, "language_not_offered", language=language, choices=", ".join(SUPPORTED))
    if default not in out:
        if language is None:
            default = DEFAULT
        else:
            raise err(400, "default_language_must_one_languages_store")
    return default, out


def clean_translations(value) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise err(400, "translations_language_title_subtitle_description")
    out: dict = {}
    for lang, fields in value.items():
        if lang not in SUPPORTED or lang == DEFAULT:
            raise err(400, "translations_for", languages=", ".join(l for l in SUPPORTED if l != DEFAULT))
        if fields is None:
            continue
        if not isinstance(fields, dict):
            raise err(400, "translation_title_subtitle_description")
        row = {}
        for f in FIELDS:
            v = fields.get(f)
            if v is None:
                continue
            if not isinstance(v, str):
                raise err(400, "translated_must_text", f=f)
            v = v.strip()
            if len(v) > LIMITS[f]:
                raise err(400, "translated_too_long", f=f, most=LIMITS[f])
            if v:
                row[f] = v
        if row:
            out[lang] = row
    return out


def translations(product) -> dict:
    raw = (product.settings or {}).get("i18n") if product is not None else None
    if not isinstance(raw, dict):
        return {}
    return {l: v for l, v in raw.items() if l in SUPPORTED and l != DEFAULT and isinstance(v, dict) and v.get("title")}


def languages_of(product) -> list[str]:
    return [DEFAULT] + list(translations(product).keys())


def translations_out(product, fields=FIELDS) -> dict:
    return {l: {f: v[f] for f in fields if v.get(f)} for l, v in translations(product).items()}


def text_of(product, lang: str | None) -> dict:
    base = {f: getattr(product, f) for f in FIELDS}
    tr = translations(product).get(lang or DEFAULT) if lang and lang != DEFAULT else None
    if not tr:
        return {**base, "lang": DEFAULT}
    return {**{f: tr.get(f) or base[f] for f in FIELDS}, "lang": lang}


def title_of(product, lang: str | None) -> str:
    return text_of(product, lang)["title"]


def buyer_language(buyer) -> str | None:
    return normalise(getattr(buyer, "language", None)) if buyer is not None else None


def catalogue() -> list[dict]:
    return [{"code": c, "name": NAMES[c], "english_name": ENGLISH_NAMES[c], "locale": LOCALES[c],
             "script": SCRIPTS[c], "dir": "ltr"} for c in SUPPORTED]


def og_locale(lang: str | None) -> str:
    return LOCALES.get(lang or DEFAULT, LOCALES[DEFAULT]).replace("-", "_")


def date_text(value, lang: str | None = None, time: bool = False, english: str = "%d %b %Y") -> str:
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    months = MONTHS.get(lang or DEFAULT)
    out = f"{value.day} {months[value.month - 1]} {value.year}" if months else value.strftime(english)
    return out + value.strftime(", %H:%M UTC") if time else out
