from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend
import json
import os

bearer = HTTPBearer()
ALGORITHM = "RS256"

# --- Key loading ---
# Locally: reads PEM files. In EKS: reads from env vars injected via Secrets Manager.

def _load_private_key() -> str:
    env_key = os.getenv("JWT_PRIVATE_KEY")
    if env_key:
        return env_key.replace("\\n", "\n")
    key_path = os.getenv("JWT_PRIVATE_KEY_PATH", "keys/private.pem")
    if os.path.exists(key_path):
        with open(key_path, "r") as f:
            return f.read()
    from aws_utils import get_secret, _PREFIX
    secret = get_secret(f"{_PREFIX}jwt-private-key")
    val = secret if isinstance(secret, str) else secret.get("key", next(iter(secret.values())))
    return val.replace("\\n", "\n")


def _load_public_key() -> str:
    env_key = os.getenv("JWT_PUBLIC_KEY")
    if env_key:
        return env_key.replace("\\n", "\n")
    key_path = os.getenv("JWT_PUBLIC_KEY_PATH", "keys/public.pem")
    if os.path.exists(key_path):
        with open(key_path, "r") as f:
            return f.read()
    from aws_utils import get_secret, _PREFIX
    secret = get_secret(f"{_PREFIX}jwt-public-key")
    val = secret if isinstance(secret, str) else secret.get("key", next(iter(secret.values())))
    return val.replace("\\n", "\n")


PRIVATE_KEY = _load_private_key()
PUBLIC_KEY = _load_public_key()


def create_token(user_id: str, role: str) -> str:
    return jwt.encode(
        {"user_id": user_id, "role": role, "iss": "arogya-user-service"},
        PRIVATE_KEY,
        algorithm=ALGORITHM,
        headers={"kid": "arogya-key-1"},
    )


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        payload = jwt.decode(credentials.credentials, PUBLIC_KEY, algorithms=[ALGORITHM])
        return {
            "user_id": payload["user_id"],
            "role": payload["role"],
            "token": credentials.credentials,
        }
    except JWTError:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Invalid token",
                    "details": "Token validation failed",
                }
            },
        )
