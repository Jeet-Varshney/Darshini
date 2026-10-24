"""
Darshini - Targeted Emergency SMS Alert Service
Implements exact-event recipient selection, atomic snapshot freezing,
two-person approval for critical alerts, and delivery status tracking.
"""

import asyncio
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.config import SMS_PROVIDER
from app.db.database import get_db, get_db_read
from app.schemas_events import AlertCreateRequest, AlertPreviewRequest
from app.services.sms.mock_provider import MockSmsProvider
from app.services.sms.provider_interface import (
    SmsDeliveryResult,
    SmsMessage,
    SmsProviderInterface,
)
from app.services.sms.twilio_provider import TwilioSmsProvider

logger = logging.getLogger("darshini.alert_service")

# Global singleton provider instance
_DEFAULT_MOCK_PROVIDER = MockSmsProvider()


def get_sms_provider() -> SmsProviderInterface:
    """Returns the configured SMS provider instance based on environment settings."""
    if SMS_PROVIDER == "twilio":
        return TwilioSmsProvider()
    return _DEFAULT_MOCK_PROVIDER


class AlertService:
    """Manages emergency alert creation, approvals, targeted recipient snapshotting, and dispatch."""

    @classmethod
    def preview_recipients(
        cls,
        event_id: str,
        data: AlertPreviewRequest,
        alert_id: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Calculates prospective recipient counts for an event without side effects.
        Filters:
          - Only checked-in attendees of THIS exact event.
          - Excludes cancelled, reversed check-ins, and opted-out users.
        """
        with get_db_read(db_path) as conn:
            # 1. Fetch event
            cursor = conn.execute("SELECT id, name, status FROM events WHERE id = ?;", (event_id,))
            ev = cursor.fetchone()
            if not ev:
                raise KeyError(f"Event '{event_id}' not found.")

            # 2. Total active check-ins
            cursor = conn.execute(
                "SELECT COUNT(*) AS total FROM event_checkins WHERE event_id = ? AND is_active = 1;",
                (event_id,),
            )
            currently_checked_in = cursor.fetchone()["total"]

            # 3. Eligible checked-in attendees
            cursor = conn.execute(
                """
                SELECT COUNT(DISTINCT r.id) AS eligible
                FROM event_registrations r
                JOIN event_checkins c ON c.registration_id = r.id AND c.is_active = 1
                WHERE r.event_id = ? 
                  AND r.status = 'CHECKED_IN'
                  AND r.opt_out_sms = 0;
                """,
                (event_id,),
            )
            eligible_recipients = cursor.fetchone()["eligible"]

            # 4. Opted-out checked-in attendees
            cursor = conn.execute(
                """
                SELECT COUNT(DISTINCT r.id) AS opted_out
                FROM event_registrations r
                JOIN event_checkins c ON c.registration_id = r.id AND c.is_active = 1
                WHERE r.event_id = ? 
                  AND r.status = 'CHECKED_IN'
                  AND r.opt_out_sms = 1;
                """,
                (event_id,),
            )
            opted_out_count = cursor.fetchone()["opted_out"]

            # 5. Already alerted for this alert_id (if existing)
            already_alerted_count = 0
            if alert_id:
                cursor = conn.execute(
                    "SELECT COUNT(*) AS sent FROM sms_deliveries WHERE alert_id = ?;",
                    (alert_id,),
                )
                already_alerted_count = cursor.fetchone()["sent"]

            # 6. GSM segment estimation (160 characters per SMS segment)
            msg_len = len(data.message_body)
            segments = max(1, math.ceil(msg_len / 160)) if msg_len > 0 else 1

            return {
                "event_id": event_id,
                "event_name": ev["name"],
                "currently_checked_in": currently_checked_in,
                "eligible_recipients": eligible_recipients,
                "opted_out_count": opted_out_count,
                "already_alerted_count": already_alerted_count,
                "estimated_sms_segments": segments,
            }

    @classmethod
    def compose_alert(
        cls,
        event_id: str,
        data: AlertCreateRequest,
        creator_id: str,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Creates a new draft emergency alert record.
        If severity is CRITICAL, sets status to PENDING_APPROVAL (triggers 2-person approval).
        """
        severity = data.severity.upper().strip()
        if severity not in {"INFO", "WARNING", "CRITICAL"}:
            raise ValueError("Severity must be INFO, WARNING, or CRITICAL.")

        with get_db(db_path) as conn:
            cursor = conn.execute("SELECT id, status FROM events WHERE id = ?;", (event_id,))
            ev = cursor.fetchone()
            if not ev:
                raise KeyError(f"Event '{event_id}' not found.")
            if ev["status"] not in {"PUBLISHED", "CLOSED"}:
                raise ValueError("Alerts can only be created for published or active events.")

            alert_id = str(uuid.uuid4())
            now_utc = datetime.now(timezone.utc).isoformat()
            initial_status = "PENDING_APPROVAL" if severity == "CRITICAL" else "DRAFT"

            conn.execute(
                """
                INSERT INTO event_alerts (
                    id, event_id, title, message_body, severity, alert_category,
                    lifecycle_status, created_by, approved_by, created_at,
                    eligible_recipient_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0);
                """,
                (
                    alert_id,
                    event_id,
                    data.title.strip(),
                    data.message_body.strip(),
                    severity,
                    data.alert_category.upper().strip(),
                    initial_status,
                    creator_id,
                    now_utc,
                ),
            )

        logger.info("Composed alert '%s' for event '%s' (Severity: %s, Status: %s)", data.title, event_id, severity, initial_status)
        return cls.get_alert_by_id(alert_id, db_path=db_path)  # type: ignore

    @classmethod
    def approve_alert(
        cls,
        alert_id: str,
        approver_id: str,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Enforces two-person administrative approval for critical alerts.
        Approver cannot be the same user who created the alert.
        """
        with get_db(db_path) as conn:
            cursor = conn.execute(
                "SELECT id, severity, created_by, lifecycle_status FROM event_alerts WHERE id = ?;",
                (alert_id,),
            )
            alert = cursor.fetchone()
            if not alert:
                raise KeyError(f"Alert '{alert_id}' not found.")

            if alert["lifecycle_status"] not in {"DRAFT", "PENDING_APPROVAL"}:
                raise ValueError(f"Alert cannot be approved in state '{alert['lifecycle_status']}'.")

            # Mandatory 2-person approval rule for critical emergency alerts
            if alert["severity"] == "CRITICAL" and alert["created_by"] == approver_id:
                raise PermissionError(
                    "Two-person rule violation: Critical evacuation and emergency alerts must be approved by a different administrator."
                )

            conn.execute(
                "UPDATE event_alerts SET lifecycle_status = 'APPROVED', approved_by = ? WHERE id = ?;",
                (approver_id, alert_id),
            )

        logger.info("Alert %s approved by %s", alert_id, approver_id)
        return cls.get_alert_by_id(alert_id, db_path=db_path)  # type: ignore

    @classmethod
    def dispatch_alert(
        cls,
        alert_id: str,
        dispatcher_id: str,
        provider: Optional[SmsProviderInterface] = None,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Dispatches targeted emergency SMS alerts to eligible checked-in attendees.
        
        Guarantees:
          1. Atomically freezes recipient pool at dispatch time (T0).
          2. Enforces 100% strict check-in eligibility: only attendees checked into THIS exact event.
          3. Enforces 2-person approval if CRITICAL.
          4. Never sends duplicate messages (idempotency key alert_id:registration_id).
          5. Dispatches via provider and tracks delivery states.
        """
        active_provider = provider or get_sms_provider()
        now_utc = datetime.now(timezone.utc).isoformat()
        queued_records: List[Dict[str, Any]] = []

        # -------------------------------------------------------------
        # STEP 1: Atomic Transaction - Freeze Recipient Snapshot
        # -------------------------------------------------------------
        with get_db(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT a.id, a.event_id, a.title, a.message_body, a.severity, a.lifecycle_status,
                       a.created_by, a.approved_by, e.name AS event_name
                FROM event_alerts a
                JOIN events e ON e.id = a.event_id
                WHERE a.id = ?;
                """,
                (alert_id,),
            )
            alert = cursor.fetchone()
            if not alert:
                raise KeyError(f"Alert '{alert_id}' not found.")

            # Validate lifecycle
            if alert["severity"] == "CRITICAL" and alert["lifecycle_status"] != "APPROVED":
                raise PermissionError(
                    "Critical alert dispatch aborted: Alert has not received required second-person approval."
                )
            if alert["lifecycle_status"] in {"QUEUED", "SENDING", "COMPLETED"}:
                raise ValueError(f"Alert has already been dispatched (Status: {alert['lifecycle_status']}).")

            event_id = alert["event_id"]

            # Query exact-event eligible recipients
            cursor = conn.execute(
                """
                SELECT DISTINCT r.id AS registration_id, r.phone_number_e164, r.phone_masked
                FROM event_registrations r
                JOIN event_checkins c ON c.registration_id = r.id AND c.is_active = 1
                WHERE r.event_id = ?
                  AND r.status = 'CHECKED_IN'
                  AND r.opt_out_sms = 0
                  AND r.id NOT IN (
                      SELECT registration_id FROM sms_deliveries WHERE alert_id = ?
                  );
                """,
                (event_id, alert_id),
            )
            eligible_attendees = cursor.fetchall()
            eligible_count = len(eligible_attendees)

            # Insert delivery queue records
            for row in eligible_attendees:
                delivery_id = str(uuid.uuid4())
                idempotency_key = f"{alert_id}:{row['registration_id']}"
                conn.execute(
                    """
                    INSERT INTO sms_deliveries (
                        id, alert_id, registration_id, event_id, recipient_phone_e164,
                        recipient_phone_masked, idempotency_key, status, provider_name,
                        attempt_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, 0, ?);
                    """,
                    (
                        delivery_id,
                        alert_id,
                        row["registration_id"],
                        event_id,
                        row["phone_number_e164"],
                        row["phone_masked"],
                        idempotency_key,
                        active_provider.get_provider_name(),
                        now_utc,
                    ),
                )
                queued_records.append({
                    "delivery_id": delivery_id,
                    "phone_e164": row["phone_number_e164"],
                    "phone_masked": row["phone_masked"],
                    "idempotency_key": idempotency_key,
                })

            # Update alert state to QUEUED
            conn.execute(
                """
                UPDATE event_alerts 
                SET lifecycle_status = 'QUEUED', eligible_recipient_count = ?, dispatched_at = ?
                WHERE id = ?;
                """,
                (eligible_count, now_utc, alert_id),
            )

            # Audit record
            conn.execute(
                """
                INSERT INTO audit_logs (id, actor_id, actor_role, action, target_entity, target_id, details, timestamp)
                VALUES (?, ?, 'MANAGER', 'DISPATCH_ALERT', 'event_alerts', ?, ?, ?);
                """,
                (
                    str(uuid.uuid4()),
                    dispatcher_id,
                    alert_id,
                    f'{{"event_id": "{event_id}", "recipients_queued": {eligible_count}, "provider": "{active_provider.get_provider_name()}"}}',
                    now_utc,
                ),
            )

        logger.info(
            "Froze recipient snapshot for alert %s (%s). %d recipients queued for event %s.",
            alert_id,
            alert["title"],
            len(queued_records),
            event_id,
        )

        # -------------------------------------------------------------
        # STEP 2: Worker Dispatch through SMS Provider
        # -------------------------------------------------------------
        success_count = 0
        failure_count = 0

        for item in queued_records:
            msg = SmsMessage(
                recipient_phone_e164=item["phone_e164"],
                recipient_phone_masked=item["phone_masked"],
                message_body=alert["message_body"],
                idempotency_key=item["idempotency_key"],
                event_id=event_id,
                alert_id=alert_id,
                severity=alert["severity"],
            )

            result = active_provider.send_sms(msg)
            sent_time = datetime.now(timezone.utc).isoformat()

            with get_db(db_path) as conn:
                conn.execute(
                    """
                    UPDATE sms_deliveries
                    SET status = ?, provider_message_id = ?, last_error = ?,
                        attempt_count = attempt_count + 1, sent_at = ?
                    WHERE id = ?;
                    """,
                    (
                        result.status,
                        result.provider_message_id,
                        result.error_message,
                        sent_time,
                        item["delivery_id"],
                    ),
                )

            if result.status in {"PROVIDER_ACCEPTED", "DELIVERED"}:
                success_count += 1
            else:
                failure_count += 1

        # Finalize alert lifecycle status
        final_status = "COMPLETED" if (success_count > 0 or len(queued_records) == 0) else "FAILED"
        comp_utc = datetime.now(timezone.utc).isoformat()

        with get_db(db_path) as conn:
            conn.execute(
                "UPDATE event_alerts SET lifecycle_status = ?, completed_at = ? WHERE id = ?;",
                (final_status, comp_utc, alert_id),
            )

        logger.info(
            "Dispatch completed for alert %s: %d accepted, %d failed (Provider: %s)",
            alert_id,
            success_count,
            failure_count,
            active_provider.get_provider_name(),
        )

        return {
            "alert_id": alert_id,
            "event_id": event_id,
            "lifecycle_status": final_status,
            "eligible_recipients_queued": len(queued_records),
            "provider": active_provider.get_provider_name(),
            "is_simulated": not active_provider.is_live_carrier(),
            "dispatched_at": now_utc,
        }

    @classmethod
    def get_alert_by_id(cls, alert_id: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieves alert details."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute("SELECT * FROM event_alerts WHERE id = ?;", (alert_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    @classmethod
    def list_alerts_for_event(cls, event_id: str, db_path: Optional[str] = None) -> List[Dict[str, Any]]:
        """Lists alerts created for an event."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                "SELECT * FROM event_alerts WHERE event_id = ? ORDER BY created_at DESC;",
                (event_id,),
            )
            return [dict(row) for row in cursor.fetchall()]

    @classmethod
    def get_alert_deliveries(cls, alert_id: str, db_path: Optional[str] = None) -> Dict[str, Any]:
        """Returns delivery breakdown and list of delivery records for an alert."""
        with get_db_read(db_path) as conn:
            # Aggregate counts
            cursor = conn.execute(
                """
                SELECT 
                    SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) AS queued,
                    SUM(CASE WHEN status = 'PROVIDER_ACCEPTED' THEN 1 ELSE 0 END) AS accepted,
                    SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered,
                    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
                    SUM(CASE WHEN status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown
                FROM sms_deliveries
                WHERE alert_id = ?;
                """,
                (alert_id,),
            )
            agg = cursor.fetchone()
            summary = {
                "queued": agg["queued"] or 0,
                "accepted": agg["accepted"] or 0,
                "delivered": agg["delivered"] or 0,
                "failed": agg["failed"] or 0,
                "unknown": agg["unknown"] or 0,
            }

            # Detail rows
            cursor = conn.execute(
                """
                SELECT id, recipient_phone_masked, status, provider_name, provider_message_id,
                       attempt_count, last_error, sent_at, delivered_at
                FROM sms_deliveries
                WHERE alert_id = ?
                ORDER BY created_at ASC;
                """,
                (alert_id,),
            )
            deliveries = [dict(row) for row in cursor.fetchall()]

            return {
                "alert_id": alert_id,
                "summary": summary,
                "deliveries": deliveries,
            }

    @classmethod
    def handle_webhook_status_update(
        cls,
        provider_name: str,
        provider_message_id: str,
        new_status: str,
        error_message: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> bool:
        """Updates delivery status from carrier webhook callback."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with get_db(db_path) as conn:
            cursor = conn.execute(
                "SELECT id FROM sms_deliveries WHERE provider_message_id = ?;",
                (provider_message_id,),
            )
            row = cursor.fetchone()
            if not row:
                return False

            delivered_at = now_utc if new_status == "DELIVERED" else None
            conn.execute(
                """
                UPDATE sms_deliveries
                SET status = ?, last_error = ?, delivered_at = COALESCE(delivered_at, ?)
                WHERE id = ?;
                """,
                (new_status, error_message, delivered_at, row["id"]),
            )
            return True
