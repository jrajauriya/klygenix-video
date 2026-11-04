from __future__ import annotations

import ipaddress
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings

BOT = re.compile(r"bot|crawl|spider|slurp|headless|phantom|python-requests|python-httpx|curl/|wget/|okhttp|go-http-client|"
                 r"java/|libwww|scrapy|puppeteer|playwright|selenium|lighthouse|pingdom|uptime|monitor", re.I)
CATEGORIES = ("news", "violence", "adult", "politics", "religion", "kids", "gaming", "education", "food", "tech", "music",
              "finance", "health", "sports", "travel", "beauty")
WORDS = {
    "news": ("news", "breaking", "headlines", "समाचार", "khabar"),
    "violence": ("violence", "weapon", "gun", "fight", "war", "blood", "attack", "graphic"),
    "adult": ("sexual", "dating", "alcohol", "liquor", "nsfw", "romance", "drinks", "bar"),
    "politics": ("politics", "election", "government", "minister", "parliament", "party", "vote", "चुनाव"),
    "religion": ("religion", "temple", "god", "prayer", "mandir", "masjid", "church", "bhajan", "puja", "धर्म"),
    "kids": ("kids", "children", "cartoon", "nursery", "rhymes", "toddler", "बच्चे"),
    "gaming": ("game", "gaming", "gameplay", "esports", "minecraft", "bgmi", "free fire"),
    "education": ("tutorial", "learn", "lesson", "course", "education", "how to", "explained", "exam", "class"),
    "food": ("recipe", "cooking", "chai", "dal", "food", "kitchen", "tadka", "biryani", "खाना"),
    "tech": ("azure", "api", "code", "programming", "software", "tech", "git", "cloud", "developer", "ai"),
    "music": ("music", "song", "singing", "guitar", "concert", "गाना"),
    "finance": ("finance", "stock", "invest", "mutual fund", "crypto", "trading", "money"),
    "health": ("health", "fitness", "yoga", "workout", "diet", "medical", "doctor"),
    "sports": ("cricket", "football", "sports", "match", "ipl", "kabaddi"),
    "travel": ("travel", "trip", "vlog", "tour", "journey", "yatra"),
    "beauty": ("beauty", "makeup", "skincare", "fashion", "hair"),
}
SCAN_MAP = {"violence": "violence", "sexual": "adult", "hate": "violence", "self_harm": "violence", "weapons": "violence",
            "drugs": "adult", "test_review": "violence"}


def is_bot(user_agent: str | None) -> bool:
    ua = (user_agent or "").strip()
    return not ua or bool(BOT.search(ua))


def _networks() -> list:
    out = []
    for part in (settings.ADS_IVT_CIDRS or "").split(","):
        part = part.strip()
        if part:
            try:
                out.append(ipaddress.ip_network(part, strict=False))
            except ValueError:
                continue
    return out


def datacentre(ip: str | None) -> bool:
    try:
        addr = ipaddress.ip_address(ip or "")
    except ValueError:
        return False
    return any(addr in n for n in _networks())


def categories(db: Session, video) -> list[str]:
    from app.video.models.ai import Insight
    from app.video.models.trust import ScanResult

    text = " ".join([video.title or "", video.description or "", " ".join(video.tags or [])]).lower()
    ins = db.execute(select(Insight).where(Insight.video_id == video.id).order_by(Insight.id.desc())).scalars().first()
    if ins is not None:
        text += " " + " ".join(str(t) for t in (ins.tags or [])).lower() + " " + (ins.summary or "").lower()[:2000]
    found = {c for c, words in WORDS.items() if any(re.search(r"(?<!\w)" + re.escape(w) + r"(?!\w)", text) for w in words)}
    scan = db.execute(select(ScanResult).where(ScanResult.video_id == video.id).order_by(ScanResult.id.desc())).scalars().first()
    for label in (scan.labels or []) if scan is not None else []:
        if label in SCAN_MAP:
            found.add(SCAN_MAP[label])
    if getattr(video, "made_for_kids", False):
        found.add("kids")
    return sorted(found)


def labels_for(db: Session, video) -> list[str]:
    if video.safety_labels is None:
        video.safety_labels = categories(db, video)
        db.flush()
    return list(video.safety_labels or [])
