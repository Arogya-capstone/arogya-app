from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import os

bearer = HTTPBearer()
ALGORITHM = "RS256"


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


PUBLIC_KEY = _load_public_key()


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
            detail={"error": {"code": "UNAUTHORIZED", "message": "Invalid token"}},
        )
