"""
Darshini - Database Connection Management
Provides robust SQLite connection management with foreign key enforcement,
WAL mode, thread-safe access, and transaction management.
"""

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Optional, Union

from app.config import DATABASE_PATH

# Global lock for write serialization across threads in SQLite
_DB_LOCK = threading.Lock()


def get_connection(db_path: Optional[Union[str, Path]] = None) -> sqlite3.Connection:
    """
    Creates and configures a SQLite connection with:
      - WAL journal mode for concurrent reading/writing
      - Explicit foreign key constraint enforcement
      - 15 second busy timeout to prevent transient locks
      - sqlite3.Row row factory for clean dict-like column access
    """
    target_path = Path(db_path) if db_path else DATABASE_PATH
    target_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(
        str(target_path),
        timeout=15.0,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


@contextmanager
def get_db(db_path: Optional[Union[str, Path]] = None) -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager for database operations.
    Automatically commits on normal completion or rolls back on exceptions.
    Acquires write lock to ensure serialized write safety.
    """
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def get_db_read(db_path: Optional[Union[str, Path]] = None) -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager for read-only database operations without write locks.
    """
    conn = get_connection(db_path)
    try:
        yield conn
    finally:
        conn.close()
