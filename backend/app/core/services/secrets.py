import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

PREFIX = "enc:"

SEALED = (
    ("kv_admin.email_configs", "smtp_password"),
    ("kv_admin.users", "totp_secret"),
    ("kv_social.connected_channels", "access_token"),
    ("kv_social.connected_channels", "refresh_token"),
)

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_KEY_FILE = _BACKEND_ROOT / ".secret.key"

_last_error: str | None = None


def key_path() -> Path:
    override = os.environ.get("KLYGENIX_VIDEO_KEY_FILE")
    return Path(override).expanduser() if override else DEFAULT_KEY_FILE


def previous_key_path() -> Path:
    path = key_path()
    return path.with_name(path.name + ".previous")


def has_key() -> bool:
    return key_path().is_file()


def load_key() -> bytes:
    path = key_path()
    if not path.is_file():
        raise FileNotFoundError(
            f"No master key at {path}. Run: python3 scripts/manage_secrets.py init"
        )
    return path.read_bytes().strip()


def create_key() -> Path:
    path = key_path()
    if path.is_file():
        raise FileExistsError(f"A master key already exists at {path} — refusing to overwrite it")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(Fernet.generate_key())
    path.chmod(0o600)
    return path


def is_encrypted(value: str | None) -> bool:
    return bool(value) and str(value).startswith(PREFIX)


def _fernet() -> MultiFernet:
    keys = [Fernet(load_key())]
    previous = previous_key_path()
    if previous.is_file():
        keys.append(Fernet(previous.read_bytes().strip()))
    return MultiFernet(keys)


def encrypt(plaintext: str) -> str:
    token = _fernet().encrypt(plaintext.encode()).decode()
    return f"{PREFIX}{token}"


def decrypt(value: str) -> str:
    token = str(value)[len(PREFIX):].encode()
    return _fernet().decrypt(token).decode()


def reseal_value(value: str, old: MultiFernet, new: Fernet) -> str:
    plain = old.decrypt(str(value)[len(PREFIX):].encode())
    sealed = f"{PREFIX}{new.encrypt(plain).decode()}"
    if new.decrypt(sealed[len(PREFIX):].encode()) != plain:
        raise ValueError("A resealed value did not read back")
    return sealed


def reseal_rows(conn, old: MultiFernet, new: Fernet) -> dict[str, int]:
    """Reseal every sealed column in the caller's transaction; any failure aborts it."""
    from sqlalchemy import text

    counts: dict[str, int] = {}
    for table, column in SEALED:
        rows = conn.execute(
            text(f"SELECT id, {column} FROM {table} WHERE {column} LIKE 'enc:%' FOR UPDATE")  # nosec B608 nosemgrep
        ).all()
        for row_id, value in rows:
            conn.execute(
                text(f"UPDATE {table} SET {column} = :v WHERE id = :i"),  # nosec B608 nosemgrep
                {"v": reseal_value(value, old, new), "i": row_id},
            )
        counts[f"{table}.{column}"] = len(rows)
    return counts


def reseal_env(path: Path, old: MultiFernet, new: Fernet) -> int:
    if not path.is_file():
        return 0
    lines = path.read_text().splitlines()
    changed = 0
    for i, line in enumerate(lines):
        name, sep, value = line.partition("=")
        if sep and is_encrypted(value.strip()):
            lines[i] = f"{name}={reseal_value(value.strip(), old, new)}"
            changed += 1
    if changed:
        path.write_text("\n".join(lines) + "\n")
        path.chmod(0o600)
    return changed


def last_error() -> str | None:
    return _last_error


def resolve(value: str | None) -> str:
    """Decrypt an ``enc:`` value, or hand back plaintext untouched.

    A failure returns "" rather than raising. These values feed one optional feature — reading a
    bill photo — and it already degrades cleanly when unconfigured (``scan-status`` reports
    ``available: false``). Taking the whole backend down at import time because a bill-scanning key
    could not be decrypted would turn a disabled feature into an outage.
    """
    global _last_error
    if not value:
        return ""
    if not is_encrypted(value):
        return str(value)
    try:
        plain = decrypt(value)
        _last_error = None
        return plain
    except FileNotFoundError:
        _last_error = (
            f"Encrypted settings found but no master key at {key_path()}. "
            "Run: python3 scripts/manage_secrets.py init"
        )
    except (InvalidToken, ValueError):
        _last_error = (
            f"Could not decrypt a value with the master key at {key_path()} — "
            "the key does not match what encrypted it."
        )
    except Exception as exc:
        _last_error = f"Could not decrypt a setting: {exc}"
    return ""


def seal(value: str) -> str:
    """Seal a credential for the database when a key exists; plaintext on a bare dev box.

    A column in SEALED holds either form — `resolve()` reads both — so a server that later
    gains a key reseals with `manage_secrets.py rotate` rather than a migration.
    """
    if not value:
        return value
    return encrypt(value) if has_key() else value
