"""
Darshini - Real-Time Location Stream Service
Provides session-paired WebSocket relay for streaming live GPS coordinates from mobile transmitters
to the desktop command center with coordinate boundary validation and ephemeral session management.
"""

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set
from fastapi import WebSocket

logger = logging.getLogger("darshini.location_stream")


class LocationSession:
    def __init__(self, session_id: str, token: str):
        self.session_id = session_id
        self.token = token
        self.created_at = time.time()
        self.broadcaster: Optional[WebSocket] = None
        self.subscribers: Set[WebSocket] = set()
        self.last_update: Optional[Dict[str, Any]] = None

    def is_expired(self, max_idle_sec: float = 7200) -> bool:
        """Sessions expire after 2 hours if all clients have disconnected."""
        return (time.time() - self.created_at) > max_idle_sec and not self.broadcaster and not self.subscribers


class LocationStreamManager:
    def __init__(self):
        self._sessions: Dict[str, LocationSession] = {}
        self._lock = asyncio.Lock()

    async def create_session(self) -> Dict[str, str]:
        """Creates an ephemeral pairing session with a human-readable 6-character pairing code."""
        async with self._lock:
            # 6-character uppercase session code (e.g., DAR-4829)
            raw_id = uuid.uuid4().hex[:6].upper()
            session_id = f"DAR-{raw_id}"
            token = uuid.uuid4().hex[:12]
            self._sessions[session_id] = LocationSession(session_id, token)
            self._cleanup_expired()
            logger.info("Created location pairing session: %s", session_id)
            return {"session_id": session_id, "token": token}

    def get_session(self, session_id: str) -> Optional[LocationSession]:
        return self._sessions.get(session_id)

    @staticmethod
    def validate_coordinates(lat: Any, lng: Any, accuracy: Any) -> bool:
        """Validates that coordinates are finite numbers within physical geographic boundaries."""
        try:
            f_lat = float(lat)
            f_lng = float(lng)
            f_acc = float(accuracy)
            if not (-90.0 <= f_lat <= 90.0 and -180.0 <= f_lng <= 180.0 and f_acc >= 0.0):
                return False
            return True
        except (ValueError, TypeError):
            return False

    def remove_session(self, session_id: str):
        with self._sessions:
            self._sessions.pop(session_id, None)

    def _cleanup_expired(self):
        expired = [sid for sid, s in self._sessions.items() if s.is_expired()]
        for sid in expired:
            self._sessions.pop(sid, None)
            logger.info("Cleaned up expired location session: %s", sid)


location_stream_manager = LocationStreamManager()
