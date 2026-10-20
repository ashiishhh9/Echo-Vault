import os
import hashlib
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv()

from app.services.persistence import PersistentDict

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
if os.getenv("ENVIRONMENT", "development").lower() == "production" and len(SECRET_KEY) < 32:
    raise RuntimeError("Set a random SECRET_KEY of at least 32 characters in production")
if not 1 <= ACCESS_TOKEN_EXPIRE_MINUTES <= 24 * 60:
    raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES must be between 1 and 1440")

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
_revoked_tokens = PersistentDict("revoked_tokens")
_last_revoked_cleanup = 0


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str, extra_claims: dict[str, Any] | None = None) -> str:
    expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {"sub": subject, "exp": expire}
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    token_digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if _revoked_tokens.get(token_digest, 0) > int(time.time()):
        raise jwt.InvalidTokenError("Token has been revoked")
    return payload


def revoke_access_token(token: str, payload: dict[str, Any]) -> None:
    global _last_revoked_cleanup
    expires_at = int(payload.get("exp", 0))
    if expires_at <= int(time.time()):
        return
    now = int(time.time())
    if now - _last_revoked_cleanup >= 300:
        _last_revoked_cleanup = now
        for token_digest, expiry in list(_revoked_tokens.items()):
            if expiry <= now:
                _revoked_tokens.pop(token_digest, None)
    _revoked_tokens[hashlib.sha256(token.encode("utf-8")).hexdigest()] = expires_at
