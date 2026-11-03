from __future__ import annotations

import re

BLOCKED = {
    "en": ["fuck", "fucking", "bitch", "bastard", "cunt", "nigger", "faggot", "retard", "whore", "slut"],
    "hi": ["madarchod", "bhenchod", "behenchod", "chutiya", "randi", "gandu", "harami", "मादरचोद", "भेनचोद", "चूतिया", "रंडी"],
    "mr": ["zavadya", "भडवा", "झवाड्या"],
    "bn": ["khanki", "magi", "খানকি", "মাগি"],
    "ta": ["thevidiya", "otha", "தேவடியா"],
    "te": ["lanja", "dengu", "లంజ"],
}
LINK = re.compile(r"(https?://|www\.)\S+", re.I)
TERMS = [t for terms in BLOCKED.values() for t in terms]


def clean(text: str) -> tuple[bool, str]:
    t = re.sub(r"\s+", " ", (text or "")).strip()
    low = t.lower()
    squashed = re.sub(r"[^a-zऀ-౿]", "", low)
    for term in TERMS:
        if term in low or term in squashed:
            return False, t
    return True, t


def has_link(text: str) -> bool:
    return bool(LINK.search(text or ""))
