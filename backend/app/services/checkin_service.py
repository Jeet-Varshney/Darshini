"""
Darshini - Gate Check-in Service
Handles physical pass verification, idempotent turnstile entry recording,
operator audit trails, and check-in reversals.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.db.database import get_db, get_db_read

logger = logging.getLogger("darshini.checkin_service")


class CheckinService:
    """Manages physical attendee verification and admission records."""

    @classmethod
    def checkin_attendee(
        cls,
        event_id: str,
        operator_id: str,
        registration_code: Optional[str] = None,
        registration_id: Optional[str] = None,
        gate_terminal: str = "GATE_1",
        method: str = "OPERATOR_SCAN",
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Executes an authorized check-in.
        Validates:
          1. Registration exists.
          2. Registration belongs to this exact event (rejects wrong-event passes).
          3. Registration is not cancelled.
          4. Idempotently handles already checked-in attendees.
        Records:
          - Check-in timestamp and operator ID.
          - Updates registration status to 'CHECKED_IN'.
        """
        if not registration_code and not registration_id:
            raise ValueError("Must provide either registration_code or registration_id.")

        with get_db(db_path) as conn:
            # 1. Fetch registration and event
            if registration_code:
                cursor = conn.execute(
                    """
                    SELECT r.id, r.event_id, r.attendee_name, r.phone_masked, r.status,
                           e.name AS event_name, e.status AS event_status
                    FROM event_registrations r
                    JOIN events e ON e.id = r.event_id
                    WHERE r.registration_code = ?;
                    """,
                    (registration_code.upper().strip(),),
                )
            else:
                cursor = conn.execute(
                    """
                    SELECT r.id, r.event_id, r.attendee_name, r.phone_masked, r.status,
                           e.name AS event_name, e.status AS event_status
                    FROM event_registrations r
                    JOIN events e ON e.id = r.event_id
                    WHERE r.id = ?;
                    """,
                    (registration_id,),
                )

            reg = cursor.fetchone()
            if not reg:
                raise KeyError("Invalid registration pass. Record not found.")

            # 2. Check if pass belongs to another event
            if reg["event_id"] != event_id:
                # Fetch actual event name for clear error messaging
                other_event_name = reg["event_name"]
                raise PermissionError(
                    f"Wrong Event! This pass is registered for '{other_event_name}', not this event."
                )

            # 3. Check if cancelled
            if reg["status"] == "CANCELLED":
                raise ValueError("This registration has been cancelled and cannot be checked in.")

            # 4. Check if already checked in (Idempotency check)
            cursor = conn.execute(
                """
                SELECT id, checked_in_at, operator_id, gate_terminal
                FROM event_checkins
                WHERE registration_id = ? AND is_active = 1;
                """,
                (reg["id"],),
            )
            existing_checkin = cursor.fetchone()
            if existing_checkin:
                # Fetch operator username
                op_cursor = conn.execute("SELECT username FROM users WHERE id = ?;", (existing_checkin["operator_id"],))
                op_row = op_cursor.fetchone()
                op_name = op_row["username"] if op_row else "staff"

                return {
                    "checkin_id": existing_checkin["id"],
                    "registration_id": reg["id"],
                    "attendee_name": reg["attendee_name"],
                    "event_id": event_id,
                    "event_name": reg["event_name"],
                    "status": "ALREADY_CHECKED_IN",
                    "checked_in_at": existing_checkin["checked_in_at"],
                    "operator_name": op_name,
                    "gate_terminal": existing_checkin["gate_terminal"],
                    "message": f"Attendee was already checked in at {existing_checkin['checked_in_at']}",
                }

            # 5. Execute new check-in
            checkin_id = str(uuid.uuid4())
            now_utc = datetime.now(timezone.utc).isoformat()

            # Record check-in
            conn.execute(
                """
                INSERT INTO event_checkins (
                    id, registration_id, event_id, checked_in_at,
                    method, operator_id, gate_terminal, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1);
                """,
                (checkin_id, reg["id"], event_id, now_utc, method, operator_id, gate_terminal),
            )

            # Update registration record status
            conn.execute(
                "UPDATE event_registrations SET status = 'CHECKED_IN' WHERE id = ?;",
                (reg["id"],),
            )

            # Audit log
            conn.execute(
                """
                INSERT INTO audit_logs (id, actor_id, actor_role, action, target_entity, target_id, details, timestamp)
                VALUES (?, ?, 'STAFF', 'CHECKIN', 'event_registrations', ?, ?, ?);
                """,
                (
                    str(uuid.uuid4()),
                    operator_id,
                    reg["id"],
                    f'{{"event_id": "{event_id}", "terminal": "{gate_terminal}", "method": "{method}"}}',
                    now_utc,
                ),
            )

        # Get operator username for response
        with get_db_read(db_path) as conn:
            op_cursor = conn.execute("SELECT username FROM users WHERE id = ?;", (operator_id,))
            op_row = op_cursor.fetchone()
            op_name = op_row["username"] if op_row else "staff"

        logger.info(
            "Checked in attendee '%s' (Reg ID: %s) for event '%s' at %s by operator %s",
            reg["attendee_name"],
            reg["id"],
            event_id,
            gate_terminal,
            op_name,
        )

        return {
            "checkin_id": checkin_id,
            "registration_id": reg["id"],
            "attendee_name": reg["attendee_name"],
            "event_id": event_id,
            "event_name": reg["event_name"],
            "status": "CHECKED_IN",
            "checked_in_at": now_utc,
            "operator_name": op_name,
            "gate_terminal": gate_terminal,
            "message": "Check-in successful. Attendee admitted.",
        }

    @classmethod
    def reverse_checkin(
        cls,
        checkin_id: str,
        reversal_reason: str,
        reversed_by: str,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Reverses a check-in record.
        Marks check-in as inactive and resets registration status to 'REGISTERED'.
        This immediately removes the attendee from future emergency SMS alert recipient snapshots.
        """
        now_utc = datetime.now(timezone.utc).isoformat()
        with get_db(db_path) as conn:
            cursor = conn.execute(
                "SELECT id, registration_id, event_id, is_active FROM event_checkins WHERE id = ?;",
                (checkin_id,),
            )
            checkin = cursor.fetchone()
            if not checkin:
                raise KeyError(f"Check-in record '{checkin_id}' not found.")
            if not checkin["is_active"]:
                raise ValueError("Check-in is already reversed.")

            conn.execute(
                """
                UPDATE event_checkins 
                SET is_active = 0, reversal_reason = ?, reversed_at = ?, reversed_by = ?
                WHERE id = ?;
                """,
                (reversal_reason.strip(), now_utc, reversed_by, checkin_id),
            )

            conn.execute(
                "UPDATE event_registrations SET status = 'REGISTERED' WHERE id = ?;",
                (checkin["registration_id"],),
            )

            # Audit log
            conn.execute(
                """
                INSERT INTO audit_logs (id, actor_id, actor_role, action, target_entity, target_id, details, timestamp)
                VALUES (?, ?, 'MANAGER', 'REVERSE_CHECKIN', 'event_checkins', ?, ?, ?);
                """,
                (
                    str(uuid.uuid4()),
                    reversed_by,
                    checkin_id,
                    f'{{"reason": "{reversal_reason.strip()}", "reg_id": "{checkin["registration_id"]}"}}',
                    now_utc,
                ),
            )

        logger.info("Reversed check-in %s by %s. Reason: %s", checkin_id, reversed_by, reversal_reason)
        return {
            "checkin_id": checkin_id,
            "status": "REVERSED",
            "reversal_reason": reversal_reason.strip(),
            "reversed_at": now_utc,
        }

    @classmethod
    def list_checkins_for_event(
        cls,
        event_id: str,
        db_path: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Lists active check-ins for an event with attendee and operator details."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT 
                    c.id AS checkin_id, c.registration_id, c.checked_in_at, c.gate_terminal, c.method, c.is_active,
                    r.attendee_name, r.phone_masked, r.registration_code,
                    u.username AS operator_name
                FROM event_checkins c
                JOIN event_registrations r ON r.id = c.registration_id
                JOIN users u ON u.id = c.operator_id
                WHERE c.event_id = ? AND c.is_active = 1
                ORDER BY c.checked_in_at DESC;
                """,
                (event_id,),
            )
            return [dict(row) for row in cursor.fetchall()]
