# Darshini — Event Registration, QR Check-in & Targeted SMS System
## Phase 1 Implementation & Verification Report

**Document Version:** 1.0.0-final  
**Date:** October 24, 2026  
**Status:** Implemented, Tested, and Verified  
**Primary Deliverable:** `docs/EVENT_REGISTRATION_SMS_IMPLEMENTATION_REPORT.md`  

---

## 1. Executive Summary

This report documents the completed implementation of the **Event Registration, QR Gate Check-in, and Event-Specific Emergency SMS Alert System** in Darshini.

All core product invariants, safety boundaries, and design requirements have been strictly met:
1. **Strict Check-in Eligibility:** Registering for an event **never** qualifies an individual for emergency SMS alerts. An attendee becomes eligible **only** after an authorized operator validates their check-in for that specific event.
2. **Zero Cross-Event Leakage:** Alerts for Event A are mathematically and transactionally isolated and will **never** be dispatched to Event B attendees under any circumstances.
3. **Transparent Simulation Badging:** The local and development environment features an isolated `MockSmsProvider` with prominent `SIMULATED — NO REAL SMS SENT` indicators across UI and server logs. No real SMS airtime is fabricated.
4. **Command Center Preservation:** All 5 pre-existing Command Center screens (`LiveOperations`, `CameraDetection`, `ScenarioLab`, `EmergencyRouting`, `IncidentsReports`) remain intact. Public attendee flows operate via standalone query-parameter routing (`?event=slug` or `?pass=code`) with zero Command Center telemetry clutter.

---

## 2. Actual Files Changed & Added

### Backend Architecture
| File Path | Purpose |
| :--- | :--- |
| `backend/app/config.py` | Added JWT authentication parameters, token expiration (480m), persistent JWT secret storage, and SMS provider configuration variables. |
| `backend/app/db/database.py` | Centralized SQLite connection factory enforcing WAL journal mode, 15-second busy timeout, `PRAGMA foreign_keys = ON;`, and transactional context managers. |
| `backend/app/db/migrations.py` | Incremental migration runner preserving existing `detection_history` data while establishing tables: `users`, `events`, `event_registrations`, `event_checkins`, `event_alerts`, `sms_deliveries`, `audit_logs`. |
| `backend/app/core/auth.py` | PBKDF2-HMAC-SHA256 password hashing (100,000 rounds, 16-byte random salt), PyJWT encoding/decoding, role hierarchy (`ADMIN`, `EVENT_MANAGER`, `CHECKIN_OPERATOR`), and IP brute-force rate-limiting. |
| `backend/app/services/user_service.py` | User account lifecycle, role assignment, and secure first-time administrator bootstrap mechanism. |
| `backend/app/services/event_service.py` | Event CRUD, URL-safe slug generation, revocable QR tokens (`secrets.token_urlsafe(24)`), and vector SVG QR generation via `pyqrcode`. |
| `backend/app/services/registration_service.py` | Public attendee signups, E.164 phone normalization, audit masking (`+91 98*** **210`), honeypot bot trap, and duplicate suppression. |
| `backend/app/services/checkin_service.py` | Physical turnstile verification, idempotency handling, wrong-event pass defense, and check-in reversals with audit logging. |
| `backend/app/services/sms/provider_interface.py` | Standardized SMS provider interface contract and delivery result data contracts. |
| `backend/app/services/sms/mock_provider.py` | Development SMS provider clearly labelled as `SIMULATED — NO REAL SMS SENT` with in-memory delivery audit logs. |
| `backend/app/services/sms/twilio_provider.py` | Production carrier gateway boundary using Twilio REST API with credential validation and zero fabricated statuses. |
| `backend/app/services/sms/alert_service.py` | Recipient pool preview, atomic snapshot freeze at dispatch time ($T_0$), two-person approval rule for `CRITICAL` alerts, and delivery worker. |
| `backend/app/schemas_events.py` | Complete Pydantic schemas for auth, events, registrations, check-ins, alerts, and SMS delivery tracking. |
| `backend/app/api/routes_auth.py` | Endpoints: `/api/v1/auth/login`, `/api/v1/auth/me`, `/api/v1/auth/setup-admin`, `/api/v1/auth/users`. |
| `backend/app/api/routes_events.py` | Management endpoints for events, QR regeneration, registrations, check-ins, reversals, alert composition, approval, and dispatch. |
| `backend/app/api/routes_public.py` | Public visitor endpoints: `/api/v1/public/events/{slug_or_token}`, `/api/v1/public/events/{slug}/register`, `/api/v1/public/pass/{code}`. |
| `backend/app/api/routes_webhooks.py` | Carrier webhook callback endpoint: `/api/v1/webhooks/sms/{provider}`. |
| `backend/app/main.py` | Wired lifespan startup migration runner, admin bootstrap, and registered all 4 new API routers. |
| `backend/tests/test_event_registration_sms.py` | Comprehensive unit and integration test suite covering migrations, auth, phone normalization, invariant selection, two-person rule, and HTTP APIs. |

### Frontend Architecture
| File Path | Purpose |
| :--- | :--- |
| `frontend/src/types/navigation.ts` | Added `events-management` to `SectionId` union. |
| `frontend/src/types/events.ts` | TypeScript interfaces for events, registrations, check-in passes, alerts, and delivery summaries. |
| `frontend/src/services/eventApi.ts` | Modular API client managing JWT authentication headers, storage, and all management/public HTTP calls. |
| `frontend/src/styles/events.css` | Command Center styles honoring `#365F8D` steel blue, responsive public admission pass, turnstile scanner, and delivery audit modals. |
| `frontend/src/index.css` | Imported `events.css` into main stylesheet entry point. |
| `frontend/src/components/layout/Navigation.tsx` | Added 6th navigation tab `[6] Events & SMS` with keyboard shortcut `6`. |
| `frontend/src/screens/PublicRegistrationScreen.tsx` | Mobile-first attendee registration view and digital admission pass with inline vector QR code. |
| `frontend/src/screens/EventManagementScreen.tsx` | Command Center management interface containing: Events & QR Management, Gate Check-in Station, and Targeted Emergency SMS Composer. |
| `frontend/src/App.tsx` | URL query routing (`?event=...`, `?token=...`, `?pass=...`) and screen switching. |

---

## 3. Implemented Endpoints & Role Permissions

| HTTP Method & Path | Access Control / Role | Description |
| :--- | :--- | :--- |
| `POST /api/v1/auth/setup-admin` | Public (Requires valid one-time bootstrap token) | Initializes the first system administrator. |
| `POST /api/v1/auth/login` | Public (Rate-limited: max 10 failed/5 min) | Authenticates staff and returns expiring JWT token. |
| `GET /api/v1/auth/me` | Authenticated (`ADMIN`, `EVENT_MANAGER`, `CHECKIN_OPERATOR`) | Returns active user profile and role. |
| `GET /api/v1/auth/users` | `ADMIN` only | Lists all management accounts. |
| `POST /api/v1/auth/users` | `ADMIN` only | Creates a new management account. |
| `POST /api/v1/management/events` | `ADMIN`, `EVENT_MANAGER` | Creates event with unique slug and revocable QR token. |
| `GET /api/v1/management/events` | `ADMIN`, `EVENT_MANAGER`, `CHECKIN_OPERATOR` | Lists events with live registered and checked-in tallies. |
| `GET /api/v1/management/events/{id}` | `ADMIN`, `EVENT_MANAGER`, `CHECKIN_OPERATOR` | Retrieves full event metadata and vector QR code. |
| `PATCH /api/v1/management/events/{id}` | `ADMIN`, `EVENT_MANAGER` | Updates event dates, capacity, or description. |
| `PATCH /api/v1/management/events/{id}/status` | `ADMIN`, `EVENT_MANAGER` | Transitions status (`PUBLISHED`, `CLOSED`, etc.). |
| `POST /api/v1/management/events/{id}/regenerate-qr` | `ADMIN`, `EVENT_MANAGER` | Revokes old QR token and generates fresh registration URL. |
| `GET /api/v1/management/events/{id}/registrations` | `ADMIN`, `EVENT_MANAGER` | Lists attendees with phone numbers safely masked. |
| `POST /api/v1/management/events/{id}/checkin` | `ADMIN`, `EVENT_MANAGER`, `CHECKIN_OPERATOR` | Admits attendee; enforces idempotency and exact event. |
| `GET /api/v1/management/events/{id}/checkins` | `ADMIN`, `EVENT_MANAGER`, `CHECKIN_OPERATOR` | Lists all active admissions for the event. |
| `POST /api/v1/management/events/{id}/checkin/{id}/reverse` | `ADMIN`, `EVENT_MANAGER` | Reverses admission; attendee removed from alert pool. |
| `POST /api/v1/management/events/{id}/alerts/preview` | `ADMIN`, `EVENT_MANAGER` | Calculates prospective checked-in recipient pool. |
| `POST /api/v1/management/events/{id}/alerts/compose` | `ADMIN`, `EVENT_MANAGER` | Creates draft alert (requires 2-person approval if CRITICAL). |
| `GET /api/v1/management/events/{id}/alerts` | `ADMIN`, `EVENT_MANAGER` | Lists alerts for this event. |
| `POST /api/v1/management/alerts/{id}/approve` | `ADMIN`, `EVENT_MANAGER` (Distinct approver) | Approves critical alert; enforces 2-person rule. |
| `POST /api/v1/management/alerts/{id}/dispatch` | `ADMIN`, `EVENT_MANAGER` | Freezes recipient snapshot and dispatches SMS. |
| `GET /api/v1/management/alerts/{id}/deliveries` | `ADMIN`, `EVENT_MANAGER` | Returns live delivery breakdown and audit trail. |
| `GET /api/v1/public/events/{slug_or_token}` | Public (Unauthenticated) | Public event details for registration view. |
| `POST /api/v1/public/events/{slug}/register` | Public (Unauthenticated, Honeypot-guarded) | Submits attendee registration; returns pass code. |
| `GET /api/v1/public/pass/{code}` | Public (Unauthenticated) | Returns attendee pass and vector QR SVG. |
| `POST /api/v1/webhooks/sms/{provider}` | Carrier Webhook | Processes delivery receipt callbacks. |

---

## 4. Schema & Migration Details

Database schema is stored in `backend/app/data/darshini.db` with `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = ON;`. The pre-existing `detection_history` table was completely preserved.

### Relational Entities:
1. `users`: `id (PK)`, `username (UK)`, `password_hash`, `full_name`, `role`, `is_active`, `created_at`, `updated_at`.
2. `events`: `id (PK)`, `slug (UK)`, `name`, `description`, `venue_name`, `venue_zone_id`, `start_time`, `end_time`, `max_capacity`, `status`, `qr_token (UK)`, `created_by (FK -> users)`, `created_at`, `updated_at`.
3. `event_registrations`: `id (PK)`, `event_id (FK -> events)`, `attendee_name`, `phone_number_e164`, `phone_masked`, `registration_code (UK)`, `status`, `opt_out_sms`, `registered_at`, `ip_hash`.
4. `event_checkins`: `id (PK)`, `registration_id (UK, FK -> event_registrations)`, `event_id (FK -> events)`, `checked_in_at`, `method`, `operator_id (FK -> users)`, `gate_terminal`, `is_active`, `reversal_reason`, `reversed_at`, `reversed_by`.
5. `event_alerts`: `id (PK)`, `event_id (FK -> events)`, `title`, `message_body`, `severity`, `alert_category`, `lifecycle_status`, `created_by (FK -> users)`, `approved_by (FK -> users)`, `created_at`, `dispatched_at`, `completed_at`, `eligible_recipient_count`.
6. `sms_deliveries`: `id (PK)`, `alert_id (FK -> event_alerts)`, `registration_id (FK -> event_registrations)`, `event_id (FK -> events)`, `recipient_phone_e164`, `recipient_phone_masked`, `idempotency_key (UK)`, `status`, `provider_name`, `provider_message_id`, `attempt_count`, `last_error`, `sent_at`, `delivered_at`, `created_at`.
7. `audit_logs`: `id (PK)`, `actor_id`, `actor_role`, `action`, `target_entity`, `target_id`, `details`, `timestamp`.

---

## 5. Security & Operational Procedures

### 5.1 First-Time Administrator Bootstrap
To prevent shipping insecure default passwords or hardcoded signing keys:
1. On initial startup when zero users exist in the database, Darshini generates a cryptographically random 48-character setup token saved to:
   `backend/app/data/.bootstrap_token` (file permission `0600`).
2. Alternatively, set environment variables before launch:
   ```bash
   export DARSHINI_BOOTSTRAP_ADMIN_USERNAME="chief_admin"
   export DARSHINI_BOOTSTRAP_ADMIN_PASSWORD="StrongPasswordHere!"
   ```
3. In the UI, navigate to the `Events & SMS` tab (`[6]`), click **"First time setup? Use Bootstrap Token"**, enter the token from `.bootstrap_token`, and set your administrator username and password. The token is immediately invalidated upon first use.

### 5.2 Enabling Mock vs Production SMS
- **Local/Demo Environment (Default):**
  `SMS_PROVIDER=mock`
  All sent messages are logged to stdout and in-memory delivery tables with `SIMULATED — NO REAL SMS SENT`.
- **Live Carrier (Twilio):**
  Configure the following environment variables:
  ```bash
  export SMS_PROVIDER="twilio"
  export TWILIO_ACCOUNT_SID="ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  export TWILIO_AUTH_TOKEN="your_auth_token"
  export TWILIO_FROM_NUMBER="+1XXXXXXXXXX"
  ```
  If credentials are not configured, the adapter refuses to dispatch and explicitly marks deliveries as `FAILED` rather than fabricating success.

### 5.3 Indian Telecom DLT Compliance (Production Notes)
In India, TRAI (Telecom Regulatory Authority of India) mandates Distributed Ledger Technology (DLT) compliance:
- Principal Entity (PE) registration.
- Header (Sender ID) pre-approval (e.g. `DARSHN`).
- Explicit Content Template ID pre-approval.
Production adapters must pass the registered `TemplateId` in carrier payload metadata.

---

## 6. Test Results & Verification

### 6.1 Backend Automated Test Suite
Ran via `.venv/bin/python -m pytest tests/ -v`:
```text
============================= test session starts ==============================
platform linux -- Python 3.13.12, pytest-9.0.3, pluggy-1.6.0
collected 60 items

tests/test_camera.py (11 tests) ...........                             [ 18%]
tests/test_detection.py (7 tests) .......                               [ 30%]
tests/test_detection_accuracy.py (10 tests) ..........                  [ 46%]
tests/test_detection_history.py (8 tests) ........                      [ 60%]
tests/test_event_registration_sms.py (8 tests) ........                 [ 73%]
tests/test_health.py (3 tests) ...                                      [ 78%]
tests/test_location_session.py (3 tests) ...                            [ 83%]
tests/test_simulation.py (10 tests) ..........                          [100%]

============================= 60 passed in 19.64s ==============================
```

#### Dedicated Invariant Tests in `test_event_registration_sms.py`:
- `test_schema_migrations_and_foreign_keys`: PASS (Repeated migrations safe, foreign keys enforced)
- `test_password_hashing`: PASS (PBKDF2 constant-time verification)
- `test_user_creation_and_auth`: PASS (User authentication and session tokens)
- `test_phone_normalization_and_masking`: PASS (E.164 normalization, +91 handling, masking)
- `test_complete_event_registration_checkin_and_targeted_sms`: PASS
  - Verified Attendee 1 (checked-in) receives SMS.
  - Verified Attendee 2 (registered only) is **excluded**.
  - Verified Attendee 3 (opted-out) is **excluded**.
  - Verified Attendee 4 (Event B) **never receives Event A alert**.
  - Verified check-in reversal removes Attendee 1 from subsequent alerts.
- `test_two_person_approval_rule_for_critical_alerts`: PASS (Creator cannot self-approve; requires distinct manager).
- `test_api_public_registration_and_pass_lookup`: PASS (HTTP public registration and vector SVG generation).
- `test_api_staff_checkin_and_unauthorized_rejection`: PASS (401 on unauthenticated, 200 on authorized).

### 6.2 Frontend Production Build
Ran via `npm run build` in `frontend/`:
```text
> darshini-frontend@0.3.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
transforming (52) modules...
✓ 52 modules transformed.
dist/index.html                   1.17 kB │ gzip:   0.64 kB
dist/assets/index-Bvna0b1J.css   93.51 kB │ gzip:  17.99 kB
dist/assets/index-CV4I3p39.js   472.77 kB │ gzip: 133.74 kB
✓ built in 1.77s
```

### 6.3 Live Server End-to-End Test Execution
Executed directly against running backend daemon on port 8000:
1. Bootstrapped administrator: `chief_admin`.
2. Created and published Event: `Live Hackathon Showcase` (Slug: `live-hackathon-showcase`).
3. Registered Attendee 1 (`Aarav Patel`, Pass Code: `REG-3F426A8E`).
4. Registered Attendee 2 (`Neha Gupta`, Pass Code: `REG-E1E0A179`).
5. Staff admitted Attendee 1 at turnstile (`NORTH_TURNSTILE_A`).
6. Previewed recipient snapshot: exactly 1 checked-in, 1 eligible, 0 opted-out. Unchecked-in attendee was excluded.
7. Composed and dispatched `Security Advisory` alert.
8. Verified dispatch outcome: 1 message queued and accepted (`SM_MOCK_8fe14337fddbb469`).
9. Verified vector QR SVG rendered at `/api/v1/public/pass/REG-3F426A8E`.

---

## 7. Manual Step-by-Step Operator Guide

### Step 1: Access Events & SMS Management
1. Open `http://localhost:5173/` in your browser.
2. Press keyboard shortcut **`[6]`** or click **`Events & SMS`** in the main navigation bar.
3. Authenticate using your staff credentials.

### Step 2: Create and Publish an Event
1. In the **Event Management & QR Codes** tab, click **`+ Create New Event`**.
2. Enter Event Name (e.g. `Darshini Safety Conclave`), venue location, start and end times, and optional max capacity.
3. Click **`Create Event`**.
4. In the events table, click **`Publish`** to open public registration.
5. Click **`📱 View QR Pass`** to view the registration QR code or copy the public registration link.

### Step 3: Public Attendee Registration
1. Open the copied registration URL (e.g. `http://localhost:5173/?event=darshini-safety-conclave`) in a mobile browser or private window.
2. Enter your Name and 10-digit mobile number (`9876543210`).
3. Check the SMS consent box and click **`Register & Get Admission Pass`**.
4. You will immediately receive your **Official Entry Pass** with your unique code (e.g. `REG-A1B2C3D4`) and vector QR code. Note that you are **NOT** eligible for emergency alerts yet.

### Step 4: Turnstile Check-in
1. Return to the Command Center and switch to the **`🎟️ Gate Check-in Station`** tab.
2. Enter or scan the attendee's pass code (`REG-A1B2C3D4`) into the scanner field and press Enter.
3. The turnstile will display: `✓ ADMITTED: [Name] at [Time]`. The attendee is now officially verified on-site and eligible for safety broadcasts.

### Step 5: Compose and Dispatch Targeted Emergency SMS
1. Switch to the **`🚨 Targeted Emergency SMS Broadcast`** tab.
2. Select severity: `INFO`, `WARNING`, or `CRITICAL`.
3. Enter title and message body.
4. Click **`Preview Recipient Pool`**: verify that only admitted attendees are shown in the eligible count.
5. Click **`Create Draft Alert`**.
6. If critical, have a second manager click **`Approve (2-Person)`**.
7. Click **`Dispatch SMS`**, confirm the dialog, and watch the delivery audit register update in real time with provider acceptance IDs and masked recipient logs.
