"""
Darshini - Database Schema Migrations
Applies schema definitions incrementally, tracking applied versions,
while strictly preserving existing detection_history and operational data.
"""

import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Union

from app.db.database import get_db

logger = logging.getLogger("darshini.migrations")

MIGRATION_001_SQL = """
-- Core management users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN', 'EVENT_MANAGER', 'CHECKIN_OPERATOR')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Events table
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    venue_name TEXT NOT NULL,
    venue_zone_id TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    max_capacity INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')),
    qr_token TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
CREATE INDEX IF NOT EXISTS idx_events_qr_token ON events(qr_token);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- Event registrations table (Visitor PII restricted & masked)
CREATE TABLE IF NOT EXISTS event_registrations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    attendee_name TEXT NOT NULL,
    phone_number_e164 TEXT NOT NULL,
    phone_masked TEXT NOT NULL,
    registration_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'REGISTERED' CHECK(status IN ('REGISTERED', 'CHECKED_IN', 'CANCELLED')),
    opt_out_sms INTEGER NOT NULL DEFAULT 0,
    registered_at TEXT NOT NULL,
    ip_hash TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_registrations_event ON event_registrations(event_id, status);
CREATE INDEX IF NOT EXISTS idx_registrations_code ON event_registrations(registration_code);
CREATE INDEX IF NOT EXISTS idx_registrations_phone ON event_registrations(event_id, phone_number_e164);

-- Event check-ins table (Physical verification gate)
CREATE TABLE IF NOT EXISTS event_checkins (
    id TEXT PRIMARY KEY,
    registration_id TEXT UNIQUE NOT NULL,
    event_id TEXT NOT NULL,
    checked_in_at TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'OPERATOR_SCAN' CHECK(method IN ('OPERATOR_SCAN', 'OPERATOR_MANUAL', 'KIOSK')),
    operator_id TEXT NOT NULL,
    gate_terminal TEXT NOT NULL DEFAULT 'GATE_1',
    is_active INTEGER NOT NULL DEFAULT 1,
    reversal_reason TEXT,
    reversed_at TEXT,
    reversed_by TEXT,
    FOREIGN KEY (registration_id) REFERENCES event_registrations(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_checkins_event ON event_checkins(event_id, is_active);

-- Event alerts table
CREATE TABLE IF NOT EXISTS event_alerts (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    title TEXT NOT NULL,
    message_body TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('INFO', 'WARNING', 'CRITICAL')),
    alert_category TEXT NOT NULL DEFAULT 'SAFETY' CHECK(alert_category IN ('SAFETY', 'EVACUATION', 'WEATHER', 'OPERATIONAL')),
    lifecycle_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle_status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'SENDING', 'COMPLETED', 'FAILED')),
    created_by TEXT NOT NULL,
    approved_by TEXT,
    created_at TEXT NOT NULL,
    dispatched_at TEXT,
    completed_at TEXT,
    eligible_recipient_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_alerts_event ON event_alerts(event_id, created_at DESC);

-- SMS deliveries table
CREATE TABLE IF NOT EXISTS sms_deliveries (
    id TEXT PRIMARY KEY,
    alert_id TEXT NOT NULL,
    registration_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    recipient_phone_e164 TEXT NOT NULL,
    recipient_phone_masked TEXT NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN')),
    provider_name TEXT NOT NULL DEFAULT 'mock',
    provider_message_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (alert_id) REFERENCES event_alerts(id) ON DELETE CASCADE,
    FOREIGN KEY (registration_id) REFERENCES event_registrations(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deliveries_alert ON sms_deliveries(alert_id, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_idempotency ON sms_deliveries(idempotency_key);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    target_entity TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
"""

MIGRATION_002_SQL = """
-- Blocked edges table (persisted road & corridor closures)
CREATE TABLE IF NOT EXISTS blocked_edges (
    edge_id TEXT PRIMARY KEY,
    is_blocked INTEGER NOT NULL DEFAULT 1,
    reason TEXT NOT NULL,
    blocked_by TEXT,
    blocked_by_name TEXT,
    source TEXT NOT NULL DEFAULT 'OPERATOR' CHECK(source IN ('OPERATOR', 'SIMULATION')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocked_edges_active ON blocked_edges(is_blocked);

-- Blocked edge audit history
CREATE TABLE IF NOT EXISTS blocked_edge_history (
    id TEXT PRIMARY KEY,
    edge_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('BLOCK', 'REOPEN')),
    reason TEXT NOT NULL,
    operator_id TEXT,
    operator_username TEXT,
    source TEXT NOT NULL DEFAULT 'OPERATOR',
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocked_edge_history_edge ON blocked_edge_history(edge_id, timestamp DESC);

-- Incidents table
CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    incident_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'WARNING', 'ADVISORY', 'INFO')),
    category TEXT NOT NULL CHECK(category IN ('CROWD_DENSITY', 'PERIMETER_BREACH', 'MEDICAL', 'FIRE_HAZARD', 'INFRASTRUCTURE', 'LOST_PERSON', 'OPERATIONAL')),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
    zone_id TEXT,
    zone_name TEXT,
    camera_id TEXT,
    event_id TEXT,
    related_edge_id TEXT,
    source TEXT NOT NULL DEFAULT 'OPERATOR_REPORTED' CHECK(source IN ('OPERATOR_REPORTED', 'CAMERA_ASSISTED', 'SIMULATION_TRIGGERED')),
    reported_by TEXT NOT NULL,
    assigned_to TEXT,
    assigned_to_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_zone ON incidents(zone_id);

-- Incident timeline audit history
CREATE TABLE IF NOT EXISTS incident_history (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('CREATED', 'STATUS_CHANGE', 'ASSIGNED', 'NOTE_ADDED', 'SEVERITY_CHANGE')),
    previous_status TEXT,
    new_status TEXT,
    operator_id TEXT,
    operator_username TEXT,
    note TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_incident_history_incident ON incident_history(incident_id, timestamp ASC);
"""

MIGRATIONS = [
    (1, "001_initial_event_and_auth_schema", MIGRATION_001_SQL),
    (2, "002_routing_and_incidents_schema", MIGRATION_002_SQL),
]


def run_migrations(db_path: Optional[Union[str, Path]] = None) -> None:
    """
    Applies any unapplied migrations to the target database.
    Safe to run repeatedly; preserves all pre-existing tables.
    """
    with get_db(db_path) as conn:
        # Create migration tracking table if not present
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );
            """
        )

        # Get set of already applied versions
        cursor = conn.execute("SELECT version FROM schema_migrations;")
        applied_versions = {row["version"] for row in cursor.fetchall()}

        for version, name, sql in MIGRATIONS:
            if version not in applied_versions:
                logger.info("Applying database migration %03d: %s...", version, name)
                conn.executescript(sql)
                now_utc = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);",
                    (version, name, now_utc),
                )
                logger.info("Migration %03d successfully applied.", version)
            else:
                logger.debug("Migration %03d already applied, skipping.", version)
