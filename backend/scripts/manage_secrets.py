"""Encrypt sensitive values in backend/.env in place.

    python3 scripts/manage_secrets.py init            # create the master key
    python3 scripts/manage_secrets.py encrypt         # encrypt the GPT values in .env
    python3 scripts/manage_secrets.py status          # what is encrypted, and does it decrypt
    python3 scripts/manage_secrets.py decrypt         # put plaintext back (needs --force)
    python3 scripts/manage_secrets.py rotate          # new master key; reseal the database and .env
    python3 scripts/manage_secrets.py rotate --dry-run

The master key lives in backend/.secret.key, NOT in .env, so a screenshot or a shoulder-glance at
.env shows ciphertext only. Anyone who can read both files can still decrypt — see status output.
"""
import argparse
import re
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.core.services import secrets  # noqa: E402

ENV_FILE = BACKEND_ROOT / ".env"
TARGETS = (
    "GPT_BASE_URL", "GPT_API_KEY", "GPT_MODEL",
    "SMTP_PASSWORD", "MS_GRAPH_CLIENT_SECRET", "S3_SECRET_KEY",
    "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
    "STRIPE_KEY_SECRET", "STRIPE_WEBHOOK_SECRET",
)


def read_env() -> list[str]:
    if not ENV_FILE.is_file():
        sys.exit(f"No {ENV_FILE}")
    return ENV_FILE.read_text().splitlines()


def write_env(lines: list[str]) -> None:
    ENV_FILE.write_text("\n".join(lines) + "\n")
    ENV_FILE.chmod(0o600)


def each_target(lines: list[str]):
    for i, line in enumerate(lines):
        match = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if match and match.group(1) in TARGETS:
            yield i, match.group(1), match.group(2)


def mask(value: str) -> str:
    if len(value) <= 14:
        return f"({len(value)} chars)"
    return f"{value[:8]}…{value[-4:]} ({len(value)} chars)"


def cmd_init() -> None:
    try:
        path = secrets.create_key()
    except FileExistsError as exc:
        sys.exit(str(exc))
    print(f"Master key written to {path} (mode 600).")
    print("It is gitignored. Back it up somewhere safe — without it the encrypted values are lost.")


def cmd_encrypt() -> None:
    if not secrets.has_key():
        sys.exit(f"No master key. Run: python3 {Path(__file__).name} init")
    lines = read_env()
    changed = 0
    for i, name, value in list(each_target(lines)):
        if not value:
            print(f"  {name:14} empty — skipped")
            continue
        if secrets.is_encrypted(value):
            print(f"  {name:14} already encrypted")
            continue
        lines[i] = f"{name}={secrets.encrypt(value)}"
        print(f"  {name:14} encrypted  {mask(value)} -> enc:…")
        changed += 1
    if changed:
        write_env(lines)
        print(f"\n{changed} value(s) encrypted in {ENV_FILE}. Restart the backend.")
    else:
        print("\nNothing to do.")


def cmd_decrypt(force: bool) -> None:
    if not force:
        sys.exit("This writes plaintext secrets back to .env. Pass --force if you mean it.")
    lines = read_env()
    changed = 0
    for i, name, value in list(each_target(lines)):
        if not secrets.is_encrypted(value):
            continue
        plain = secrets.resolve(value)
        if not plain:
            print(f"  {name:14} FAILED — {secrets.last_error()}")
            continue
        lines[i] = f"{name}={plain}"
        print(f"  {name:14} back to plaintext")
        changed += 1
    if changed:
        write_env(lines)
        print(f"\n{changed} value(s) decrypted. Restart the backend.")


def cmd_status() -> None:
    print(f"master key : {secrets.key_path()}  {'present' if secrets.has_key() else 'MISSING'}")
    print(f"env file   : {ENV_FILE}\n")
    for _, name, value in each_target(read_env()):
        if not value:
            print(f"  {name:14} empty")
        elif secrets.is_encrypted(value):
            plain = secrets.resolve(value)
            state = f"decrypts to {mask(plain)}" if plain else f"FAILS — {secrets.last_error()}"
            print(f"  {name:14} encrypted, {state}")
        else:
            print(f"  {name:14} PLAINTEXT  {mask(value)}")
    print(
        "\nWhat this protects against: casual exposure — a screenshot, a screen-share, someone\n"
        "glancing at .env. What it does NOT protect against: anyone who can read both .env and\n"
        f"{secrets.key_path().name}, since the app itself must decrypt without a human present.\n"
        "For production, put the key in Azure Key Vault and inject it as an environment variable."
    )


def cmd_rotate(dry_run: bool, env_file: Path) -> None:
    import json

    from cryptography.fernet import Fernet, MultiFernet
    from sqlalchemy import create_engine, text

    from app.config import settings

    if not secrets.has_key():
        sys.exit(f"No master key. Run: python3 {Path(__file__).name} init")
    engine = create_engine(settings.DATABASE_URL)
    previous = secrets.previous_key_path()

    if dry_run:
        with engine.connect() as conn:
            for table, column in secrets.SEALED:
                n = conn.execute(
                    text(f"SELECT count(*) FROM {table} WHERE {column} LIKE 'enc:%'")  # nosec B608 nosemgrep
                ).scalar()
                print(f"  {table}.{column:16} {n} sealed")
        env_count = sum(
            1 for line in (env_file.read_text().splitlines() if env_file.is_file() else [])
            if secrets.is_encrypted(line.partition("=")[2].strip())
        )
        print(f"  {env_file.name:36} {env_count} sealed")
        print("\nDry run: nothing changed.")
        return

    key = secrets.key_path()
    if previous.is_file():
        print(f"{previous.name} exists: finishing the rotation it belongs to.")
    else:
        key.rename(previous)
        key.write_bytes(Fernet.generate_key())
        key.chmod(0o600)
        print(f"New key at {key}; the old one is {previous.name} until every value is resealed.")

    new = Fernet(key.read_bytes().strip())
    old = MultiFernet([Fernet(previous.read_bytes().strip()), new])
    with engine.begin() as conn:
        counts = secrets.reseal_rows(conn, old, new)
        for (tenant_id,) in conn.execute(text("SELECT id FROM kv_admin.tenants")).all():
            conn.execute(
                text(
                    "INSERT INTO kv_core_tmp.audit_log (tenant_id, actor_kind, actor_label, action, "
                    "target_table, after) VALUES (:t, 'worker', 'manage_secrets rotate', "
                    "'credentials.resealed', 'credentials', CAST(:a AS JSONB))"
                ),
                {"t": tenant_id, "a": json.dumps(counts)},
            )
    env_count = secrets.reseal_env(env_file, old, new)
    previous.unlink()

    for name, n in counts.items():
        print(f"  {name:44} {n} resealed")
    print(f"  {env_file.name:44} {env_count} resealed")
    print("\nRotated. The old key is gone; restart the backend, worker and scheduler.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=("init", "encrypt", "decrypt", "status", "rotate"))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--env", type=Path, default=ENV_FILE)
    args = ap.parse_args()

    if args.command == "init":
        cmd_init()
    elif args.command == "encrypt":
        cmd_encrypt()
    elif args.command == "decrypt":
        cmd_decrypt(args.force)
    elif args.command == "rotate":
        cmd_rotate(args.dry_run, args.env)
    else:
        cmd_status()


if __name__ == "__main__":
    main()
