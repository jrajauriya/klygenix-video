from __future__ import annotations

from xml.sax.saxutils import escape

import httpx

from app.config import settings
from app.video.media.ffmpeg import FFMPEG, run

VOICES = {"en": "en-IN-NeerjaNeural", "hi": "hi-IN-SwaraNeural", "mr": "mr-IN-AarohiNeural", "bn": "bn-IN-TanishaaNeural",
          "ta": "ta-IN-PallaviNeural", "te": "te-IN-ShrutiNeural",
          "gu": "gu-IN-DhwaniNeural", "kn": "kn-IN-SapnaNeural", "ml": "ml-IN-SobhanaNeural", "pa": "pa-IN-OjasNeural", "or": "or-IN-SubhasiniNeural"}


class TtsError(Exception):
    pass


def provider_name() -> str:
    return "azure" if settings.TTS_PROVIDER == "azure" and settings.AZURE_TTS_KEY else "sandbox"


def voice(lang: str) -> str:
    return VOICES.get(lang, VOICES["en"]) if provider_name() == "azure" else "sandbox-tone"


def speak(text: str, lang: str, out_wav: str) -> None:
    if provider_name() == "sandbox":
        run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=0.35", "-af",
             "afade=t=out:st=0.25:d=0.1,volume=0.4", "-ar", "24000", "-ac", "1", out_wav])
        return
    ssml = (f"<speak version='1.0' xml:lang='{lang}'><voice name='{voice(lang)}'>{escape(text[:1500])}</voice></speak>")
    r = httpx.post(f"https://{settings.AZURE_TTS_REGION}.tts.speech.microsoft.com/cognitiveservices/v1", content=ssml.encode(),
                   headers={"Ocp-Apim-Subscription-Key": settings.AZURE_TTS_KEY, "Content-Type": "application/ssml+xml",
                            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm"}, timeout=60)
    if r.status_code >= 400:
        raise TtsError(f"Azure TTS refused: {r.status_code}")
    with open(out_wav, "wb") as fh:
        fh.write(r.content)
