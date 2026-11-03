from __future__ import annotations

import os
import tempfile

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.video.media.ffmpeg import FFMPEG, run
from app.video.models.studio import MusicTrack
from app.video.storage import backend

LIBRARY = [
    ("Morning Chai", "Klygenix Sound", "calm", "sin(2*PI*220*t)*0.25+sin(2*PI*330*t)*0.15"),
    ("Upbeat Steps", "Klygenix Sound", "upbeat", "sin(2*PI*440*t)*0.2*(0.6+0.4*sin(2*PI*2*t))"),
    ("Focus Loop", "Klygenix Sound", "focus", "sin(2*PI*196*t)*0.2+sin(2*PI*294*t)*0.1"),
    ("Bright Reel", "Klygenix Sound", "bright", "sin(2*PI*523*t)*0.18*(0.5+0.5*sin(2*PI*4*t))"),
]
LICENCE = "Klygenix Play library licence — royalty-free for use on and off Klygenix Play"


def ensure_library(db: Session) -> int:
    if db.execute(select(MusicTrack.id).limit(1)).first():
        return 0
    made = 0
    with tempfile.TemporaryDirectory() as work:
        for title, artist, mood, expr in LIBRARY:
            out = os.path.join(work, f"{mood}.m4a")
            run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", f"aevalsrc={expr}:s=44100:d=60", "-ac", "2",
                 "-c:a", "aac", "-b:a", "96k", out])
            key = f"music/{mood}.m4a"
            with open(out, "rb") as fh:
                backend().put(key, fh.read(), "audio/mp4")
            db.add(MusicTrack(title=title, artist=artist, mood=mood, duration_ms=60_000, licence=LICENCE,
                              storage_key=key))
            made += 1
    db.flush()
    return made


def track_out(t: MusicTrack) -> dict:
    return {"id": t.id, "title": t.title, "artist": t.artist, "mood": t.mood, "duration_ms": t.duration_ms,
            "licence": t.licence, "licence_url": t.licence_url}
