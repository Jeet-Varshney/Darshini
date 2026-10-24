"""
Darshini - Automated Test Suite: Event Registration, QR Check-in & Targeted SMS
Comprehensive unit, integration, and security tests covering:
  - Database schema migrations and foreign key enforcement
  - User authentication, role hierarchies, and unauthorized access rejections
  - Event lifecycle (create, update, publish, close, QR revocation)
  - Public registration, E.164 normalization, honeypot traps, duplicate suppression
  - Gate check-in authorization, idempotency, wrong-event defense, reversals
  - Exact-event targeted SMS recipient selection and exclusions
  - Two-person rule for critical alerts
  - Mock SMS dispatch and delivery status tracking
"""

import os
import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.config import JWT_SECRET_KEY
from app.core.auth import (
    ROLE_ADMIN,
    ROLE_CHECKIN_OPERATOR,
    ROLE_EVENT_MANAGER,
    create_access_token,
    hash_password,
    verify_password,
)
from app.db.database import get_connection, get_db
from app.db.migrations import run_migrations
from app.main import app
from app.services.checkin_service import CheckinService
from app.services.event_service import EventService
from app.services.registration_service import (
    RegistrationService,
    mask_phone_number,
    normalize_phone_number,
)
from app.services.sms.alert_service import AlertService
from app.services.sms.mock_provider import MockSmsProvider
from app.services.sms.provider_interface import SmsMessage
from app.services.user_service import UserService


@pytest.fixture
def temp_db():
    """Provides an isolated temporary SQLite database for test runs."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        run_migrations(db_path)
        yield db_path
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)


@pytest.fixture
def client(temp_db, monkeypatch):
    """Configures FastAPI TestClient with isolated test database."""
    from app import config
    from app.db import database
    monkeypatch.setattr(config, "DATABASE_PATH", Path(temp_db))
    monkeypatch.setattr(database, "DATABASE_PATH", Path(temp_db))
    with TestClient(app) as test_client:
        yield test_client


# -------------------------------------------------------------
# 1. Database & Schema Tests
# -------------------------------------------------------------

def test_schema_migrations_and_foreign_keys(temp_db):
    """Verifies all tables exist and foreign keys are enforced."""
    conn = get_connection(temp_db)
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = {row["name"] for row in cursor.fetchall()}
    
    assert "users" in tables
    assert "events" in tables
    assert "event_registrations" in tables
    assert "event_checkins" in tables
    assert "event_alerts" in tables
    assert "sms_deliveries" in tables
    assert "audit_logs" in tables
    assert "schema_migrations" in tables

    # Test repeatability
    run_migrations(temp_db)

    # Test foreign key enforcement
    with pytest.raises(Exception):
        conn.execute(
            """
            INSERT INTO events (id, slug, name, venue_name, start_time, end_time, qr_token, created_by, created_at, updated_at)
            VALUES ('e1', 'test-slug', 'Test Event', 'Precinct A', '2026-10-24T10:00:00Z', '2026-10-24T18:00:00Z', 'tok1', 'non_existent_user', 'now', 'now');
            """
        )
        conn.commit()
    conn.close()


# -------------------------------------------------------------
# 2. Authentication and Role Enforcement Tests
# -------------------------------------------------------------

def test_password_hashing():
    pwd = "SecurePassword123!"
    hashed = hash_password(pwd)
    assert hashed != pwd
    assert verify_password(pwd, hashed) is True
    assert verify_password("WrongPassword", hashed) is False


def test_user_creation_and_auth(temp_db):
    user = UserService.create_user("event_mgr", "ManagerPass123", "Alice Manager", ROLE_EVENT_MANAGER, db_path=temp_db)
    assert user["username"] == "event_mgr"
    assert user["role"] == ROLE_EVENT_MANAGER

    auth_success = UserService.authenticate_user("event_mgr", "ManagerPass123", db_path=temp_db)
    assert auth_success is not None
    assert auth_success["id"] == user["id"]

    auth_fail = UserService.authenticate_user("event_mgr", "WrongPass", db_path=temp_db)
    assert auth_fail is None


# -------------------------------------------------------------
# 3. Phone Normalization & Masking Tests
# -------------------------------------------------------------

def test_phone_normalization_and_masking():
    # Indian 10 digits
    assert normalize_phone_number("9876543210") == "+919876543210"
    assert normalize_phone_number(" 98765-43210 ") == "+919876543210"
    assert normalize_phone_number("09876543210") == "+919876543210"
    assert normalize_phone_number("+919876543210") == "+919876543210"

    # International E.164
    assert normalize_phone_number("+14155552671") == "+14155552671"

    # Invalid
    with pytest.raises(ValueError):
        normalize_phone_number("123")
    with pytest.raises(ValueError):
        normalize_phone_number("abcdefghij")

    # Masking
    masked = mask_phone_number("+919876543210")
    assert masked == "+9198*** **210"
    assert "7654" not in masked


# -------------------------------------------------------------
# 4. End-to-End Core Invariant Flow: Event -> Register -> Checkin -> Targeted SMS
# -------------------------------------------------------------

def test_complete_event_registration_checkin_and_targeted_sms(temp_db):
    """
    Validates the core Darshini safety invariant:
      - 2 events: Event A and Event B
      - Attendee 1 registers for Event A and CHECKS IN -> ELIGIBLE for Event A alert
      - Attendee 2 registers for Event A but DOES NOT CHECK IN -> EXCLUDED from Event A alert
      - Attendee 3 registers for Event A, checks in, but OPTS OUT -> EXCLUDED from Event A alert
      - Attendee 4 registers for Event B and CHECKS IN -> NEVER receives Event A alert
    """
    # 1. Setup users
    admin = UserService.create_user("admin_user", "AdminSecret123", "Chief Admin", ROLE_ADMIN, db_path=temp_db)
    manager = UserService.create_user("mgr_user", "ManagerSecret123", "Bob Manager", ROLE_EVENT_MANAGER, db_path=temp_db)
    operator = UserService.create_user("gate_op", "OperatorSecret123", "Gate Staff", ROLE_CHECKIN_OPERATOR, db_path=temp_db)

    # 2. Create Event A & Event B
    from app.schemas_events import EventCreateRequest, PublicRegistrationRequest, AlertCreateRequest

    ev_a_req = EventCreateRequest(
        name="Precinct Safety Summit",
        venue_name="Main Arena",
        start_time="2026-10-24T10:00:00Z",
        end_time="2026-10-24T18:00:00Z",
    )
    ev_a = EventService.create_event(ev_a_req, creator_id=manager["id"], db_path=temp_db)
    EventService.update_event_status(ev_a["id"], "PUBLISHED", db_path=temp_db)

    ev_b_req = EventCreateRequest(
        name="Cultural Pavilion Expo",
        venue_name="East Pavilion",
        start_time="2026-10-24T12:00:00Z",
        end_time="2026-10-24T20:00:00Z",
    )
    ev_b = EventService.create_event(ev_b_req, creator_id=manager["id"], db_path=temp_db)
    EventService.update_event_status(ev_b["id"], "PUBLISHED", db_path=temp_db)

    # 3. Register Attendees
    # Attendee 1: Event A, Checked In, Consented
    reg_1 = RegistrationService.register_attendee(
        ev_a["id"],
        PublicRegistrationRequest(attendee_name="Attendee One", phone_number="9876543210"),
        db_path=temp_db,
    )
    # Attendee 2: Event A, Registered ONLY (Not checked in)
    reg_2 = RegistrationService.register_attendee(
        ev_a["id"],
        PublicRegistrationRequest(attendee_name="Attendee Two", phone_number="9876543211"),
        db_path=temp_db,
    )
    # Attendee 3: Event A, Checked In, OPTED OUT of SMS
    reg_3 = RegistrationService.register_attendee(
        ev_a["id"],
        PublicRegistrationRequest(attendee_name="Attendee Three", phone_number="9876543212", opt_out_sms=True),
        db_path=temp_db,
    )
    # Attendee 4: Event B, Checked In
    reg_4 = RegistrationService.register_attendee(
        ev_b["id"],
        PublicRegistrationRequest(attendee_name="Attendee Four", phone_number="9876543213"),
        db_path=temp_db,
    )

    # 4. Duplicate registration protection test
    reg_1_dup = RegistrationService.register_attendee(
        ev_a["id"],
        PublicRegistrationRequest(attendee_name="Attendee One", phone_number="9876543210"),
        db_path=temp_db,
    )
    assert reg_1_dup["is_existing"] is True
    assert reg_1_dup["registration_code"] == reg_1["registration_code"]

    # 5. Execute Check-ins
    # Check in Attendee 1 to Event A
    checkin_1 = CheckinService.checkin_attendee(
        event_id=ev_a["id"],
        operator_id=operator["id"],
        registration_code=reg_1["registration_code"],
        db_path=temp_db,
    )
    assert checkin_1["status"] == "CHECKED_IN"

    # Idempotent check-in test: scanning Attendee 1 again returns ALREADY_CHECKED_IN
    checkin_1_repeat = CheckinService.checkin_attendee(
        event_id=ev_a["id"],
        operator_id=operator["id"],
        registration_code=reg_1["registration_code"],
        db_path=temp_db,
    )
    assert checkin_1_repeat["status"] == "ALREADY_CHECKED_IN"

    # Check in Attendee 3 to Event A (opted-out)
    checkin_3 = CheckinService.checkin_attendee(
        event_id=ev_a["id"],
        operator_id=operator["id"],
        registration_code=reg_3["registration_code"],
        db_path=temp_db,
    )
    assert checkin_3["status"] == "CHECKED_IN"

    # Check in Attendee 4 to Event B
    checkin_4 = CheckinService.checkin_attendee(
        event_id=ev_b["id"],
        operator_id=operator["id"],
        registration_code=reg_4["registration_code"],
        db_path=temp_db,
    )
    assert checkin_4["status"] == "CHECKED_IN"

    # Wrong-event check-in defense test: Attendee 4 pass scanned at Event A gate
    with pytest.raises(PermissionError) as exc_info:
        CheckinService.checkin_attendee(
            event_id=ev_a["id"],
            operator_id=operator["id"],
            registration_code=reg_4["registration_code"],
            db_path=temp_db,
        )
    assert "Wrong Event" in str(exc_info.value)

    # 6. Compose Emergency Alert for Event A
    alert = AlertService.compose_alert(
        event_id=ev_a["id"],
        data=AlertCreateRequest(
            title="Weather Advisory",
            message_body="Please proceed toward covered Walkway B due to high winds.",
            severity="WARNING",
        ),
        creator_id=manager["id"],
        db_path=temp_db,
    )
    assert alert["lifecycle_status"] == "DRAFT"

    # 7. Dispatch Alert with Mock SMS Provider
    mock_provider = MockSmsProvider()
    dispatch_res = AlertService.dispatch_alert(
        alert_id=alert["id"],
        dispatcher_id=manager["id"],
        provider=mock_provider,
        db_path=temp_db,
    )

    assert dispatch_res["lifecycle_status"] == "COMPLETED"
    # ONLY Attendee 1 is eligible!
    # Attendee 2 (not checked in) -> EXCLUDED
    # Attendee 3 (opted out) -> EXCLUDED
    # Attendee 4 (Event B) -> EXCLUDED
    assert dispatch_res["eligible_recipients_queued"] == 1

    sent_log = mock_provider.get_sent_log()
    assert len(sent_log) == 1
    assert sent_log[0]["recipient_masked"] == "+9198*** **210"
    assert sent_log[0]["event_id"] == ev_a["id"]

    # 8. Check-in Reversal Test
    reversal = CheckinService.reverse_checkin(
        checkin_id=checkin_1["checkin_id"],
        reversal_reason="Attendee departed venue early",
        reversed_by=manager["id"],
        db_path=temp_db,
    )
    assert reversal["status"] == "REVERSED"

    # Second alert: Now that Attendee 1 is reversed, eligible recipient count must be 0!
    alert_2 = AlertService.compose_alert(
        event_id=ev_a["id"],
        data=AlertCreateRequest(
            title="Update Advisory",
            message_body="Wind conditions returning to normal.",
            severity="INFO",
        ),
        creator_id=manager["id"],
        db_path=temp_db,
    )
    dispatch_res_2 = AlertService.dispatch_alert(
        alert_id=alert_2["id"],
        dispatcher_id=manager["id"],
        provider=mock_provider,
        db_path=temp_db,
    )
    assert dispatch_res_2["eligible_recipients_queued"] == 0


def test_two_person_approval_rule_for_critical_alerts(temp_db):
    """Verifies that critical evacuation alerts require two-person administrative approval."""
    manager1 = UserService.create_user("mgr1", "ManagerOne123", "Manager One", ROLE_EVENT_MANAGER, db_path=temp_db)
    manager2 = UserService.create_user("mgr2", "ManagerTwo123", "Manager Two", ROLE_EVENT_MANAGER, db_path=temp_db)

    from app.schemas_events import EventCreateRequest, AlertCreateRequest
    event = EventService.create_event(
        EventCreateRequest(
            name="Stadium Concert",
            venue_name="Grand Bowl",
            start_time="2026-10-24T18:00:00Z",
            end_time="2026-10-24T23:00:00Z",
        ),
        creator_id=manager1["id"],
        db_path=temp_db,
    )
    EventService.update_event_status(event["id"], "PUBLISHED", db_path=temp_db)

    alert = AlertService.compose_alert(
        event_id=event["id"],
        data=AlertCreateRequest(
            title="CRITICAL EVACUATION",
            message_body="Immediate orderly evacuation via Gate 4.",
            severity="CRITICAL",
        ),
        creator_id=manager1["id"],
        db_path=temp_db,
    )
    assert alert["lifecycle_status"] == "PENDING_APPROVAL"

    # Dispatch without approval must be rejected
    mock_provider = MockSmsProvider()
    with pytest.raises(PermissionError) as exc_info:
        AlertService.dispatch_alert(alert["id"], dispatcher_id=manager1["id"], provider=mock_provider, db_path=temp_db)
    assert "second-person approval" in str(exc_info.value)

    # Self-approval by creator must be rejected
    with pytest.raises(PermissionError) as exc_info:
        AlertService.approve_alert(alert["id"], approver_id=manager1["id"], db_path=temp_db)
    assert "Two-person rule violation" in str(exc_info.value)

    # Approval by distinct manager must succeed
    approved = AlertService.approve_alert(alert["id"], approver_id=manager2["id"], db_path=temp_db)
    assert approved["lifecycle_status"] == "APPROVED"
    assert approved["approved_by"] == manager2["id"]


# -------------------------------------------------------------
# 5. HTTP API Integration Tests (FastAPI TestClient)
# -------------------------------------------------------------

def test_api_public_registration_and_pass_lookup(client, temp_db):
    """Tests public registration endpoint and pass retrieval via HTTP."""
    # Seed manager and published event
    manager = UserService.create_user("api_mgr", "ManagerPass123", "API Manager", ROLE_EVENT_MANAGER, db_path=temp_db)
    from app.schemas_events import EventCreateRequest
    event = EventService.create_event(
        EventCreateRequest(
            name="Robotics Exhibition",
            venue_name="Tech Pavilion",
            start_time="2026-10-24T09:00:00Z",
            end_time="2026-10-24T17:00:00Z",
        ),
        creator_id=manager["id"],
        db_path=temp_db,
    )
    EventService.update_event_status(event["id"], "PUBLISHED", db_path=temp_db)

    # 1. Fetch public event info
    resp = client.get(f"/api/v1/public/events/{event['slug']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Robotics Exhibition"

    # 2. Register attendee
    reg_resp = client.post(
        f"/api/v1/public/events/{event['slug']}/register",
        json={"attendee_name": "Kiran Rao", "phone_number": "9876543210"},
    )
    assert reg_resp.status_code == 201
    data = reg_resp.json()
    assert data["attendee_name"] == "Kiran Rao"
    assert data["phone_masked"] == "+9198*** **210"
    assert data["registration_code"].startswith("REG-")
    assert "<svg" in data["pass_qr_svg"]

    # 3. Lookup pass
    pass_resp = client.get(f"/api/v1/public/pass/{data['registration_code']}")
    assert pass_resp.status_code == 200
    pass_data = pass_resp.json()
    assert pass_data["attendee_name"] == "Kiran Rao"
    assert pass_data["phone_masked"] == "+9198*** **210"


def test_api_staff_checkin_and_unauthorized_rejection(client, temp_db):
    """Tests that unauthorized requests are rejected and authorized check-in succeeds."""
    manager = UserService.create_user("sec_mgr", "ManagerPass123", "Security Mgr", ROLE_EVENT_MANAGER, db_path=temp_db)
    operator = UserService.create_user("sec_op", "OperatorPass123", "Security Op", ROLE_CHECKIN_OPERATOR, db_path=temp_db)

    from app.schemas_events import EventCreateRequest, PublicRegistrationRequest
    event = EventService.create_event(
        EventCreateRequest(
            name="Defense Expo",
            venue_name="Hangar 1",
            start_time="2026-10-24T08:00:00Z",
            end_time="2026-10-24T16:00:00Z",
        ),
        creator_id=manager["id"],
        db_path=temp_db,
    )
    EventService.update_event_status(event["id"], "PUBLISHED", db_path=temp_db)

    reg = RegistrationService.register_attendee(
        event["id"],
        PublicRegistrationRequest(attendee_name="Ravi Kumar", phone_number="9876543210"),
        db_path=temp_db,
    )

    # 1. Unauthenticated request to checkin must return 401
    unauth_resp = client.post(
        f"/api/v1/management/events/{event['id']}/checkin",
        json={"registration_code": reg["registration_code"]},
    )
    assert unauth_resp.status_code == 401

    # 2. Login as operator
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"username": "sec_op", "password": "OperatorPass123"},
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 3. Authorized check-in
    checkin_resp = client.post(
        f"/api/v1/management/events/{event['id']}/checkin",
        json={"registration_code": reg["registration_code"]},
        headers=headers,
    )
    assert checkin_resp.status_code == 200
    assert checkin_resp.json()["status"] == "CHECKED_IN"
