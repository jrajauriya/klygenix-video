import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet

from harness import admin_login, check, finish, ok, signup

BACKEND = Path(__file__).resolve().parent.parent / "backend"


def run(env_file: Path):
    env = {k: v for k, v in os.environ.items() if k != "KLYGENIX_VIDEO_KEY_FILE"}
    p = subprocess.run([sys.executable, "-m", "app.readiness", "--env-file", str(env_file), "--json"], cwd=BACKEND,
                       env=env, capture_output=True, text=True, timeout=120)
    try:
        return p.returncode, json.loads(p.stdout)
    except ValueError:
        return p.returncode, {"_raw": p.stdout + p.stderr}


tmp = Path(tempfile.mkdtemp(prefix="kv-readiness-"))
key = Fernet.generate_key()
key_file = tmp / "secret.key"
key_file.write_bytes(key)
key_file.chmod(0o600)
(tmp / "index.html").write_text("<!doctype html><title>Klygenix Play</title>")
(tmp / "backups" / "base" / "20261103T0230").mkdir(parents=True)


def seal(v: str) -> str:
    return "enc:" + Fernet(key).encrypt(v.encode()).decode()


GOOD = {
    "KLYGENIX_VIDEO_KEY_FILE": str(key_file), "KV_BACKUP_DIR": str(tmp / "backups"),
    "DATABASE_URL": "postgresql://klygenix_video:Owner-Fake-Pass-7f3a@postgres:5432/klygenix_video",
    "APP_DATABASE_URL": "postgresql://klygenix_video_app:App-Fake-Pass-91c2@postgres:5432/klygenix_video",
    "SECRET_KEY": "Fake-Signing-Key-For-Readiness-Suite-0123456789-abcdefghijk",
    "GLOBAL_ADMIN_PASSWORD": "Fake-Admin-Pass-2026!", "SANDBOX_ENABLED": "false", "JOBS_MODE": "rq",
    "PAYMENT_RAIL": "razorpay", "PUBLIC_DOMAIN": "play.example.com",
    "APP_LOGIN_URL": "https://admin.play.example.com/login", "STUDIO_APP_URL": "https://studio.play.example.com",
    "WEB_BASE_URL": "https://play.example.com", "API_PUBLIC_BASE_URL": "https://api.play.example.com",
    "CORS_ORIGINS": "https://admin.play.example.com,https://studio.play.example.com,https://play.example.com",
    "WEB_INDEX_PATH": str(tmp / "index.html"), "METRICS_TOKEN": "metrics-token-for-the-suite-0123456789",
    "REDIS_URL": "redis://:Redis-Fake-Pass-55@redis:6379/0",
    "S3_ENDPOINT": "https://acct.r2.cloudflarestorage.com", "S3_BUCKET": "kv-files", "S3_ACCESS_KEY": "AKIAFAKE",
    "S3_SECRET_KEY": seal("s3-secret"),
    "RAZORPAY_KEY_ID": "rzp_live_FakeKeyId", "RAZORPAY_KEY_SECRET": seal("rzp-secret"),
    "RAZORPAY_WEBHOOK_SECRET": seal("rzp-hook"),
    "VIDEO_PROVIDER": "bunny", "BUNNY_LIBRARY_ID": "123", "BUNNY_API_KEY": seal("bunny-api"),
    "BUNNY_TOKEN_KEY": seal("bunny-token"), "BUNNY_CDN_HOST": "vz-123.b-cdn.net", "BUNNY_WEBHOOK_SECRET": seal("bunny-hook"),
    "STT_PROVIDER": "azure_speech", "AZURE_SPEECH_KEY": seal("speech"),
    "SCAN_PROVIDER": "vendor", "SCAN_API_URL": "https://scan.example.com/v1/scan", "SCAN_API_KEY": seal("scan"),
    "SMTP_HOST": "smtp.example.com", "SMTP_USER": "contact@klygenix.com", "SMTP_PASSWORD": seal("smtp"),
}


def write(name: str, values: dict) -> Path:
    path = tmp / name
    path.write_text("\n".join(f"{k}={v}" for k, v in values.items()) + "\n")
    return path


print("\n== A production-shaped configuration is ready")
code, report = run(write("good.env", GOOD))
blocking = [c["key"] for c in report.get("checks", []) if c["severity"] == "block" and not c["ok"]]
check("no blocking failures", blocking, [])
check("exit 0", code, 0)
ok("report has every field", all({"key", "title", "group", "severity", "ok", "detail", "fix"} <= set(c) for c in report["checks"]))

print("\n== The development configuration is refused")
dev = {"KLYGENIX_VIDEO_KEY_FILE": str(key_file), "SANDBOX_ENABLED": "true", "JOBS_MODE": "inline"}
code, report = run(write("dev.env", dev))
failed = {c["key"] for c in report.get("checks", []) if c["severity"] == "block" and not c["ok"]}
check("exit 1", code, 1)
for k in ("sandbox.disabled", "jobs.mode", "secret.key", "metrics.token", "url.api", "cors.origins", "db.owner_url",
          "video.provider", "stt.provider", "scan.provider", "razorpay.keys"):
    ok(f"blocks on {k}", k in failed)
ok("every failure carries a fix", all(c["fix"] for c in report["checks"] if not c["ok"]))

print("\n== One bad value is enough")
code, report = run(write("one.env", {**GOOD, "SCAN_PROVIDER": "sandbox"}))
check("sandbox safety scanning blocks launch", code, 1)
code, report = run(write("two.env", {**GOOD, "BUNNY_API_KEY": "enc:not-valid"}))
ok("an unsealable value blocks", any(c["key"] == "sealed.values" and not c["ok"] for c in report["checks"]))
code, report = run(write("three.env", {**GOOD, "WEB_BASE_URL": "http://localhost:5300"}))
ok("a localhost public URL blocks", any(c["key"] == "url.web" and not c["ok"] for c in report["checks"]))

print("\n== The admin console sees the same report")
admin = admin_login()
r = admin.get("/api/admin/readiness")
check("admin readiness endpoint", r.status_code, 200)
ok("it lists Play's checks", any(c["key"] == "video.provider" for c in r.json()["checks"]))
check("a viewer cannot read it", signup("Not admin").get("/api/admin/readiness").status_code, 403)

finish()
