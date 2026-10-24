"""
Darshini - Authentication and Role-Based Access Control Core
Implements secure password hashing, JWT token creation/validation,
role checking, and brute-force rate-limiting.
"""

import hashlib
import hmac
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import JWT_ACCESS_TOKEN_EXPIRE_MINUTES, JWT_ALGORITHM, JWT_SECRET_KEY
from app.db.database import get_db_read

logger = logging.getLogger("darshini.auth")

# Security Bearer scheme
security_bearer = HTTPBearer(auto_error=False)

# Roles definition
ROLE_ADMIN = "ADMIN"
ROLE_EVENT_MANAGER = "EVENT_MANAGER"
ROLE_CHECKIN_OPERATOR = "CHECKIN_OPERATOR"

VALID_ROLES = {ROLE_ADMIN, ROLE_EVENT_MANAGER, ROLE_CHECKIN_OPERATOR}

# Role hierarchy: ADMIN has all privileges; EVENT_MANAGER inherits CHECKIN_OPERATOR
ROLE_PERMISSIONS: Dict[str, Set[str]] = {
    ROLE_ADMIN: {ROLE_ADMIN, ROLE_EVENT_MANAGER, ROLE_CHECKIN_OPERATOR},
    ROLE_EVENT_MANAGER: {ROLE_EVENT_MANAGER, ROLE_CHECKIN_OPERATOR},
    ROLE_CHECKIN_OPERATOR: {ROLE_CHECKIN_OPERATOR},
}

# Rate limiting for auth attempts: tracks (ip, count, reset_time)
_AUTH_ATTEMPTS: Dict[str, Dict[str, Any]] = {}
MAX_AUTH_ATTEMPTS = 10
AUTH_WINDOW_SECONDS = 300  # 5 minutes


def check_auth_rate_limit(client_ip: str) -> None:
    """Enforces rate-limiting on sensitive authentication endpoints."""
    now = time.time()
    record = _AUTH_ATTEMPTS.get(client_ip)

    if record:
        if now > record["reset_at"]:
            _AUTH_ATTEMPTS[client_ip] = {"count": 1, "reset_at": now + AUTH_WINDOW_SECONDS}
        else:
            if record["count"] >= MAX_AUTH_ATTEMPTS:
                retry_after = int(record["reset_at"] - now)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many failed login attempts. Please retry in {retry_after} seconds.",
                )
            record["count"] += 1
    else:
        _AUTH_ATTEMPTS[client_ip] = {"count": 1, "reset_at": now + AUTH_WINDOW_SECONDS}


def clear_auth_rate_limit(client_ip: str) -> None:
    """Resets failed attempt count upon successful authentication."""
    if client_ip in _AUTH_ATTEMPTS:
        del _AUTH_ATTEMPTS[client_ip]


def hash_password(password: str) -> str:
    """
    Hashes a password using PBKDF2-HMAC-SHA256 with 100,000 iterations and a 16-byte random salt.
    Format: pbkdf2_sha256$100000$salt_hex$hash_hex
    """
    salt = secrets.token_bytes(16)
    iterations = 100_000
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${derived.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a plain password against the stored pbkdf2_sha256 hash.
    Constant-time comparison via hmac.compare_digest prevents timing attacks.
    """
    try:
        parts = hashed_password.split("$")
        if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
            return False
        iterations = int(parts[1])
        salt = bytes.fromhex(parts[2])
        expected_hash = bytes.fromhex(parts[3])

        candidate_hash = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(candidate_hash, expected_hash)
    except Exception:
        return False


def create_access_token(
    user_id: str,
    username: str,
    role: str,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Creates a signed, expiring JWT access token."""
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decodes and validates a JWT access token."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token signature or claims.",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
) -> Dict[str, Any]:
    """
    FastAPI dependency that extracts and validates the Bearer JWT token,
    then looks up the active user from the database.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing subject identifier.",
        )

    with get_db_read() as conn:
        cursor = conn.execute(
            "SELECT id, username, full_name, role, is_active FROM users WHERE id = ?;",
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account no longer exists.",
            )
        if not row["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is deactivated.",
            )

        return {
            "id": row["id"],
            "username": row["username"],
            "full_name": row["full_name"],
            "role": row["role"],
        }


def require_role(*required_roles: str):
    """
    Returns a dependency that verifies the authenticated user possesses one of the required roles,
    honoring the role hierarchy (ADMIN possesses all roles, EVENT_MANAGER possesses CHECKIN_OPERATOR).
    """

    async def role_checker(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        user_role = current_user["role"]
        granted_roles = ROLE_PERMISSIONS.get(user_role, set())

        if not any(req in granted_roles for req in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. User role '{user_role}' lacks required permissions: {list(required_roles)}",
            )
        return current_user

    return role_checker
