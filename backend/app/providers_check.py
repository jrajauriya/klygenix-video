from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

from app.config import Settings, settings

SECRET = {"BUNNY_API_KEY", "BUNNY_TOKEN_KEY", "BUNNY_WEBHOOK_SECRET", "CF_STREAM_TOKEN", "CF_STREAM_SIGNING_KEY",
          "CF_STREAM_WEBHOOK_SECRET", "CF_NOTIFY_SECRET", "LLM_API_KEY", "AZURE_SPEECH_KEY", "OPENAI_TRANSCRIBE_KEY",
          "AZURE_TTS_KEY", "EXPO_ACCESS_TOKEN", "GOOGLE_CLIENT_SECRET", "INSTAGRAM_APP_SECRET", "RAZORPAY_KEY_SECRET",
          "RAZORPAY_WEBHOOK_SECRET", "LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_WEBHOOK_SECRET", "SCAN_API_KEY",
          "MS_GRAPH_CLIENT_SECRET", "SMTP_PASSWORD", "S3_SECRET_KEY"}


@dataclass
class Provider:
    key: str
    title: str
    active: bool
    needs: list[str]
    webhooks: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    unsealed: list[str] = field(default_factory=list)
    live: str = ""


def _real(value: str | None) -> bool:
    return (value or "sandbox") != "sandbox"


def providers(s: Settings) -> list[Provider]:
    api = f"https://{s.public_host('api')}/api/video/webhooks"
    return [
        Provider("bunny", "Bunny Stream (upload, encode, playback)", s.VIDEO_PROVIDER == "bunny",
                 ["BUNNY_LIBRARY_ID", "BUNNY_API_KEY", "BUNNY_CDN_HOST", "BUNNY_TOKEN_KEY", "BUNNY_WEBHOOK_SECRET"],
                 [f"{api}/media/bunny?secret=<BUNNY_WEBHOOK_SECRET>"]),
        Provider("cloudflare", "Cloudflare Stream Live", s.LIVE_PROVIDER == "cloudflare",
                 ["CF_ACCOUNT_ID", "CF_STREAM_TOKEN", "CF_STREAM_CUSTOMER_HOST", "CF_STREAM_SIGNING_KEY_ID",
                  "CF_STREAM_SIGNING_KEY", "CF_STREAM_WEBHOOK_SECRET", "CF_NOTIFY_SECRET"],
                 [f"{api}/cloudflare-live  (Stream webhook: recording ready)",
                  f"{api}/cloudflare-live  (Notifications → Stream Live Input, header cf-webhook-auth)"]),
        Provider("llm", "Azure OpenAI (Responses, embeddings)", _real(s.LLM_PROVIDER),
                 ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "EMBED_URL"]),
        Provider("stt", "Speech to text", _real(s.STT_PROVIDER),
                 ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"] if s.STT_PROVIDER == "azure_speech"
                 else ["OPENAI_TRANSCRIBE_URL", "OPENAI_TRANSCRIBE_KEY"]),
        Provider("tts", "Azure text to speech (dubbing)", s.TTS_PROVIDER == "azure", ["AZURE_TTS_KEY", "AZURE_TTS_REGION"]),
        Provider("push", "Expo push", s.PUSH_PROVIDER == "expo", ["EXPO_ACCESS_TOKEN"]),
        Provider("youtube", "YouTube connect and Shorts upload", _real(s.YOUTUBE_PROVIDER),
                 ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_OAUTH_REDIRECT"]),
        Provider("instagram", "Instagram connect and Reels", _real(s.INSTAGRAM_PROVIDER),
                 ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"]),
        Provider("razorpay", "Razorpay (payments) and Route (creator payouts)", bool(s.RAZORPAY_KEY_ID),
                 ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "ROUTE_PROFILE_CATEGORY",
                  "ROUTE_PROFILE_SUBCATEGORY"], [f"{api}/payments/razorpay"]),
        Provider("lemonsqueezy", "Lemon Squeezy (merchant of record abroad)", bool(s.LEMONSQUEEZY_API_KEY or s.LEMONSQUEEZY_STORE_ID),
                 ["LEMONSQUEEZY_STORE_ID", "LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_WEBHOOK_SECRET", "LEMONSQUEEZY_VARIANT_ID"],
                 [f"{api}/payments/lemonsqueezy"]),
        Provider("scan", "Azure AI Content Safety" if s.SCAN_PROVIDER == "azure_content_safety" else "Safety scan vendor",
                 _real(s.SCAN_PROVIDER), ["SCAN_API_URL", "SCAN_API_KEY"]),
        Provider("mail", "Mail (Microsoft Graph)", bool(s.MS_GRAPH_CLIENT_ID),
                 ["MS_GRAPH_TENANT_ID", "MS_GRAPH_CLIENT_ID", "MS_GRAPH_CLIENT_SECRET", "MS_GRAPH_SENDER"]),
    ]


def inspect(s: Settings, raw: dict) -> list[Provider]:
    out = providers(s)
    for p in out:
        p.missing = [k for k in p.needs if not str(getattr(s, k, "") or "").strip()]
        p.unsealed = [k for k in p.needs if k in SECRET and raw.get(k) and not str(raw[k]).startswith("enc:")]
    return out


def probe(p: Provider) -> str:
    import httpx

    try:
        if p.key == "bunny":
            from app.video.media.providers.bunny import BunnyProvider

            BunnyProvider()._api("GET", "/videos", params={"page": 1, "itemsPerPage": 1})
        elif p.key == "cloudflare":
            from app.video.live import cloudflare

            cloudflare._call("GET", "/live_inputs")
            cloudflare.token("probe", 60)
        elif p.key == "razorpay":
            r = httpx.get(f"{settings.RAZORPAY_API_BASE}/orders", params={"count": 1},
                          auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET), timeout=15)
            if r.status_code >= 400:
                return f"refused {r.status_code}"
        elif p.key == "llm":
            from app.ai import llm

            llm._call([{"role": "user", "content": [{"type": "input_text", "text": "Reply with OK."}]}],
                      model=settings.LLM_MODEL, max_tokens=16)
        elif p.key == "scan" and settings.SCAN_PROVIDER == "azure_content_safety":
            from app.video.trust import scan

            scan.probe_content_safety()
        elif p.key == "mail":
            from app.core.services import graph_mail

            with graph_mail._http() as c:
                graph_mail._access_token(c, fresh=True)
        else:
            return "no read-only probe; verify by hand (docs/GO-LIVE.md)"
    except Exception as exc:
        return f"FAILED: {type(exc).__name__}: {str(exc)[:160]}"
    return "ok"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Which providers are real, what is missing, and (with --live) one read call each.")
    ap.add_argument("--env-file", help="check this env file instead of the running settings")
    ap.add_argument("--live", action="store_true", help="make one harmless read call per configured provider")
    args = ap.parse_args(argv)
    if args.env_file:
        from app.core.services.readiness import env_file_settings

        s, raw = env_file_settings(args.env_file)
        if args.live:
            for k in type(s).model_fields:
                setattr(settings, k, getattr(s, k))
    else:
        from app.core.services.readiness import _raw_env

        s, raw = settings, _raw_env(None)
    bad = 0
    for p in inspect(s, raw):
        state = "REAL" if p.active else "sandbox"
        print(f"{p.title:52} {state}")
        if p.active and p.missing:
            bad += 1
            print(f"    missing: {', '.join(p.missing)}")
        if p.active and p.unsealed:
            bad += 1
            print(f"    not sealed (use scripts/manage_secrets.py): {', '.join(p.unsealed)}")
        if p.active:
            for w in p.webhooks:
                print(f"    webhook: {w}")
            if args.live and not [m for m in p.missing if not m.startswith("ROUTE_PROFILE_")]:
                p.live = probe(p)
                bad += p.live.startswith("FAILED")
                print(f"    live probe: {p.live}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
