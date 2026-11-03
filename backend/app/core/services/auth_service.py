from datetime import datetime, timedelta, timezone
import bcrypt
import jwt

from app.config import settings

BCRYPT_ROUNDS = 12


def _secret(password: str) -> bytes:
    # bcrypt reads 72 bytes; passlib truncated silently, so existing hashes stay verifiable
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_secret(password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_secret(plain), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


def create_access_token(data: dict, minutes: int | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
