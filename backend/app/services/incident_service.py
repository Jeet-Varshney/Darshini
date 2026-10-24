"""
Darshini - Safety Incident Management & Audit Service
Manages incident lifecycle (OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED),
immutable timeline history, real analytics, and formula-injection-safe CSV exports.
"""

import csv
import io
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.db.database import get_db, get_db_read
from app.schemas_incidents import (
    IncidentCreateRequest,
    IncidentHistoryRecord,
    IncidentRecord,
    IncidentSummaryMetrics,
    IncidentUpdateRequest,
)

logger = logging.getLogger("darshini.incident_service")

VALID_STATUSES = {"OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"}
VALID_SEVERITIES = {"CRITICAL", "WARNING", "ADVISORY", "INFO"}
VALID_CATEGORIES = {
    "CROWD_DENSITY",
    "PERIMETER_BREACH",
    "MEDICAL",
    "FIRE_HAZARD",
    "INFRASTRUCTURE",
    "LOST_PERSON",
    "OPERATIONAL",
}


def sanitize_csv_cell(value: Any) -> str:
    """
    Guards against CSV Formula Injection (CWE-1236).
    Prepends a single quote if string begins with =, +, -, @, tab, or carriage return.
    """
    if value is None:
        return ""
    s = str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{s}"
    return s.strip()


class IncidentService:
    """Handles safety incidents, operational transitions, timeline auditing, and metrics."""

    @classmethod
    def _generate_incident_number(cls, conn) -> str:
        """Generates sequential incident identifier: e.g. INC-2026-0001."""
        year = datetime.now(timezone.utc).year
        cursor = conn.execute("SELECT COUNT(*) AS total FROM incidents;")
        count = cursor.fetchone()["total"] + 1
        return f"INC-{year}-{count:04d}"

    @classmethod
    def create_incident(
        cls,
        data: IncidentCreateRequest,
        reported_by: str,
        db_path: Optional[str] = None,
    ) -> IncidentRecord:
        """Creates a new safety incident and records initial audit history."""
        sev = data.severity.upper().strip()
        cat = data.category.upper().strip()

        if sev not in VALID_SEVERITIES:
            raise ValueError(f"Invalid severity '{data.severity}'. Must be one of {VALID_SEVERITIES}")
        if cat not in VALID_CATEGORIES:
            raise ValueError(f"Invalid category '{data.category}'. Must be one of {VALID_CATEGORIES}")

        incident_id = str(uuid.uuid4())
        now_utc = datetime.now(timezone.utc).isoformat()
        history_id = str(uuid.uuid4())

        with get_db(db_path) as conn:
            inc_number = cls._generate_incident_number(conn)

            conn.execute(
                """
                INSERT INTO incidents (
                    id, incident_number, title, description, severity, category,
                    status, zone_id, zone_name, camera_id, event_id, related_edge_id,
                    source, reported_by, assigned_to, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?);
                """,
                (
                    incident_id,
                    inc_number,
                    data.title.strip(),
                    data.description.strip(),
                    sev,
                    cat,
                    data.zone_id,
                    data.zone_name,
                    data.camera_id,
                    data.event_id,
                    data.related_edge_id,
                    data.source,
                    reported_by,
                    now_utc,
                    now_utc,
                ),
            )

            conn.execute(
                """
                INSERT INTO incident_history (
                    id, incident_id, action, previous_status, new_status,
                    operator_id, operator_username, note, timestamp
                ) VALUES (?, ?, 'CREATED', NULL, 'OPEN', NULL, ?, 'Incident logged into operational register.', ?);
                """,
                (history_id, incident_id, reported_by, now_utc),
            )

        logger.info("Created incident %s: '%s' (%s - %s)", inc_number, data.title, sev, cat)
        return cls.get_incident_by_id(incident_id, db_path=db_path)  # type: ignore

    @classmethod
    def get_incident_by_id(
        cls,
        incident_id: str,
        db_path: Optional[str] = None,
    ) -> Optional[IncidentRecord]:
        """Retrieves incident along with complete timeline audit history."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute("SELECT * FROM incidents WHERE id = ?;", (incident_id,))
            row = cursor.fetchone()
            if not row:
                return None

            inc_dict = dict(row)

            # Fetch history records
            h_cursor = conn.execute(
                """
                SELECT id, incident_id, action, previous_status, new_status,
                       operator_id, operator_username, note, timestamp
                FROM incident_history
                WHERE incident_id = ?
                ORDER BY timestamp ASC;
                """,
                (incident_id,),
            )
            history = [IncidentHistoryRecord(**dict(h)) for h in h_cursor.fetchall()]
            inc_dict["history"] = history

            return IncidentRecord(**inc_dict)

    @classmethod
    def list_incidents(
        cls,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        category: Optional[str] = None,
        zone_id: Optional[str] = None,
        source: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        search: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> List[IncidentRecord]:
        """Queries incidents matching filters, ordered chronologically (newest first)."""
        query = "SELECT * FROM incidents WHERE 1=1"
        params = []

        if status:
            query += " AND status = ?"
            params.append(status.upper().strip())
        if severity:
            query += " AND severity = ?"
            params.append(severity.upper().strip())
        if category:
            query += " AND category = ?"
            params.append(category.upper().strip())
        if zone_id:
            query += " AND zone_id = ?"
            params.append(zone_id.strip())
        if source:
            query += " AND source = ?"
            params.append(source.upper().strip())
        if start_time:
            query += " AND created_at >= ?"
            params.append(start_time.strip())
        if end_time:
            query += " AND created_at <= ?"
            params.append(end_time.strip())
        if search:
            query += " AND (title LIKE ? OR description LIKE ? OR incident_number LIKE ?)"
            s = f"%{search.strip()}%"
            params.extend([s, s, s])

        query += " ORDER BY created_at DESC;"

        with get_db_read(db_path) as conn:
            cursor = conn.execute(query, tuple(params))
            return [IncidentRecord(**dict(row)) for row in cursor.fetchall()]

    @classmethod
    def transition_status(
        cls,
        incident_id: str,
        new_status: str,
        operator_username: str,
        operator_id: Optional[str] = None,
        note: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> IncidentRecord:
        """
        Transitions incident status and logs an immutable audit timeline event.
        Validates transitions: OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED.
        """
        status_clean = new_status.upper().strip()
        if status_clean not in VALID_STATUSES:
            raise ValueError(f"Invalid status '{new_status}'. Must be one of {VALID_STATUSES}")

        current = cls.get_incident_by_id(incident_id, db_path=db_path)
        if not current:
            raise KeyError(f"Incident '{incident_id}' not found.")

        if current.status == status_clean:
            return current

        now_utc = datetime.now(timezone.utc).isoformat()
        resolved_at = now_utc if status_clean == "RESOLVED" else current.resolved_at
        closed_at = now_utc if status_clean == "CLOSED" else current.closed_at
        history_id = str(uuid.uuid4())

        audit_note = note.strip() if note else f"Status updated from {current.status} to {status_clean}."

        with get_db(db_path) as conn:
            conn.execute(
                """
                UPDATE incidents
                SET status = ?, updated_at = ?, resolved_at = ?, closed_at = ?
                WHERE id = ?;
                """,
                (status_clean, now_utc, resolved_at, closed_at, incident_id),
            )

            conn.execute(
                """
                INSERT INTO incident_history (
                    id, incident_id, action, previous_status, new_status,
                    operator_id, operator_username, note, timestamp
                ) VALUES (?, ?, 'STATUS_CHANGE', ?, ?, ?, ?, ?, ?);
                """,
                (
                    history_id,
                    incident_id,
                    current.status,
                    status_clean,
                    operator_id,
                    operator_username,
                    audit_note,
                    now_utc,
                ),
            )

        logger.info("Incident %s transitioned: %s -> %s (by %s)", current.incident_number, current.status, status_clean, operator_username)
        return cls.get_incident_by_id(incident_id, db_path=db_path)  # type: ignore

    @classmethod
    def add_operator_note(
        cls,
        incident_id: str,
        note: str,
        operator_username: str,
        operator_id: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> IncidentRecord:
        """Appends an operational note to the incident timeline."""
        current = cls.get_incident_by_id(incident_id, db_path=db_path)
        if not current:
            raise KeyError(f"Incident '{incident_id}' not found.")

        now_utc = datetime.now(timezone.utc).isoformat()
        history_id = str(uuid.uuid4())

        with get_db(db_path) as conn:
            conn.execute(
                "UPDATE incidents SET updated_at = ? WHERE id = ?;",
                (now_utc, incident_id),
            )

            conn.execute(
                """
                INSERT INTO incident_history (
                    id, incident_id, action, previous_status, new_status,
                    operator_id, operator_username, note, timestamp
                ) VALUES (?, ?, 'NOTE_ADDED', ?, ?, ?, ?, ?, ?);
                """,
                (
                    history_id,
                    incident_id,
                    current.status,
                    current.status,
                    operator_id,
                    operator_username,
                    note.strip(),
                    now_utc,
                ),
            )

        return cls.get_incident_by_id(incident_id, db_path=db_path)  # type: ignore

    @classmethod
    def assign_incident(
        cls,
        incident_id: str,
        assigned_to: str,
        assigned_to_name: Optional[str] = None,
        operator_username: str = "Operator",
        operator_id: Optional[str] = None,
        note: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> IncidentRecord:
        """Assigns responsibility for an incident to an operator/staff and logs an audit record."""
        current = cls.get_incident_by_id(incident_id, db_path=db_path)
        if not current:
            raise KeyError(f"Incident '{incident_id}' not found.")

        now_utc = datetime.now(timezone.utc).isoformat()
        history_id = str(uuid.uuid4())
        assignee_label = assigned_to_name or assigned_to
        audit_note = f"Assigned to {assignee_label}: {note.strip()}" if note else f"Assigned incident responsibility to {assignee_label}."

        with get_db(db_path) as conn:
            conn.execute(
                """
                UPDATE incidents
                SET assigned_to = ?, assigned_to_name = ?, updated_at = ?
                WHERE id = ?;
                """,
                (assigned_to.strip(), assigned_to_name.strip() if assigned_to_name else assigned_to.strip(), now_utc, incident_id),
            )

            conn.execute(
                """
                INSERT INTO incident_history (
                    id, incident_id, action, previous_status, new_status,
                    operator_id, operator_username, note, timestamp
                ) VALUES (?, ?, 'ASSIGNED', ?, ?, ?, ?, ?, ?);
                """,
                (
                    history_id,
                    incident_id,
                    current.status,
                    current.status,
                    operator_id,
                    operator_username,
                    audit_note,
                    now_utc,
                ),
            )

        logger.info("Incident %s assigned to %s (by %s)", current.incident_number, assignee_label, operator_username)
        return cls.get_incident_by_id(incident_id, db_path=db_path)  # type: ignore

    @classmethod
    def get_summary_metrics(
        cls,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> IncidentSummaryMetrics:
        """Derives incident summary statistics directly from persisted database records."""
        where_clauses = ["1=1"]
        params = []
        if start_time:
            where_clauses.append("created_at >= ?")
            params.append(start_time.strip())
        if end_time:
            where_clauses.append("created_at <= ?")
            params.append(end_time.strip())

        where_sql = " AND ".join(where_clauses)

        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                f"""
                SELECT 
                    COUNT(*) AS total,
                    SUM(CASE WHEN status IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS') THEN 1 ELSE 0 END) AS active_count,
                    SUM(CASE WHEN status IN ('RESOLVED', 'CLOSED') THEN 1 ELSE 0 END) AS resolved_count
                FROM incidents
                WHERE {where_sql};
                """,
                tuple(params),
            )
            agg = cursor.fetchone()
            total = agg["total"] or 0
            active = agg["active_count"] or 0
            resolved = agg["resolved_count"] or 0

            # Severities
            cursor = conn.execute(
                f"SELECT severity, COUNT(*) AS count FROM incidents WHERE {where_sql} GROUP BY severity;",
                tuple(params),
            )
            sev_map = {row["severity"]: row["count"] for row in cursor.fetchall()}
            for s in VALID_SEVERITIES:
                sev_map.setdefault(s, 0)

            # Categories
            cursor = conn.execute(
                f"SELECT category, COUNT(*) AS count FROM incidents WHERE {where_sql} GROUP BY category;",
                tuple(params),
            )
            cat_map = {row["category"]: row["count"] for row in cursor.fetchall()}
            for c in VALID_CATEGORIES:
                cat_map.setdefault(c, 0)

            # Statuses
            cursor = conn.execute(
                f"SELECT status, COUNT(*) AS count FROM incidents WHERE {where_sql} GROUP BY status;",
                tuple(params),
            )
            stat_map = {row["status"]: row["count"] for row in cursor.fetchall()}
            for st in VALID_STATUSES:
                stat_map.setdefault(st, 0)

            # Avg resolution time (for incidents that have both created_at and resolved_at)
            cursor = conn.execute(
                f"""
                SELECT created_at, resolved_at 
                FROM incidents 
                WHERE status IN ('RESOLVED', 'CLOSED') AND resolved_at IS NOT NULL AND {where_sql};
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
            avg_minutes = None
            if rows:
                durations = []
                for r in rows:
                    try:
                        c_dt = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
                        r_dt = datetime.fromisoformat(r["resolved_at"].replace("Z", "+00:00"))
                        dur = (r_dt - c_dt).total_seconds() / 60.0
                        if dur >= 0:
                            durations.append(dur)
                    except Exception:
                        pass
                if durations:
                    avg_minutes = round(sum(durations) / len(durations), 1)

            return IncidentSummaryMetrics(
                total_incidents=total,
                active_incidents=active,
                resolved_incidents=resolved,
                severity_breakdown=sev_map,
                category_breakdown=cat_map,
                status_breakdown=stat_map,
                avg_resolution_time_minutes=avg_minutes,
            )

    @classmethod
    def export_csv(
        cls,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        category: Optional[str] = None,
        source: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        search: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> str:
        """
        Exports filtered incidents to a CSV string.
        Applies CWE-1236 Formula Injection sanitization on all output cells.
        """
        incidents = cls.list_incidents(
            status=status,
            severity=severity,
            category=category,
            source=source,
            start_time=start_time,
            end_time=end_time,
            search=search,
            db_path=db_path,
        )

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        # Header row
        writer.writerow([
            "Incident Number",
            "Title",
            "Severity",
            "Category",
            "Status",
            "Source",
            "Zone Name",
            "Assigned To",
            "Reported By",
            "Created At (UTC)",
            "Resolved At (UTC)",
            "Description",
        ])

        for inc in incidents:
            writer.writerow([
                sanitize_csv_cell(inc.incident_number),
                sanitize_csv_cell(inc.title),
                sanitize_csv_cell(inc.severity),
                sanitize_csv_cell(inc.category),
                sanitize_csv_cell(inc.status),
                sanitize_csv_cell(inc.source),
                sanitize_csv_cell(inc.zone_name or inc.zone_id or "General Precinct"),
                sanitize_csv_cell(inc.assigned_to_name or inc.assigned_to or "Unassigned"),
                sanitize_csv_cell(inc.reported_by),
                sanitize_csv_cell(inc.created_at),
                sanitize_csv_cell(inc.resolved_at or "N/A"),
                sanitize_csv_cell(inc.description),
            ])

        return output.getvalue()
