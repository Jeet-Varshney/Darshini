"""
Darshini - Attendee Registration Service
Handles public visitor registration, phone E.164 normalization, masking,
duplicate prevention, honeypot spam filtering, and digital pass generation.
"""

import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.config import PUBLIC_BASE_URL
from app.db.database import get_db, get_db_read
from app.schemas_events import PublicRegistrationRequest
from app.services.event_service import EventService, generate_qr_svg

logger = logging.getLogger("darshini.registration_service")


def normalize_phone_number(raw_phone: str) -> str:
    """
    Normalizes a phone number into strict E.164 format.
    Handles Indian national formats (10 digits -> +91XXXXXXXXXX, 0XXXXXXXXXX -> +91XXXXXXXXXX)
    as well as standard international + prefixed numbers.
    """
    # Remove all whitespace, dashes, parens, dots
    cleaned = re.sub(r"[\s\-\(\)\.]", "", raw_phone.strip())

    if not cleaned:
        raise ValueError("Phone number cannot be empty.")

    # If starts with +, ensure remaining are digits
    if cleaned.startswith("+"):
        digits = cleaned[1:]
        if not digits.isdigit() or len(digits) < 7 or len(digits) > 15:
            raise ValueError("Invalid international phone number format.")
        return f"+{digits}"

    # Indian standard: 10 digits starting with 6, 7, 8, or 9
    if len(cleaned) == 10 and cleaned[0] in "6789" and cleaned.isdigit():
        return f"+91{cleaned}"

    # Indian 11 digits starting with 0: e.g. 09876543210
    if len(cleaned) == 11 and cleaned.startswith("0") and cleaned[1] in "6789" and cleaned.isdigit():
        return f"+91{cleaned[1:]}"

    # 12 digits starting with 91: e.g. 919876543210
    if len(cleaned) == 12 and cleaned.startswith("91") and cleaned.isdigit():
        return f"+{cleaned}"

    # General fallback if 10-15 digits
    if cleaned.isdigit() and 10 <= len(cleaned) <= 15:
        return f"+{cleaned}"

    raise ValueError(
        "Invalid phone number. Please enter a valid 10-digit mobile number or full international format (+91...)."
    )


def mask_phone_number(e164_phone: str) -> str:
    """
    Produces a safe, masked phone string for UI display and audit registers.
    Example: '+919876543210' -> '+91 98*** **210'
    """
    if len(e164_phone) < 7:
        return "***"
    prefix = e164_phone[:5]  # e.g. "+9198" or "+1415"
    suffix = e164_phone[-3:]  # e.g. "210"
    return f"{prefix}*** **{suffix}"


class RegistrationService:
    """Manages attendee registration records, passes, and check-in eligibility."""

    @classmethod
    def register_attendee(
        cls,
        event_slug_or_id: str,
        data: PublicRegistrationRequest,
        client_ip: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Registers an attendee for an event.
        Enforces honeypot spam trapping, published event status, capacity limit,
        E.164 phone normalization, and duplicate registration rules.
        """
        # 1. Honeypot check
        if data.website_url:
            logger.warning("Spam registration blocked via honeypot trap from IP: %s", client_ip)
            raise ValueError("Registration request rejected by anti-bot verification.")

        # 2. Lookup event
        event = EventService.get_event_by_slug(event_slug_or_id, db_path=db_path)
        if not event:
            event = EventService.get_event_by_id(event_slug_or_id, db_path=db_path)
        if not event:
            raise KeyError(f"Event '{event_slug_or_id}' not found.")

        # 3. Verify event lifecycle state
        if event["status"] != "PUBLISHED":
            raise ValueError(f"Event is currently {event['status']}. Registrations are not accepted.")

        # 4. Check capacity limit
        if event["max_capacity"] > 0 and event["registered_count"] >= event["max_capacity"]:
            raise ValueError("This event has reached its maximum registration capacity.")

        # 5. Normalize and mask phone
        phone_e164 = normalize_phone_number(data.phone_number)
        phone_masked = mask_phone_number(phone_e164)

        # 6. Check for duplicate registration
        with get_db(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT id, registration_code, attendee_name, status, registered_at
                FROM event_registrations
                WHERE event_id = ? AND phone_number_e164 = ? AND status != 'CANCELLED';
                """,
                (event["id"], phone_e164),
            )
            existing = cursor.fetchone()
            if existing:
                # Return existing registration pass without error
                logger.info(
                    "Duplicate registration detected for phone %s in event %s. Returning existing pass.",
                    phone_masked,
                    event["id"],
                )
                pass_url = f"{PUBLIC_BASE_URL}/?pass={existing['registration_code']}"
                pass_qr_svg = generate_qr_svg(pass_url)
                return {
                    "registration_code": existing["registration_code"],
                    "attendee_name": existing["attendee_name"],
                    "phone_masked": phone_masked,
                    "event_name": event["name"],
                    "venue_name": event["venue_name"],
                    "registered_at": existing["registered_at"],
                    "pass_qr_svg": pass_qr_svg,
                    "pass_url": pass_url,
                    "is_existing": True,
                }

            # 7. Create new registration
            reg_id = str(uuid.uuid4())
            # Short, memorable, cryptographically secure registration code: REG-XXXX-XXXX
            reg_code = f"REG-{secrets.token_hex(4).upper()}"
            now_utc = datetime.now(timezone.utc).isoformat()
            ip_hash = hashlib.sha256(client_ip.encode("utf-8")).hexdigest() if client_ip else None

            conn.execute(
                """
                INSERT INTO event_registrations (
                    id, event_id, attendee_name, phone_number_e164, phone_masked,
                    registration_code, status, opt_out_sms, registered_at, ip_hash
                ) VALUES (?, ?, ?, ?, ?, ?, 'REGISTERED', ?, ?, ?);
                """,
                (
                    reg_id,
                    event["id"],
                    data.attendee_name.strip(),
                    phone_e164,
                    phone_masked,
                    reg_code,
                    1 if data.opt_out_sms else 0,
                    now_utc,
                    ip_hash,
                ),
            )

        logger.info(
            "Registered attendee '%s' (%s) for event '%s' (Code: %s)",
            data.attendee_name.strip(),
            phone_masked,
            event["name"],
            reg_code,
        )

        pass_url = f"{PUBLIC_BASE_URL}/?pass={reg_code}"
        pass_qr_svg = generate_qr_svg(pass_url)

        return {
            "registration_code": reg_code,
            "attendee_name": data.attendee_name.strip(),
            "phone_masked": phone_masked,
            "event_name": event["name"],
            "venue_name": event["venue_name"],
            "registered_at": now_utc,
            "pass_qr_svg": pass_qr_svg,
            "pass_url": pass_url,
            "is_existing": False,
        }

    @classmethod
    def get_registration_by_code(
        cls,
        registration_code: str,
        db_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieves registration record by its alphanumeric pass code."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT 
                    r.id, r.event_id, r.attendee_name, r.phone_masked, r.registration_code,
                    r.status, r.opt_out_sms, r.registered_at,
                    e.name AS event_name, e.venue_name, e.status AS event_status,
                    c.id AS checkin_id, c.checked_in_at, c.is_active AS checkin_active
                FROM event_registrations r
                JOIN events e ON e.id = r.event_id
                LEFT JOIN event_checkins c ON c.registration_id = r.id AND c.is_active = 1
                WHERE r.registration_code = ?;
                """,
                (registration_code.upper().strip(),),
            )
            row = cursor.fetchone()
            if not row:
                return None
            res = dict(row)
            pass_url = f"{PUBLIC_BASE_URL}/?pass={res['registration_code']}"
            res["pass_qr_svg"] = generate_qr_svg(pass_url)
            res["pass_url"] = pass_url
            return res

    @classmethod
    def list_registrations_for_event(
        cls,
        event_id: str,
        db_path: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Lists registrations for an event (safe masked phones)."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT id, event_id, attendee_name, phone_masked, registration_code, status, opt_out_sms, registered_at
                FROM event_registrations
                WHERE event_id = ?
                ORDER BY registered_at DESC;
                """,
                (event_id,),
            )
            return [dict(row) for row in cursor.fetchall()]
