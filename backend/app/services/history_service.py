"""
Darshini - Detection History Storage Service
Persists genuine sampled computer-vision detection telemetry into SQLite.
Enforces sampling rate limits, configurable retention policy, and thread-safe operations.
"""

import os
import sqlite3
import threading
import time
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Union

from app.config import (
    DATABASE_PATH,
    DETECTION_HISTORY_MAX_RECORDS,
    DETECTION_HISTORY_MIN_INTERVAL_SEC,
)

logger = logging.getLogger("darshini.history")


class DetectionHistoryService:
    """
    Manages persistent SQLite storage of sampled detection observations.
    
    Guarantees:
      - Thread-safe parameterized queries and atomic commits.
      - Enforces minimum sampling intervals (default: 2.0s per camera source).
      - Applies bounded retention policy (pruning oldest samples exceeding max_records).
      - Zero unhandled exceptions: storage errors are logged and never crash caller.
      - Independent instance support for test isolation with custom db_path.
    """

    def __init__(
        self,
        db_path: Optional[Union[str, Path]] = None,
        max_records: int = DETECTION_HISTORY_MAX_RECORDS,
        min_interval_sec: float = DETECTION_HISTORY_MIN_INTERVAL_SEC,
    ):
        self.db_path = Path(db_path) if db_path else DATABASE_PATH
        self.max_records = max(10, max_records)
        self.min_interval_sec = max(0.0, min_interval_sec)

        self._lock = threading.Lock()
        self._last_sample_times: Dict[str, float] = {}

        # Ensure parent directory exists and initialize tables
        try:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            self._init_db()
        except Exception as e:
            logger.error("Failed to initialize detection history database at %s: %s", self.db_path, e)

    def _get_connection(self) -> sqlite3.Connection:
        """Creates a SQLite connection with WAL journal mode and row factory."""
        conn = sqlite3.connect(
            str(self.db_path),
            timeout=15.0,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self) -> None:
        """Creates detection_history table and performance indices if they do not exist."""
        with self._lock:
            with self._get_connection() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS detection_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TEXT NOT NULL,
                        camera_id TEXT NOT NULL,
                        camera_name TEXT NOT NULL,
                        zone_id TEXT,
                        zone_name TEXT,
                        person_count INTEGER NOT NULL,
                        stationary_count INTEGER,
                        moving_count INTEGER,
                        avg_confidence REAL,
                        inference_duration_ms REAL,
                        data_source TEXT NOT NULL,
                        created_at REAL NOT NULL
                    );
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_detection_history_timestamp ON detection_history(timestamp DESC);"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_detection_history_camera ON detection_history(camera_id, timestamp DESC);"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_detection_history_zone ON detection_history(zone_id, timestamp DESC);"
                )
                conn.commit()
        logger.info("Initialized detection history database schema at %s", self.db_path)

    def record_detection(
        self,
        camera_id: str,
        camera_name: str,
        person_count: int,
        zone_id: Optional[str] = None,
        zone_name: Optional[str] = None,
        stationary_count: Optional[int] = None,
        moving_count: Optional[int] = None,
        avg_confidence: Optional[float] = None,
        inference_duration_ms: Optional[float] = None,
        data_source: str = "LIVE_CAMERA_INFERENCE",
        timestamp: Optional[str] = None,
        epoch_time: Optional[float] = None,
    ) -> bool:
        """
        Records a sampled detection observation into SQLite.
        
        Enforces sampling interval: skips persistence if less than min_interval_sec
        has elapsed since the previous sample from the same camera_id.
        
        Returns:
            bool: True if sample was recorded, False if rate-limited or on error.
        """
        now_epoch = epoch_time if epoch_time is not None else time.time()
        now_iso = timestamp if timestamp else datetime.now(timezone.utc).isoformat()

        # 1. Deterministic rate-limiting per camera/source
        with self._lock:
            last_time = self._last_sample_times.get(camera_id, 0.0)
            if (now_epoch - last_time) < self.min_interval_sec:
                # Within sampling rate-limit window; skip quietly
                return False

            self._last_sample_times[camera_id] = now_epoch

        # 2. Parameterized insertion and retention pruning
        try:
            with self._lock:
                with self._get_connection() as conn:
                    conn.execute(
                        """
                        INSERT INTO detection_history (
                            timestamp, camera_id, camera_name, zone_id, zone_name,
                            person_count, stationary_count, moving_count, avg_confidence,
                            inference_duration_ms, data_source, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                        """,
                        (
                            now_iso,
                            str(camera_id),
                            str(camera_name),
                            zone_id,
                            zone_name,
                            int(person_count),
                            int(stationary_count) if stationary_count is not None else None,
                            int(moving_count) if moving_count is not None else None,
                            round(float(avg_confidence), 4) if avg_confidence is not None else None,
                            round(float(inference_duration_ms), 1) if inference_duration_ms is not None else None,
                            str(data_source),
                            float(now_epoch),
                        ),
                    )

                    # 3. Retention pruning: Keep at most max_records
                    conn.execute(
                        """
                        DELETE FROM detection_history
                        WHERE id NOT IN (
                            SELECT id FROM detection_history
                            ORDER BY timestamp DESC, id DESC
                            LIMIT ?
                        );
                        """,
                        (self.max_records,),
                    )
                    conn.commit()

            logger.debug(
                "Persisted detection sample for '%s' (pax=%d, zone=%s, dt=%.1fms)",
                camera_id,
                person_count,
                zone_id,
                inference_duration_ms or 0.0,
            )
            return True

        except Exception as e:
            logger.error("Failed to record detection history for '%s': %s", camera_id, e)
            return False

    def query_history(
        self,
        camera_id: Optional[str] = None,
        zone_id: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 50,
        order: str = "desc",
    ) -> List[Dict[str, Any]]:
        """
        Queries chronological detection history with optional filters.
        
        Uses parameterized SQL queries to prevent injection.
        Returns a list of dictionaries matching DetectionHistoryRecord schema.
        """
        limit = max(1, min(limit, 500))
        sort_order = "ASC" if str(order).lower() == "asc" else "DESC"

        conditions: List[str] = []
        params: List[Any] = []

        if camera_id:
            conditions.append("(camera_id = ? OR camera_name = ?)")
            params.extend([camera_id, camera_id])

        if zone_id:
            conditions.append("zone_id = ?")
            params.append(zone_id)

        if start_time:
            conditions.append("timestamp >= ?")
            params.append(start_time)

        if end_time:
            conditions.append("timestamp <= ?")
            params.append(end_time)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"""
            SELECT id, timestamp, camera_id, camera_name, zone_id, zone_name,
                   person_count, stationary_count, moving_count, avg_confidence,
                   inference_duration_ms, data_source
            FROM detection_history
            {where_clause}
            ORDER BY timestamp {sort_order}, id {sort_order}
            LIMIT ?;
        """
        params.append(limit)

        try:
            with self._lock:
                with self._get_connection() as conn:
                    cursor = conn.execute(query, params)
                    rows = cursor.fetchall()
                    return [dict(row) for row in rows]
        except Exception as e:
            logger.error("Failed to query detection history: %s", e)
            return []

    def count_records(self, camera_id: Optional[str] = None, zone_id: Optional[str] = None) -> int:
        """Returns count of matching records in detection_history."""
        conditions: List[str] = []
        params: List[Any] = []

        if camera_id:
            conditions.append("(camera_id = ? OR camera_name = ?)")
            params.extend([camera_id, camera_id])
        if zone_id:
            conditions.append("zone_id = ?")
            params.append(zone_id)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"SELECT COUNT(*) FROM detection_history {where_clause};"

        try:
            with self._lock:
                with self._get_connection() as conn:
                    cursor = conn.execute(query, params)
                    row = cursor.fetchone()
                    return int(row[0]) if row else 0
        except Exception as e:
            logger.error("Failed to count detection history records: %s", e)
            return 0

    def clear_history(self) -> int:
        """Deletes all detection history records. Primarily used for isolated test resets."""
        try:
            with self._lock:
                with self._get_connection() as conn:
                    cursor = conn.execute("DELETE FROM detection_history;")
                    deleted = cursor.rowcount
                    conn.commit()
                self._last_sample_times.clear()
            logger.info("Cleared %d detection history records.", deleted)
            return deleted
        except Exception as e:
            logger.error("Failed to clear detection history: %s", e)
            return 0


# Singleton service instance configured with project settings
detection_history_service = DetectionHistoryService()
