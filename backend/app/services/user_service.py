"""
Darshini - User Account Service
Handles user creation, role assignment, authentication, and secure first-time admin bootstrap.
"""

import logging
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import DATA_DIR
from app.core.auth import (
    ROLE_ADMIN,
    ROLE_CHECKIN_OPERATOR,
    ROLE_EVENT_MANAGER,
    VALID_ROLES,
    hash_password,
    verify_password,
)
from app.db.database import get_db, get_db_read

logger = logging.getLogger("darshini.user_service")

BOOTSTRAP_TOKEN_FILE = DATA_DIR / ".bootstrap_token"


class UserService:
    """Manages system users and authentication credentials."""

    @staticmethod
    def get_user_count(db_path: Optional[str] = None) -> int:
        """Returns total number of registered users."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute("SELECT COUNT(*) AS total FROM users;")
            row = cursor.fetchone()
            return row["total"] if row else 0

    @staticmethod
    def get_user_by_username(username: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieves user profile by username."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                "SELECT id, username, password_hash, full_name, role, is_active, created_at FROM users WHERE username = ?;",
                (username.lower().strip(),),
            )
            row = cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    def get_user_by_id(user_id: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieves user profile by UUID."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                "SELECT id, username, full_name, role, is_active, created_at FROM users WHERE id = ?;",
                (user_id,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    def create_user(
        username: str,
        password: str,
        full_name: str,
        role: str,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Creates a new user with securely hashed credentials."""
        clean_username = username.lower().strip()
        if not clean_username or len(clean_username) < 3:
            raise ValueError("Username must be at least 3 characters.")
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if role not in VALID_ROLES:
            raise ValueError(f"Invalid role '{role}'. Must be one of {VALID_ROLES}")

        user_id = str(uuid.uuid4())
        pwd_hash = hash_password(password)
        now_utc = datetime.now(timezone.utc).isoformat()

        with get_db(db_path) as conn:
            conn.execute(
                """
                INSERT INTO users (id, username, password_hash, full_name, role, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?);
                """,
                (user_id, clean_username, pwd_hash, full_name.strip(), role, now_utc, now_utc),
            )

        logger.info("Created user '%s' with role '%s' (ID: %s)", clean_username, role, user_id)
        return {
            "id": user_id,
            "username": clean_username,
            "full_name": full_name.strip(),
            "role": role,
            "is_active": 1,
            "created_at": now_utc,
        }

    @staticmethod
    def authenticate_user(
        username: str,
        password: str,
        db_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Verifies credentials and returns user details if authentic and active."""
        user = UserService.get_user_by_username(username, db_path)
        if not user:
            return None
        if not user["is_active"]:
            return None
        if not verify_password(password, user["password_hash"]):
            return None

        return {
            "id": user["id"],
            "username": user["username"],
            "full_name": user["full_name"],
            "role": user["role"],
        }

    @staticmethod
    def list_users(db_path: Optional[str] = None) -> List[Dict[str, Any]]:
        """Lists all active and inactive users (without password hashes)."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                "SELECT id, username, full_name, role, is_active, created_at FROM users ORDER BY created_at ASC;"
            )
            return [dict(row) for row in cursor.fetchall()]

    @classmethod
    def bootstrap_admin_if_needed(cls, db_path: Optional[str] = None) -> Optional[str]:
        """
        Secure Bootstrap Procedure:
        1. If users already exist, does nothing.
        2. If DARSHINI_BOOTSTRAP_ADMIN_USERNAME & DARSHINI_BOOTSTRAP_ADMIN_PASSWORD are set in env,
           creates the initial admin account using those credentials.
        3. Otherwise, generates a secure, random one-time setup token saved to DATA_DIR / .bootstrap_token
           and logs instructions for the administrator to complete setup via /api/v1/auth/setup-admin.
        """
        if cls.get_user_count(db_path) > 0:
            return None

        env_user = os.getenv("DARSHINI_BOOTSTRAP_ADMIN_USERNAME")
        env_pass = os.getenv("DARSHINI_BOOTSTRAP_ADMIN_PASSWORD")

        if env_user and env_pass:
            cls.create_user(
                username=env_user,
                password=env_pass,
                full_name="System Administrator",
                role=ROLE_ADMIN,
                db_path=db_path,
            )
            logger.info("Bootstrapped initial admin '%s' from environment configuration.", env_user)
            return None

        # Generate one-time setup token
        token = secrets.token_hex(24)
        try:
            BOOTSTRAP_TOKEN_FILE.write_text(token, encoding="utf-8")
            BOOTSTRAP_TOKEN_FILE.chmod(0o600)
            logger.warning(
                "=== INITIAL ADMIN SETUP REQUIRED ===\n"
                "No users exist in the database. Complete one-time administrator setup using:\n"
                "Endpoint: POST /api/v1/auth/setup-admin\n"
                "Setup Token: %s\n"
                "Token saved to: %s\n"
                "====================================",
                token,
                BOOTSTRAP_TOKEN_FILE,
            )
        except Exception as e:
            logger.error("Failed to persist bootstrap token: %s", e)
        return token

    @classmethod
    def verify_and_consume_bootstrap_token(cls, token: str) -> bool:
        """Verifies the one-time admin setup token and invalidates it."""
        if not BOOTSTRAP_TOKEN_FILE.exists():
            return False
        try:
            stored_token = BOOTSTRAP_TOKEN_FILE.read_text(encoding="utf-8").strip()
            if secrets.compare_digest(token.strip(), stored_token):
                BOOTSTRAP_TOKEN_FILE.unlink(missing_ok=True)
                return True
        except Exception as e:
            logger.error("Error checking bootstrap token: %s", e)
        return False
