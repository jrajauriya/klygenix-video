from __future__ import annotations

import ipaddress
import os
import stat
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from app.config import Settings
from app.core.services import secrets

BLOCK = "block"
WARN = "warn"

BACKEND_ROOT = Path(__file__).resolve().parents[3]
DEV_SECRET_KEY = "dev-secret-key-change-in-production"
DEV_ADMIN_PASSWORD = "admin123"
DEV_DB_PORTS = {25432, 25433, 25436}
DEV_REDIS_PORTS = {16379, 16380, 16383}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0", ""}  # nosec B104
PLACEHOLDERS = ("change_me", "changeme", "replace_me", "your_", "xxxx", "<", "todo")
SEALED_FIELDS = (
    "SMTP_PASSWORD", "S3_SECRET_KEY", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "LEMONSQUEEZY_API_KEY",
    "LEMONSQUEEZY_WEBHOOK_SECRET", "BUNNY_API_KEY", "BUNNY_TOKEN_KEY", "BUNNY_WEBHOOK_SECRET", "AZURE_SPEECH_KEY",
    "OPENAI_TRANSCRIBE_KEY", "LLM_API_KEY", "SCAN_API_KEY", "GOOGLE_CLIENT_SECRET",
)
BACKUP_DIR_DEFAULT = "/opt/klygenix-video/backups"


@dataclass
class Check:
    key: str
    title: str
    group: str
    severity: str
    ok: bool
    detail: str
    fix: str

    def as_dict(self) -> dict:
        return asdict(self)


def _placeholder(value: str | None) -> bool:
    v = (value or "").strip().lower()
    return any(p in v for p in PLACEHOLDERS)


def _local_host(host: str | None) -> bool:
    h = (host or "").strip("[]").lower()
    if h in LOCAL_HOSTS or h.endswith(".localhost") or h.endswith(".local"):
        return True
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


def _public_https(url: str) -> tuple[bool, str]:
    u = urlparse((url or "").strip())
    if not url:
        return False, "not set"
    if u.scheme != "https":
        return False, f"{url} is not https"
    if _local_host(u.hostname):
        return False, f"{url} points at this machine"
    return True, url


def _origin(url: str) -> str:
    u = urlparse((url or "").strip())
    return f"{u.scheme}://{u.netloc}" if u.scheme and u.netloc else ""


def _raw_env(env: dict | None) -> dict:
    if env is not None:
        return dict(env)
    from dotenv import dotenv_values

    raw = {k: v for k, v in dotenv_values(BACKEND_ROOT / ".env").items() if v is not None}
    raw.update(os.environ)
    return raw


def _key_file(raw: dict) -> Path:
    override = raw.get("KLYGENIX_VIDEO_KEY_FILE") or os.environ.get("KLYGENIX_VIDEO_KEY_FILE")
    return Path(override).expanduser() if override else secrets.DEFAULT_KEY_FILE


def _db_url_check(key: str, title: str, url: str, *, app_role: bool, owner_url: str) -> Check:
    from sqlalchemy.engine import make_url

    fix_owner = "Point DATABASE_URL at the production database as the owner role klygenix_video, e.g. postgresql://klygenix_video:<password>@postgres:5432/klygenix_video."
    fix_app = "Set APP_DATABASE_URL to the restricted role, e.g. postgresql://klygenix_video_app:<password>@postgres:5432/klygenix_video, so RLS and the ledger grants apply."
    fix = fix_app if app_role else fix_owner
    if not url:
        return Check(key, title, "Infrastructure", BLOCK, False,
                     "Not set — the API would connect as the owner role, which RLS does not restrict." if app_role else "Not set.", fix)
    try:
        u = make_url(url)
    except Exception:
        return Check(key, title, "Infrastructure", BLOCK, False, "Not a valid database URL.", fix)
    problems = []
    if _local_host(u.host) and (u.port or 5432) in DEV_DB_PORTS:
        problems.append(f"points at the development database on {u.host}:{u.port}")
    if not u.password or u.password == u.username or _placeholder(u.password):
        problems.append("uses a development or placeholder password")
    if app_role:
        if u.username != "klygenix_video_app":
            problems.append(f"connects as {u.username!r}, not the app role klygenix_video_app")
        try:
            o = make_url(owner_url)
            if (o.host, o.port, o.database) != (u.host, u.port, u.database):
                problems.append("is a different database from DATABASE_URL")
        except Exception:
            pass
    elif u.username == "klygenix_video_app":
        problems.append("uses the app role; migrations need the owner role klygenix_video")
    where = f"{u.username}@{u.host}:{u.port or 5432}/{u.database}"
    if problems:
        return Check(key, title, "Infrastructure", BLOCK, False, f"{where} — " + "; ".join(problems) + ".", fix)
    return Check(key, title, "Infrastructure", BLOCK, True, where, fix)


def evaluate(s: Settings, *, mode: str = "app", env: dict | None = None) -> list[Check]:
    raw = _raw_env(env)
    cli = mode == "cli"
    out: list[Check] = []
    add = out.append

    add(Check("sandbox.disabled", "Sandbox is switched off", "Mode", BLOCK, not s.SANDBOX_ENABLED,
              "SANDBOX_ENABLED is false." if not s.SANDBOX_ENABLED else
              "SANDBOX_ENABLED is true: sandbox payment and media routes exist, loopback skips rate limits and /metrics is open.",
              "Set SANDBOX_ENABLED=false in backend/.env.prod."))

    rail = (s.PAYMENT_RAIL or "").strip().lower()
    rail_ok = rail in ("auto", "razorpay")
    add(Check("payment.rail", "Payments go to a real gateway", "Mode", BLOCK, rail_ok,
              f"PAYMENT_RAIL is {rail!r}." + (" With a Razorpay key id set, auto means Razorpay." if rail == "auto" else ""),
              "Set PAYMENT_RAIL=razorpay (or auto with the Razorpay keys below)."))

    jobs = (s.JOBS_MODE or "").strip().lower()
    add(Check("jobs.mode", "Background jobs run on the workers", "Mode", BLOCK, jobs == "rq",
              f"JOBS_MODE is {jobs!r}." + ("" if jobs == "rq" else
              " Inline runs jobs on a thread inside the API and sweeps in-process. docker-compose.prod.yml forces rq on its services, but anything started outside compose reads the env file."),
              "Set JOBS_MODE=rq in backend/.env.prod so every process agrees with the compose file."))

    add(Check("log.level", "Logging is not at debug", "Mode", WARN, (s.LOG_LEVEL or "").upper() != "DEBUG",
              f"LOG_LEVEL is {s.LOG_LEVEL}.", "Set LOG_LEVEL=INFO; debug logs can carry request bodies."))

    sk = s.SECRET_KEY or ""
    sk_problem = ("is the development default" if sk == DEV_SECRET_KEY else
                  "is a placeholder" if _placeholder(sk) else
                  f"is only {len(sk)} characters" if len(sk) < 32 else "")
    add(Check("secret.key", "Token signing key is strong", "Secrets", BLOCK, not sk_problem,
              f"SECRET_KEY {sk_problem}; anyone who knows it can mint staff, buyer and affiliate tokens." if sk_problem
              else f"SECRET_KEY is set ({len(sk)} characters).",
              "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\" and set SECRET_KEY. Rotating it signs everyone out."))

    kf = _key_file(raw)
    key_ok, key_detail = False, f"No master key at {kf}."
    if kf.is_file():
        try:
            from cryptography.fernet import Fernet

            Fernet(kf.read_bytes().strip())
            key_ok, key_detail = True, f"Master key at {kf}."
        except PermissionError:
            key_detail = (f"{kf} exists but this process (uid {os.getuid()}) cannot read it; the containers run as "
                          "uid 10001, so the key must be owned by 10001 with mode 0400 (deploy.sh does this).")
        except Exception:
            key_detail = f"{kf} exists but is not a valid Fernet key."
    add(Check("sealed.key", "Master key for sealed secrets", "Secrets", BLOCK, key_ok,
              key_detail + " It seals gateway secrets, SMTP passwords and 2FA seeds in the database.",
              "On the server: python3 scripts/manage_secrets.py init (creates backend/.secret.key, mode 600), then back it up offline — without it sealed values cannot be read. See infra/ROTATION.md."))
    if kf.is_file():
        loose = bool(kf.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO))
        add(Check("sealed.key_mode", "Master key is readable only by its owner", "Secrets", WARN, not loose,
                  f"{kf} mode is {oct(kf.stat().st_mode & 0o777)}.", f"chown 10001:10001 {kf} && chmod 400 {kf} (the container user)"))

    bad_sealed = []
    for name in SEALED_FIELDS:
        value = str(raw.get(name) or "")
        if secrets.is_encrypted(value) and not getattr(s, name):
            bad_sealed.append(name)
    add(Check("sealed.values", "Sealed settings can be unsealed", "Secrets", BLOCK, not bad_sealed,
              ("Could not unseal " + ", ".join(bad_sealed) + ". " + (secrets.last_error() or "")) if bad_sealed
              else "Every enc: value in the environment unseals with the master key (or none are sealed).",
              "Re-seal the values with the current key: python3 scripts/manage_secrets.py encrypt, or restore the matching backend/.secret.key."))

    pw = s.GLOBAL_ADMIN_PASSWORD or ""
    pw_problem = ("is the development default" if pw == DEV_ADMIN_PASSWORD else
                  "is a placeholder" if _placeholder(pw) else
                  f"is only {len(pw)} characters" if len(pw) < 12 else "")
    add(Check("admin.seed_password", "First global admin password is not a default", "Secrets", BLOCK, not pw_problem,
              f"GLOBAL_ADMIN_PASSWORD {pw_problem}. It is used once, when the global admin is first created." if pw_problem
              else "GLOBAL_ADMIN_PASSWORD is set.",
              "Set a strong GLOBAL_ADMIN_PASSWORD before the first boot, then change it again from the admin console and turn on two-step sign-in."))

    mt = s.METRICS_TOKEN or ""
    add(Check("metrics.token", "Metrics endpoint is protected", "Secrets", BLOCK, len(mt) >= 24 and not _placeholder(mt),
              "METRICS_TOKEN is not set: /metrics is disabled in production and nothing can scrape it." if not mt else
              f"METRICS_TOKEN is set ({len(mt)} characters)." if len(mt) >= 24 and not _placeholder(mt) else
              "METRICS_TOKEN is too short or a placeholder.",
              "Set METRICS_TOKEN to a random 32+ character value and give the same token to the Prometheus scrape job (infra/METRICS.md)."))

    add(_db_url_check("db.owner_url", "Owner database connection", s.DATABASE_URL, app_role=False, owner_url=s.DATABASE_URL))
    add(_db_url_check("db.app_url", "Application database connection uses the app role", s.APP_DATABASE_URL, app_role=True,
                      owner_url=s.DATABASE_URL))

    ru = urlparse(s.REDIS_URL or "")
    redis_problems = []
    if not s.REDIS_URL:
        redis_problems.append("not set")
    else:
        if _local_host(ru.hostname) and (ru.port or 6379) in DEV_REDIS_PORTS:
            redis_problems.append(f"points at the development Redis on {ru.hostname}:{ru.port}")
        if not ru.password or _placeholder(ru.password):
            redis_problems.append("has no password (production Redis runs with --requirepass)")
    add(Check("redis.url", "Redis connection", "Infrastructure", BLOCK, not redis_problems,
              ("REDIS_URL " + "; ".join(redis_problems) + ".") if redis_problems else f"{ru.hostname}:{ru.port or 6379}",
              "Set REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379/0 with the same password as the compose redis service."))

    s3_missing = [n for n in ("S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY") if not getattr(s, n)]
    add(Check("storage.s3", "Files live in a private bucket", "Infrastructure", BLOCK, not s3_missing,
              ("Local disk (backend/private_uploads) is in use." if "S3_BUCKET" in s3_missing else "") +
              (f" Missing: {', '.join(s3_missing)}." if s3_missing else f"Bucket {s.S3_BUCKET!r} via {s.S3_ENDPOINT or 'AWS S3'}."),
              "Create a private bucket (R2 or S3 ap-south-1, versioned), an access key limited to it, and set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION."))
    if s.S3_BUCKET:
        region_ok = bool(s.S3_ENDPOINT) or (s.S3_REGION or "auto") != "auto"
        add(Check("storage.region", "Bucket endpoint or region is explicit", "Infrastructure", WARN, region_ok,
                  f"S3_ENDPOINT={s.S3_ENDPOINT or '(empty)'}, S3_REGION={s.S3_REGION}.",
                  "For Cloudflare R2 set S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com and S3_REGION=auto; for AWS leave the endpoint empty and set S3_REGION=ap-south-1."))
    add(Check("storage.ttl", "Download links are short-lived", "Infrastructure", WARN, 0 < s.DOWNLOAD_URL_TTL_SECONDS <= 900,
              f"DOWNLOAD_URL_TTL_SECONDS is {s.DOWNLOAD_URL_TTL_SECONDS} (rule S05: minutes, not hours).",
              "Set DOWNLOAD_URL_TTL_SECONDS=300."))

    idx = Path(s.WEB_INDEX_PATH or "")
    if not idx.is_absolute():
        idx = (Path.cwd() / idx).resolve()
    idx_exists = idx.is_file()
    remote = cli and not idx_exists and str(s.WEB_INDEX_PATH or "").startswith("/app/")
    add(Check("web.index", "Viewer web shell for share previews", "Infrastructure", WARN, idx_exists,
              f"{idx} exists." if idx_exists else
              f"{s.WEB_INDEX_PATH} is a path inside the backend container and cannot be checked from here." if remote else
              f"{idx} does not exist: share previews fall back to the generic page head.",
              "Build the web app (npm run build --workspace=apps/web); docker-compose.prod.yml mounts apps/web/dist/index.html at /app/web/index.html."))

    bdir = Path(raw.get("KV_BACKUP_DIR") or os.environ.get("KV_BACKUP_DIR") or BACKUP_DIR_DEFAULT) / "base"
    recent = False
    if bdir.is_dir():
        cutoff = time.time() - 2 * 86400
        recent = any(p.stat().st_mtime >= cutoff for p in bdir.iterdir())
    add(Check("backups", "Backups are running", "Infrastructure", WARN, recent,
              f"A base backup under {bdir} is less than two days old." if recent else
              f"No base backup under {bdir} from the last two days (this check can only see the machine it runs on).",
              "Install the cron entries for infra/basebackup.sh (02:30) and infra/backup.sh (03:00), run one of each by hand, and rehearse a restore with infra/pitr-rehearse.sh — see infra/BACKUPS.md."))

    urls = (
        ("url.admin", "Admin console URL", "APP_LOGIN_URL", s.APP_LOGIN_URL, f"https://{s.public_host('admin')}/login"),
        ("url.studio", "Studio URL", "STUDIO_APP_URL", s.STUDIO_APP_URL, f"https://{s.public_host('studio')}"),
        ("url.web", "Viewer web URL", "WEB_BASE_URL", s.WEB_BASE_URL, f"https://{s.PUBLIC_DOMAIN}"),
        ("url.api", "Public API URL", "API_PUBLIC_BASE_URL", s.API_PUBLIC_BASE_URL, f"https://{s.public_host('api')}"),
    )
    for key, title, name, value, example in urls:
        good, why = _public_https(value)
        add(Check(key, title, "Public URLs", BLOCK, good, f"{name}: {why}.", f"Set {name}={example}."))
    web_host = urlparse(s.WEB_BASE_URL or "").hostname or ""
    add(Check("url.domain", "Public domain matches the web URL", "Public URLs", WARN, web_host == s.PUBLIC_DOMAIN,
              f"PUBLIC_DOMAIN is {s.PUBLIC_DOMAIN}; WEB_BASE_URL host is {web_host or '(none)'}.",
              "Set PUBLIC_DOMAIN to the host the viewer app is served on (play.klygenix.com)."))

    origins = s.cors_origins
    bad_origins = [o for o in origins if o == "*" or not _public_https(o)[0]]
    add(Check("cors.origins", "CORS allows only public https origins", "Public URLs", BLOCK, bool(origins) and not bad_origins,
              ("CORS_ORIGINS is empty." if not origins else
               f"Not allowed in production: {', '.join(bad_origins)}." if bad_origins else ", ".join(origins)),
              f"Set CORS_ORIGINS=https://{s.public_host('admin')},https://{s.public_host('studio')},https://{s.PUBLIC_DOMAIN}"))
    needed = [o for o in (_origin(s.APP_LOGIN_URL), _origin(s.STUDIO_APP_URL), _origin(s.WEB_BASE_URL)) if o]
    missing = [o for o in needed if o not in origins]
    add(Check("cors.apps", "CORS covers the admin console, studio and web app", "Public URLs", BLOCK, not missing,
              ("Missing: " + ", ".join(missing) + ". The apps call the API cross-origin.")
              if missing else "Admin, studio and web origins are allowed.",
              "Add the admin, studio and web origins to CORS_ORIGINS."))

    add(Check("ratelimit.enabled", "Rate limits are on", "Abuse", BLOCK, bool(s.RATE_LIMITS_ENABLED),
              f"RATE_LIMITS_ENABLED is {str(s.RATE_LIMITS_ENABLED).lower()}.",
              "Set RATE_LIMITS_ENABLED=true."))
    exempt = [x.strip() for x in (s.RATE_LIMIT_EXEMPT_IPS or "").split(",") if x.strip()]
    non_loop = [x for x in exempt if not _local_host(x)]
    add(Check("ratelimit.exempt", "Rate-limit exemptions are loopback only", "Abuse", WARN, not non_loop,
              (f"Exempt: {', '.join(non_loop)}. " if non_loop else f"Exempt: {', '.join(exempt) or 'none'}. ") +
              "The exemption only applies while SANDBOX_ENABLED is true, so with the sandbox off nobody is exempt.",
              "Set RATE_LIMIT_EXEMPT_IPS=127.0.0.1,::1 (or empty) so turning the sandbox on by mistake cannot open a hole."))

    rz_missing = [n for n in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET") if not getattr(s, n)]
    add(Check("razorpay.keys", "Razorpay platform keys", "Payments", BLOCK, not rz_missing,
              (f"Missing: {', '.join(rz_missing)}. Plan billing in India uses these."
               if rz_missing else "Key id, key secret and webhook secret are set."),
              f"Razorpay Dashboard → Account & Settings → API keys (live mode) for the key pair; Webhooks → add https://{s.public_host('api')}/api/video/webhooks/payments/razorpay for the webhook secret. Seal the secrets with scripts/manage_secrets.py."))
    kid = s.RAZORPAY_KEY_ID or ""
    if kid.startswith("rzp_live_"):
        add(Check("razorpay.live", "Razorpay is in live mode", "Payments", BLOCK, True, "Key id starts with rzp_live_.", ""))
    elif kid.startswith("rzp_test_"):
        add(Check("razorpay.live", "Razorpay is in live mode", "Payments", WARN, False,
                  "Key id starts with rzp_test_: payments are test payments and nobody is charged.",
                  "Switch to the live key pair and live webhook secret before opening the store."))
    else:
        add(Check("razorpay.live", "Razorpay is in live mode", "Payments", BLOCK, False,
                  "No key id." if not kid else "Key id does not look like a Razorpay key (rzp_live_…).",
                  "Set RAZORPAY_KEY_ID to the live key id (rzp_live_…)."))
    add(Check("razorpay.api_base", "Razorpay API base is the real one", "Payments", WARN,
              (s.RAZORPAY_API_BASE or "").rstrip("/") == "https://api.razorpay.com/v1",
              f"RAZORPAY_API_BASE is {s.RAZORPAY_API_BASE}.", "Remove RAZORPAY_API_BASE from the env file (the default is correct)."))
    ls_missing = [n for n in ("LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_STORE_ID", "LEMONSQUEEZY_VARIANT_ID", "LEMONSQUEEZY_WEBHOOK_SECRET") if not getattr(s, n)]
    add(Check("lemonsqueezy", "Merchant of record for buyers abroad", "Payments", WARN, not ls_missing,
              "Lemon Squeezy is configured." if not ls_missing else
              f"Missing: {', '.join(ls_missing)}. Buyers outside India fall back to Razorpay in rupees.",
              "Lemon Squeezy → Settings → API: a key, the store id, one variant for plan payments, and a webhook to /api/video/webhooks/payments/lemonsqueezy."))

    graph = bool(s.MS_GRAPH_TENANT_ID and s.MS_GRAPH_CLIENT_ID and s.MS_GRAPH_CLIENT_SECRET)
    if cli:
        env_smtp = bool(s.SMTP_HOST and s.SMTP_USER and s.SMTP_PASSWORD)
        add(Check("email.config", "Outgoing email", "Email", WARN, graph or env_smtp,
                  f"Microsoft Graph set, sending as {s.MS_GRAPH_SENDER or s.SMTP_FROM_EMAIL} — used when no email configuration is saved in Admin → Email Config." if graph else
                  f"SMTP_* set ({s.SMTP_HOST}:{s.SMTP_PORT}) — used when no email configuration is saved in Admin → Email Config." if env_smtp else
                  "No MS_GRAPH_* or SMTP_* in the env file; mail then needs an active configuration in Admin → Email Config (check with --db).",
                  "Set MS_GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET (Microsoft 365 app-only), or SMTP_HOST/PORT/USER/PASSWORD."))
    if graph:
        try:
            expires = datetime.strptime(s.MS_GRAPH_SECRET_EXPIRES, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            expires = None
        days = (expires - datetime.now(timezone.utc)).days if expires else None
        add(Check("email.graph_secret", "Microsoft mail app secret is not about to expire", "Email", WARN,
                  days is not None and days > 30,
                  f"The client secret expires on {s.MS_GRAPH_SECRET_EXPIRES} ({days} days)." if days is not None else
                  "MS_GRAPH_SECRET_EXPIRES is not set, so nothing warns before the client secret expires and mail stops.",
                  "Entra admin centre → App registrations → the mail app → Certificates & secrets: add a new secret, "
                  "put it in MS_GRAPH_CLIENT_SECRET and its expiry date (YYYY-MM-DD) in MS_GRAPH_SECRET_EXPIRES."))
    fe = s.SMTP_FROM_EMAIL or ""
    add(Check("email.from", "Platform contact address", "Email", WARN, "@" in fe and not _placeholder(fe) and not fe.endswith("@example.com"),
              f"SMTP_FROM_EMAIL is {fe or '(empty)'} — copied on staff invitations and shown as the contact on sign-in errors.",
              "Set SMTP_FROM_EMAIL to a monitored mailbox on a domain with SPF/DKIM for the mail provider."))

    vp = (s.VIDEO_PROVIDER or "").strip().lower()
    b_missing = [n for n in ("BUNNY_LIBRARY_ID", "BUNNY_API_KEY", "BUNNY_TOKEN_KEY", "BUNNY_CDN_HOST", "BUNNY_WEBHOOK_SECRET") if not getattr(s, n)]
    add(Check("video.provider", "Video hosting and delivery", "Video & AI", BLOCK, vp == "bunny" and not b_missing,
              ("VIDEO_PROVIDER is sandbox: videos are encoded on this server and served through the API." if vp != "bunny" else
               f"Bunny Stream is missing {', '.join(b_missing)}." if b_missing else "Bunny Stream with signed playback."),
              f"Bunny → Stream → a library: set VIDEO_PROVIDER=bunny, BUNNY_LIBRARY_ID, BUNNY_API_KEY, BUNNY_TOKEN_KEY (token authentication), BUNNY_CDN_HOST and a webhook to https://{s.public_host('api')}/api/video/webhooks/media/bunny?secret=<BUNNY_WEBHOOK_SECRET>. Enable MP4 fallback for clipping."))
    stt_ok = (s.STT_PROVIDER == "openai" and bool(s.OPENAI_TRANSCRIBE_URL and s.OPENAI_TRANSCRIBE_KEY)) or (
        s.STT_PROVIDER == "azure_speech" and bool(s.AZURE_SPEECH_KEY))
    add(Check("stt.provider", "Speech to text", "Video & AI", BLOCK, stt_ok,
              "Configured." if stt_ok else f"STT_PROVIDER is {s.STT_PROVIDER}: transcripts come from embedded subtitles or placeholders.",
              "Set STT_PROVIDER=azure_speech with AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, or STT_PROVIDER=openai with OPENAI_TRANSCRIBE_URL/KEY."))
    llm_ok = s.LLM_PROVIDER != "sandbox" and bool(s.LLM_BASE_URL and s.LLM_API_KEY and s.LLM_MODEL)
    add(Check("llm.configured", "Language model for summaries, Ask and translation", "Video & AI", WARN, llm_ok,
              "Configured." if llm_ok else "LLM_PROVIDER is sandbox: summaries are extractive, Ask quotes the transcript and subtitles are not translated.",
              "Set LLM_PROVIDER=azure_openai, LLM_BASE_URL (Responses API), LLM_API_KEY (sealed), LLM_MODEL and LLM_MODEL_FAST."))
    priced = bool(s.LLM_INPUT_COST_PER_MTOK_MINOR or s.LLM_OUTPUT_COST_PER_MTOK_MINOR)
    add(Check("llm.budget", "Language-model budget can stop spending", "Video & AI", WARN, not llm_ok or (priced and s.LLM_MONTHLY_BUDGET_MINOR > 0),
              f"Budget {s.LLM_MONTHLY_BUDGET_MINOR} paise; token prices {'set' if priced else 'not set (the budget cannot stop anything)'}.",
              "Set LLM_INPUT_COST_PER_MTOK_MINOR and LLM_OUTPUT_COST_PER_MTOK_MINOR from the Azure price sheet."))
    emb_ok = s.EMBED_PROVIDER != "sandbox" and bool(s.EMBED_URL)
    add(Check("embed.provider", "Embeddings for search and Ask", "Video & AI", WARN, emb_ok,
              "Configured." if emb_ok else "EMBED_PROVIDER is sandbox: hashed word vectors, keyword-level search only.",
              "Set EMBED_PROVIDER=azure_openai and EMBED_URL to a text-embedding-3-small deployment (EMBED_DIM=1536)."))
    scan_ok = s.SCAN_PROVIDER != "sandbox" and bool(s.SCAN_API_URL and s.SCAN_API_KEY)
    add(Check("scan.provider", "Upload safety scanning (CSAM hash matching and classification)", "Trust & safety", BLOCK, scan_ok,
              "Configured." if scan_ok else "SCAN_PROVIDER is sandbox: only a local hash list and a keyword lexicon screen uploads.",
              "Contract a hash-matching vendor and a content classifier; set SCAN_PROVIDER, SCAN_API_URL and SCAN_API_KEY "
              "(SCAN_PROVIDER=azure_content_safety with an Azure AI Content Safety endpoint and key classifies frames and text). "
              "A public upload platform must not open without it."))
    yt_ok = s.YOUTUBE_PROVIDER != "sandbox" and bool(s.GOOGLE_CLIENT_ID and s.GOOGLE_CLIENT_SECRET)
    add(Check("youtube.oauth", "YouTube channel connection", "Integrations", WARN, yt_ok,
              "Configured." if yt_ok else "YOUTUBE_PROVIDER is sandbox: Connect YouTube imports a sample channel.",
              f"Google Cloud → OAuth client (web) with redirect {s.YOUTUBE_OAUTH_REDIRECT}; submit the consent screen for verification (sensitive scopes) and request a YouTube API quota extension."))
    reg = s.REGION
    reg_ok = reg in ("in", "us") and (reg != "us" or bool(s.LEMONSQUEEZY_STORE_ID and s.LEMONSQUEEZY_API_KEY)) and \
        (not s.REGION_ENFORCE or all(r in (s.REGION_URLS or "") for r in ("in=", "us=")))
    add(Check("region.config", "Region and data residency", "Infrastructure", WARN, reg_ok,
              f"REGION={reg}, enforced={s.REGION_ENFORCE}." if reg_ok else
              f"REGION={reg!r} is not ready: the US host sells through Lemon Squeezy and an enforced region needs both URLs.",
              "Set REGION to in or us; on the US host configure LEMONSQUEEZY_*; with REGION_ENFORCE=true set "
              "REGION_URLS=in=https://api.play.klygenix.com,us=https://api.us.play.klygenix.com."))
    cf_need = [k for k in ("CF_ACCOUNT_ID", "CF_STREAM_TOKEN", "CF_STREAM_CUSTOMER_HOST", "CF_STREAM_SIGNING_KEY_ID",
                           "CF_STREAM_SIGNING_KEY", "CF_STREAM_WEBHOOK_SECRET", "CF_NOTIFY_SECRET") if not getattr(s, k)]
    live_ok = s.LIVE_PROVIDER == "cloudflare" and not cf_need
    add(Check("live.provider", "Live streaming ingest and delivery", "Video & AI", WARN, live_ok,
              "Cloudflare Stream Live is configured." if live_ok else
              (f"LIVE_PROVIDER is cloudflare but {', '.join(cf_need)} missing." if s.LIVE_PROVIDER == "cloudflare" else
               "LIVE_PROVIDER is sandbox: going live is refused in production (the sandbox ingest runs ffmpeg on this server)."),
              "Set LIVE_PROVIDER=cloudflare with CF_ACCOUNT_ID, CF_STREAM_TOKEN (Stream:Edit), CF_STREAM_CUSTOMER_HOST, a signing key "
              "(CF_STREAM_SIGNING_KEY_ID + CF_STREAM_SIGNING_KEY, the base64 PEM from POST /stream/keys), CF_STREAM_WEBHOOK_SECRET "
              "(POST /stream/webhook) and CF_NOTIFY_SECRET (the live-input notification destination); set LIVE_WORKER_INLINE=false. "
              "docs/GO-LIVE.md has the steps."))
    route_ok = bool(s.RAZORPAY_KEY_ID and s.RAZORPAY_KEY_SECRET and s.ROUTE_PROFILE_CATEGORY and s.ROUTE_PROFILE_SUBCATEGORY)
    add(Check("route.payouts", "Creator payouts (Razorpay Route)", "Creator money", WARN, route_ok,
              "Route is configured: creators can activate payouts and take tips, memberships and paid videos." if route_ok else
              "Route is not configured: payout accounts cannot be submitted, so no creator can take money (tips, boosts, memberships, paid videos are off).",
              "Only after CA sign-off: enable Route on Play's Razorpay account, set ROUTE_PROFILE_CATEGORY/SUBCATEGORY to the category Razorpay confirms, and review commission, reserve and refund-window settings."))
    tts_ok = s.TTS_PROVIDER == "azure" and bool(s.AZURE_TTS_KEY)
    add(Check("tts.provider", "Text to speech for AI dubbing", "Video & AI", WARN, tts_ok,
              "Configured." if tts_ok else "TTS_PROVIDER is sandbox: dub tracks are placeholder tones.",
              "Set TTS_PROVIDER=azure with AZURE_TTS_KEY and AZURE_TTS_REGION, or keep dubbing consent off."))
    add(Check("publish.provider", "Publishing clips to YouTube Shorts / Instagram Reels", "Integrations", WARN,
              s.PUBLISH_PROVIDER != "sandbox",
              "Live." if s.PUBLISH_PROVIDER != "sandbox" else "PUBLISH_PROVIDER is sandbox: publishing records a fake external id.",
              "Set PUBLISH_PROVIDER=live once YouTube upload is verified; Instagram needs a Meta app and account connection."))
    add(Check("face.provider", "Face tracking for clip reframing", "Video & AI", WARN, s.FACE_PROVIDER == "opencv",
              "OpenCV face detection." if s.FACE_PROVIDER == "opencv" else "FACE_PROVIDER is sandbox: tracking follows the test marker only.",
              "Set FACE_PROVIDER=opencv (OpenCV is in the image)."))
    g = bool(s.GOOGLE_CLIENT_ID and s.GOOGLE_CLIENT_SECRET)
    add(Check("google.oauth", "Google sign-in", "Integrations", WARN, g,
              "Set." if g else "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are empty: staff sign in with a password only.",
              "Google Cloud console → APIs & Services → Credentials → OAuth client (web) with the admin and studio origins."))
    return out


def evaluate_db(db, s: Settings) -> list[Check]:
    from sqlalchemy import create_engine, select, text

    from app.core.models.email_config import EmailConfig
    from app.core.models.tenant import Tenant
    from app.core.models.user import User
    from app.core.services.auth_service import verify_password
    from app.video.models.commerce import Plan, ProviderEvent

    out: list[Check] = []
    add = out.append

    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
        heads = set(ScriptDirectory.from_config(cfg).get_heads())
        owner = create_engine(s.DATABASE_URL, pool_pre_ping=True)
        try:
            with owner.connect() as cx:
                current = {r[0] for r in cx.execute(text("SELECT version_num FROM alembic_version"))}
        finally:
            owner.dispose()
        add(Check("db.migrations", "Database is migrated to head", "Data", BLOCK, current == heads,
                  f"Database at {', '.join(sorted(current)) or 'nothing'}; code head {', '.join(sorted(heads))}.",
                  "Run: alembic upgrade head (infra/deploy.sh does it before starting the API)."))
    except Exception as exc:
        add(Check("db.migrations", "Database is migrated to head", "Data", BLOCK, False,
                  f"Could not compare migrations: {type(exc).__name__}.", "Run: alembic upgrade head, and check DATABASE_URL."))

    cfg_row = db.execute(select(EmailConfig).where(EmailConfig.config_type == "global", EmailConfig.is_active.is_(True))
                         .order_by(EmailConfig.id.desc())).scalars().first()
    pw_ok = bool(cfg_row and secrets.resolve(cfg_row.smtp_password))
    env_smtp = bool(s.SMTP_HOST and s.SMTP_USER and s.SMTP_PASSWORD)
    graph = bool(s.MS_GRAPH_TENANT_ID and s.MS_GRAPH_CLIENT_ID and s.MS_GRAPH_CLIENT_SECRET)
    add(Check("email.config", "Outgoing email", "Email", BLOCK, (bool(cfg_row) and pw_ok) or (cfg_row is None and (graph or env_smtp)),
              (f"Active global configuration: {cfg_row.smtp_host}:{cfg_row.smtp_port} as {cfg_row.from_email}." if cfg_row and pw_ok else
               f"The active configuration ({cfg_row.smtp_host}) has a password that does not unseal." if cfg_row else
               f"No saved configuration; Microsoft Graph sends as {s.MS_GRAPH_SENDER or s.SMTP_FROM_EMAIL}." if graph else
               f"No saved configuration; the env SMTP settings ({s.SMTP_HOST}) are used." if env_smtp else
               "No active email configuration, no MS_GRAPH_* and no SMTP_* in the env: sign-in codes, receipts, invoices and staff invitations cannot be sent."),
              "Set MS_GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET in the env file (Microsoft 365 app-only), or save an SMTP account in Admin → Email Config, then send a test email."))

    import re

    tenant = db.execute(select(Tenant).where(Tenant.slug == s.ADMIN_TENANT_SLUG)).scalars().first()
    if tenant is None:
        add(Check("platform.identity", "Klygenix's seller identity", "Data", BLOCK, False,
                  "The admin tenant does not exist.", "Start the API once so it seeds the admin tenant."))
    else:
        grievance = (tenant.settings or {}).get("grievance_officer") or {}
        missing = [label for label, good in (
            ("legal name", bool(tenant.name)), ("address", bool(tenant.address)),
            ("valid GSTIN", bool(re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]", tenant.gst_number or ""))),
            ("support email", bool(tenant.email)),
            ("grievance officer name", bool(grievance.get("name"))), ("grievance officer email", bool(grievance.get("email"))),
        ) if not good]
        add(Check("platform.identity", "Klygenix's seller identity and grievance officer", "Data", BLOCK, not missing,
                  (f"Missing: {', '.join(missing)}. These print on plan invoices, and the IT Rules require a published grievance officer."
                   if missing else f"{tenant.name}, GSTIN {tenant.gst_number}."),
                  "Admin → Accounts → Klygenix Technologies → Company: address, GSTIN, support email and the grievance officer."))

    since = datetime.now(timezone.utc) - timedelta(days=7)
    last = db.execute(select(ProviderEvent.received_at).where(
        ProviderEvent.rail == "razorpay", ProviderEvent.signature_ok.is_(True))
        .order_by(ProviderEvent.received_at.desc()).limit(1)).scalar()
    add(Check("razorpay.webhook_seen", "Razorpay webhooks are arriving", "Payments", WARN, bool(last and last >= since),
              (f"Last verified Razorpay callback {last.isoformat(timespec='minutes')}." if last else "No verified Razorpay callback has ever arrived.")
              + ("" if last and last >= since else " Nothing in the last 7 days."),
              "Razorpay Dashboard → Webhooks: check the URL and secret, then send a test event (or make the ₹1 purchase in docs/LAUNCH.md)."))

    plans = db.execute(select(Plan)).scalars().all()
    frees = {p.audience for p in plans if p.is_active and p.price_inr_minor == 0}
    add(Check("plans.free", "Free viewer and creator plans exist", "Data", BLOCK, frees >= {"viewer", "creator"},
              f"Free plans for: {', '.join(sorted(frees)) or 'none'}.",
              "Keep one active free plan per audience — every lapsed subscriber falls back to it."))
    odd = [p.key for p in plans if p.is_active and (p.price_inr_minor < 0 or p.price_usd_minor < 0 or not p.limits)]
    add(Check("plans.sane", "Plans are sane", "Data", BLOCK, bool(plans) and not odd,
              f"Odd plans: {', '.join(odd)}." if odd else f"{len(plans)} plans.", "Fix the plan rows in kv_commerce.plans."))

    admin = db.execute(select(User).where(User.email == s.GLOBAL_ADMIN_EMAIL)).scalars().first()
    weak = bool(admin and verify_password(DEV_ADMIN_PASSWORD, admin.password_hash or ""))
    add(Check("admin.default_password", "Global admin password is changed", "Secrets", BLOCK, bool(admin) and not weak,
              ("No global admin account." if not admin else
               f"{admin.email} still signs in with the development password." if weak else f"{admin.email} has a non-default password."),
              "Admin console → your profile → change password, and turn on two-step sign-in."))
    return out


def summarise(checks: list[Check]) -> dict:
    blocking = [c for c in checks if c.severity == BLOCK and not c.ok]
    warnings = [c for c in checks if c.severity == WARN and not c.ok]
    return {
        "ready": not blocking,
        "blocking_failed": len(blocking),
        "warnings": len(warnings),
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "checks": [c.as_dict() for c in checks],
    }


def env_file_settings(path: str | os.PathLike) -> tuple[Settings, dict]:
    from dotenv import dotenv_values

    values = {k: v for k, v in dotenv_values(path).items() if v is not None}
    if values.get("KLYGENIX_VIDEO_KEY_FILE"):
        os.environ["KLYGENIX_VIDEO_KEY_FILE"] = values["KLYGENIX_VIDEO_KEY_FILE"]

    class FileOnly(Settings):
        @classmethod
        def settings_customise_sources(cls, settings_cls, init_settings, env_settings, dotenv_settings, file_secret_settings):
            return (init_settings, dotenv_settings)

    return FileOnly(_env_file=str(path)), values
