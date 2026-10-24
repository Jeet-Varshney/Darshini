"""
Darshini - Event Management Service
Handles event creation, lifecycle transitions (DRAFT -> PUBLISHED -> CLOSED -> ARCHIVED),
revocable QR token generation, and vector SVG QR rendering.
"""

import io
import logging
import re
import secrets
import urllib.parse
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pyqrcode

from app.config import PUBLIC_BASE_URL
from app.db.database import get_db, get_db_read
from app.schemas_events import EventCreateRequest, EventUpdateRequest

logger = logging.getLogger("darshini.event_service")

VALID_STATUSES = {"DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"}


def generate_qr_svg(url: str, scale: int = 4) -> str:
    """Renders a URL into a standalone, crisp SVG XML string."""
    try:
        qr = pyqrcode.create(url, error="M")
        buf = io.BytesIO()
        qr.svg(buf, scale=scale, quiet_zone=2)
        return buf.getvalue().decode("utf-8")
    except Exception as e:
        logger.error("Failed to generate QR SVG for %s: %s", url, e)
        # Fallback simple placeholder SVG
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f0f2f5"/><text x="50" y="55" font-size="10" text-anchor="middle" fill="#666">QR Error</text></svg>'


def slugify(text: str) -> str:
    """Normalizes string into a clean URL-friendly slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-") or "event"


class EventService:
    """Manages events, registration links, and QR security tokens."""

    @classmethod
    def create_event(
        cls,
        data: EventCreateRequest,
        creator_id: str,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Creates a new event with a unique slug and revocable registration token."""
        # Validate dates
        try:
            start_dt = datetime.fromisoformat(data.start_time.replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(data.end_time.replace("Z", "+00:00"))
            if end_dt <= start_dt:
                raise ValueError("End time must be after start time.")
        except Exception as e:
            raise ValueError(f"Invalid date format: {e}")

        event_id = str(uuid.uuid4())
        base_slug = slugify(data.slug if data.slug else data.name)
        qr_token = secrets.token_urlsafe(24)
        now_utc = datetime.now(timezone.utc).isoformat()

        with get_db(db_path) as conn:
            # Ensure unique slug
            slug = base_slug
            attempt = 1
            while True:
                cursor = conn.execute("SELECT id FROM events WHERE slug = ?;", (slug,))
                if not cursor.fetchone():
                    break
                attempt += 1
                slug = f"{base_slug}-{secrets.token_hex(2)}"

            conn.execute(
                """
                INSERT INTO events (
                    id, slug, name, description, venue_name, venue_zone_id,
                    start_time, end_time, max_capacity, status, qr_token,
                    created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?);
                """,
                (
                    event_id,
                    slug,
                    data.name.strip(),
                    data.description.strip(),
                    data.venue_name.strip(),
                    data.venue_zone_id,
                    data.start_time,
                    data.end_time,
                    max(0, data.max_capacity),
                    qr_token,
                    creator_id,
                    now_utc,
                    now_utc,
                ),
            )

        logger.info("Created event '%s' (Slug: %s, ID: %s)", data.name, slug, event_id)
        return cls.get_event_by_id(event_id, db_path=db_path)  # type: ignore

    @classmethod
    def update_event(
        cls,
        event_id: str,
        data: EventUpdateRequest,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Updates event metadata."""
        current = cls.get_event_by_id(event_id, db_path=db_path)
        if not current:
            raise KeyError(f"Event '{event_id}' not found.")

        updates = []
        params = []

        if data.name is not None:
            updates.append("name = ?")
            params.append(data.name.strip())
        if data.description is not None:
            updates.append("description = ?")
            params.append(data.description.strip())
        if data.venue_name is not None:
            updates.append("venue_name = ?")
            params.append(data.venue_name.strip())
        if data.venue_zone_id is not None:
            updates.append("venue_zone_id = ?")
            params.append(data.venue_zone_id)
        if data.start_time is not None:
            updates.append("start_time = ?")
            params.append(data.start_time)
        if data.end_time is not None:
            updates.append("end_time = ?")
            params.append(data.end_time)
        if data.max_capacity is not None:
            updates.append("max_capacity = ?")
            params.append(max(0, data.max_capacity))

        if not updates:
            return current

        now_utc = datetime.now(timezone.utc).isoformat()
        updates.append("updated_at = ?")
        params.append(now_utc)
        params.append(event_id)

        sql = f"UPDATE events SET {', '.join(updates)} WHERE id = ?;"
        with get_db(db_path) as conn:
            conn.execute(sql, tuple(params))

        return cls.get_event_by_id(event_id, db_path=db_path)  # type: ignore

    @classmethod
    def update_event_status(
        cls,
        event_id: str,
        status: str,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Transitions event lifecycle status."""
        status_clean = status.upper().strip()
        if status_clean not in VALID_STATUSES:
            raise ValueError(f"Invalid status '{status}'. Must be one of {VALID_STATUSES}")

        current = cls.get_event_by_id(event_id, db_path=db_path)
        if not current:
            raise KeyError(f"Event '{event_id}' not found.")

        now_utc = datetime.now(timezone.utc).isoformat()
        with get_db(db_path) as conn:
            conn.execute(
                "UPDATE events SET status = ?, updated_at = ? WHERE id = ?;",
                (status_clean, now_utc, event_id),
            )

        logger.info("Updated event '%s' status to %s", event_id, status_clean)
        return cls.get_event_by_id(event_id, db_path=db_path)  # type: ignore

    @classmethod
    def regenerate_qr_token(
        cls,
        event_id: str,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Revokes previous QR registration token and generates a fresh one."""
        current = cls.get_event_by_id(event_id, db_path=db_path)
        if not current:
            raise KeyError(f"Event '{event_id}' not found.")

        new_qr_token = secrets.token_urlsafe(24)
        now_utc = datetime.now(timezone.utc).isoformat()

        with get_db(db_path) as conn:
            conn.execute(
                "UPDATE events SET qr_token = ?, updated_at = ? WHERE id = ?;",
                (new_qr_token, now_utc, event_id),
            )

        logger.info("Regenerated QR token for event '%s'. Old token invalidated.", event_id)
        return cls.get_event_by_id(event_id, db_path=db_path)  # type: ignore

    @classmethod
    def get_event_by_id(
        cls,
        event_id: str,
        db_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieves full event details including registration and check-in counts."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT 
                    e.*,
                    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status != 'CANCELLED') AS registered_count,
                    (SELECT COUNT(*) FROM event_checkins c WHERE c.event_id = e.id AND c.is_active = 1) AS checked_in_count
                FROM events e
                WHERE e.id = ?;
                """,
                (event_id,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            return cls._format_event_row(dict(row))

    @classmethod
    def get_event_by_slug(
        cls,
        slug: str,
        db_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieves event by URL slug."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT 
                    e.*,
                    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status != 'CANCELLED') AS registered_count,
                    (SELECT COUNT(*) FROM event_checkins c WHERE c.event_id = e.id AND c.is_active = 1) AS checked_in_count
                FROM events e
                WHERE e.slug = ?;
                """,
                (slug.lower().strip(),),
            )
            row = cursor.fetchone()
            return cls._format_event_row(dict(row)) if row else None

    @classmethod
    def get_event_by_qr_token(
        cls,
        qr_token: str,
        db_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieves event by public revocable QR token."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT 
                    e.*,
                    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status != 'CANCELLED') AS registered_count,
                    (SELECT COUNT(*) FROM event_checkins c WHERE c.event_id = e.id AND c.is_active = 1) AS checked_in_count
                FROM events e
                WHERE e.qr_token = ?;
                """,
                (qr_token.strip(),),
            )
            row = cursor.fetchone()
            return cls._format_event_row(dict(row)) if row else None

    @classmethod
    def list_events(
        cls,
        status: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Lists events with counts, optionally filtered by lifecycle status."""
        query = """
            SELECT 
                e.*,
                (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status != 'CANCELLED') AS registered_count,
                (SELECT COUNT(*) FROM event_checkins c WHERE c.event_id = e.id AND c.is_active = 1) AS checked_in_count
            FROM events e
        """
        params = []
        if status:
            query += " WHERE e.status = ?"
            params.append(status.upper().strip())

        query += " ORDER BY e.created_at DESC;"

        with get_db_read(db_path) as conn:
            cursor = conn.execute(query, tuple(params))
            return [cls._format_event_row(dict(row)) for row in cursor.fetchall()]

    @classmethod
    def _format_event_row(cls, row: Dict[str, Any]) -> Dict[str, Any]:
        """Enriches raw database event dictionary with public registration URLs and QR SVG."""
        registration_url = f"{PUBLIC_BASE_URL}/?event={row['slug']}"
        # Also provide token-direct URL for QR scans
        qr_scan_url = f"{PUBLIC_BASE_URL}/?token={row['qr_token']}"
        
        qr_svg = generate_qr_svg(qr_scan_url)

        return {
            "id": row["id"],
            "slug": row["slug"],
            "name": row["name"],
            "description": row["description"],
            "venue_name": row["venue_name"],
            "venue_zone_id": row.get("venue_zone_id"),
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "max_capacity": row["max_capacity"],
            "status": row["status"],
            "qr_token": row["qr_token"],
            "registration_url": registration_url,
            "qr_scan_url": qr_scan_url,
            "qr_svg": qr_svg,
            "created_by": row["created_by"],
            "created_at": row["created_at"],
            "registered_count": row.get("registered_count", 0),
            "checked_in_count": row.get("checked_in_count", 0),
        }
