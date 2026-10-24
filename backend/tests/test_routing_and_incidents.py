"""
Darshini - Test Suite: Emergency Routing & Safety Incidents
Automated unit, integration, and security tests covering:
  - Dijkstra shortest path solver and alternative bypass discovery
  - Blocked edge persistence and route recalculation
  - Reopening edges and path restoration
  - Unreachable route handling (NO_PATH_AVAILABLE)
  - Incident lifecycle (OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED)
  - Append-only incident audit timeline
  - Summary metrics computation from stored database records
  - CWE-1236 CSV Formula Injection defense
  - HTTP API endpoints for routing and incidents
"""

import os
import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.core.auth import ROLE_ADMIN, ROLE_EVENT_MANAGER, create_access_token
from app.db.database import get_connection
from app.db.migrations import run_migrations
from app.main import app
from app.schemas_incidents import IncidentCreateRequest, IncidentStatusTransitionRequest
from app.schemas_routing import RouteCalculationRequest
from app.services.incident_service import IncidentService, sanitize_csv_cell
from app.services.routing_service import RoutingService
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
# 1. Emergency Routing & Pathfinding Tests
# -------------------------------------------------------------

def test_routing_nodes_and_edges_loading():
    """Verifies graph nodes and base edges load from topology."""
    nodes = RoutingService.get_all_nodes()
    assert len(nodes) >= 13
    gate_a = next((n for n in nodes if n.id == "node_gate_a"), None)
    assert gate_a is not None
    assert gate_a.type == "GATE"
    assert len(gate_a.coordinates) == 2

    edges = RoutingService.get_all_base_edges()
    assert len(edges) >= 16  # 12 base + 4 perimeter bypass lanes


def test_dijkstra_shortest_path_calculation(temp_db):
    """Tests valid shortest-path calculation between nodes."""
    res = RoutingService.calculate_route(
        origin_id="node_gate_a",
        destination_id="node_pavilion_east",
        db_path=temp_db,
    )
    assert res.status == "FOUND"
    assert res.primary_route is not None
    # Gate A -> North Plaza -> Central Promenade -> Pavilion East
    assert res.primary_route.node_path == [
        "node_gate_a",
        "node_north_plaza",
        "node_central_promenade",
        "node_pavilion_east",
    ]
    # Expected distance: 70 + 180 + 210 = 460 meters
    assert res.primary_route.total_distance_meters == 460.0
    # Travel time at 1.2 m/s: 460 / 1.2 = 383.3 seconds (~6.4 mins)
    assert res.primary_route.estimated_travel_time_sec == pytest.approx(383.3, 0.5)
    assert res.primary_route.estimated_travel_time_minutes == pytest.approx(6.4, 0.1)


def test_routing_same_node_distance_zero(temp_db):
    """Routing from a node to itself must return zero distance."""
    res = RoutingService.calculate_route("node_gate_a", "node_gate_a", db_path=temp_db)
    assert res.status == "FOUND"
    assert res.primary_route.total_distance_meters == 0.0
    assert res.primary_route.estimated_travel_time_sec == 0.0


def test_routing_invalid_endpoints(temp_db):
    """Invalid node IDs must raise KeyError."""
    with pytest.raises(KeyError) as exc_info:
        RoutingService.calculate_route("non_existent_origin", "node_gate_a", db_path=temp_db)
    assert "non_existent_origin" in str(exc_info.value)

    with pytest.raises(KeyError) as exc_info:
        RoutingService.calculate_route("node_gate_a", "non_existent_dest", db_path=temp_db)
    assert "non_existent_dest" in str(exc_info.value)


def test_edge_blocking_recalculates_or_unreachability(temp_db):
    """
    Tests that blocking an edge forces route recalculation via alternative bypass,
    and blocking remaining bypasses reports NO_PATH_AVAILABLE.
    """
    # 1. Normal route from Gate A to Gate C: direct spine (515m)
    res_initial = RoutingService.calculate_route("node_gate_a", "node_gate_c", db_path=temp_db)
    assert res_initial.status == "FOUND"
    assert res_initial.primary_route.total_distance_meters == 515.0

    # 2. Block the North Spine Concourse Walkway
    block_info = RoutingService.block_edge(
        edge_id="edge_north_spine",
        reason="Crowd surge overflow at central concourse",
        operator_name="Operator Alice",
        db_path=temp_db,
    )
    assert block_info["is_blocked"] is True

    # 3. Route should now automatically take the Perimeter Bypass lane (1,775m)!
    res_bypassed = RoutingService.calculate_route("node_gate_a", "node_gate_c", db_path=temp_db)
    assert res_bypassed.status == "FOUND"
    assert "node_north_plaza" not in res_bypassed.primary_route.node_path
    assert res_bypassed.primary_route.total_distance_meters == 1775.0

    # 4. Now also block the perimeter bypass lane
    RoutingService.block_edge(
        edge_id="edge_bypass_gate_a_ne",
        reason="Fallen debris blocking perimeter bypass lane",
        operator_name="Operator Alice",
        db_path=temp_db,
    )

    # 5. Route must now report NO_PATH_AVAILABLE!
    res_blocked = RoutingService.calculate_route("node_gate_a", "node_gate_c", db_path=temp_db)
    assert res_blocked.status == "NO_PATH_AVAILABLE"
    assert res_blocked.primary_route is None
    assert "edge_north_spine" in res_blocked.blocked_edges_encountered
    assert "edge_bypass_gate_a_ne" in res_blocked.blocked_edges_encountered

    # 6. Reopen North Spine: path must be restored!
    reopen_info = RoutingService.reopen_edge(
        edge_id="edge_north_spine",
        reason="Concourse cleared by security",
        operator_name="Operator Bob",
        db_path=temp_db,
    )
    assert reopen_info["is_blocked"] is False

    res_restored = RoutingService.calculate_route("node_gate_a", "node_gate_c", db_path=temp_db)
    assert res_restored.status == "FOUND"
    assert res_restored.primary_route.total_distance_meters == 515.0


def test_edge_history_recording(temp_db):
    """Verifies that edge block and reopen actions produce audit history."""
    RoutingService.block_edge("edge_concourse_east", "Temporary crowd hold", operator_name="Staff1", db_path=temp_db)
    RoutingService.reopen_edge("edge_concourse_east", "Hold lifted", operator_name="Staff2", db_path=temp_db)

    history = RoutingService.get_edge_history("edge_concourse_east", db_path=temp_db)
    assert len(history) == 2
    assert history[0].action == "REOPEN"
    assert history[0].operator_username == "Staff2"
    assert history[1].action == "BLOCK"
    assert history[1].operator_username == "Staff1"


# -------------------------------------------------------------
# 2. Safety Incidents & Lifecycle Audit Tests
# -------------------------------------------------------------

def test_incident_creation_and_retrieval(temp_db):
    """Tests creating an incident with initial audit timeline entry."""
    req = IncidentCreateRequest(
        title="Gate A Turnstile Surge",
        description="High crowd concentration queueing past outer barricades.",
        severity="WARNING",
        category="CROWD_DENSITY",
        zone_id="zone_gate_a",
        zone_name="North Gate Plaza",
        source="CAMERA_ASSISTED",
    )
    inc = IncidentService.create_incident(req, reported_by="operator_dan", db_path=temp_db)

    assert inc.incident_number.startswith("INC-")
    assert inc.status == "OPEN"
    assert inc.severity == "WARNING"
    assert inc.category == "CROWD_DENSITY"
    assert len(inc.history) == 1
    assert inc.history[0].action == "CREATED"


def test_incident_lifecycle_transitions(temp_db):
    """Tests valid lifecycle status transitions and audit records."""
    req = IncidentCreateRequest(
        title="Minor Medical Assistance",
        description="Dehydration case at East Arena.",
        severity="INFO",
        category="MEDICAL",
    )
    inc = IncidentService.create_incident(req, reported_by="first_aid_lead", db_path=temp_db)

    # 1. Acknowledge
    ack = IncidentService.transition_status(
        inc.id,
        "ACKNOWLEDGED",
        operator_username="first_responder_1",
        note="Paramedic team dispatched.",
        db_path=temp_db,
    )
    assert ack.status == "ACKNOWLEDGED"

    # 2. In Progress
    inp = IncidentService.transition_status(
        inc.id,
        "IN_PROGRESS",
        operator_username="first_responder_1",
        note="Patient receiving fluids.",
        db_path=temp_db,
    )
    assert inp.status == "IN_PROGRESS"

    # 3. Add operator note without status transition
    with_note = IncidentService.add_operator_note(
        inc.id,
        "Patient stable, preparing to clear.",
        operator_username="first_responder_1",
        db_path=temp_db,
    )
    assert with_note.status == "IN_PROGRESS"

    # 4. Resolve
    resolved = IncidentService.transition_status(
        inc.id,
        "RESOLVED",
        operator_username="first_responder_1",
        note="Patient cleared and released.",
        db_path=temp_db,
    )
    assert resolved.status == "RESOLVED"
    assert resolved.resolved_at is not None

    # 5. Verify timeline history
    full_inc = IncidentService.get_incident_by_id(inc.id, db_path=temp_db)
    actions = [h.action for h in full_inc.history]
    assert actions == ["CREATED", "STATUS_CHANGE", "STATUS_CHANGE", "NOTE_ADDED", "STATUS_CHANGE"]


def test_incident_invalid_status_rejection(temp_db):
    """Tests that invalid statuses are rejected."""
    req = IncidentCreateRequest(title="Test", severity="INFO", category="OPERATIONAL")
    inc = IncidentService.create_incident(req, reported_by="user", db_path=temp_db)

    with pytest.raises(ValueError) as exc_info:
        IncidentService.transition_status(inc.id, "INVALID_STATUS", operator_username="user", db_path=temp_db)
    assert "Invalid status" in str(exc_info.value)


def test_incident_metrics_calculation(temp_db):
    """Tests summary KPI metrics calculation from persistent records."""
    # Create 3 incidents: 1 Resolved, 1 Open, 1 In Progress
    IncidentService.create_incident(
        IncidentCreateRequest(title="Inc 1", severity="CRITICAL", category="FIRE_HAZARD"),
        reported_by="u1",
        db_path=temp_db,
    )
    inc2 = IncidentService.create_incident(
        IncidentCreateRequest(title="Inc 2", severity="WARNING", category="CROWD_DENSITY"),
        reported_by="u1",
        db_path=temp_db,
    )
    IncidentService.transition_status(inc2.id, "RESOLVED", operator_username="u1", db_path=temp_db)

    metrics = IncidentService.get_summary_metrics(db_path=temp_db)
    assert metrics.total_incidents == 2
    assert metrics.active_incidents == 1
    assert metrics.resolved_incidents == 1
    assert metrics.severity_breakdown["CRITICAL"] == 1
    assert metrics.severity_breakdown["WARNING"] == 1
    assert metrics.category_breakdown["FIRE_HAZARD"] == 1


# -------------------------------------------------------------
# 3. Security: CSV Formula Injection Defense
# -------------------------------------------------------------

def test_csv_formula_injection_defense():
    """Verifies CWE-1236 Formula Injection sanitization."""
    assert sanitize_csv_cell("=1+1") == "'=1+1"
    assert sanitize_csv_cell("@SUM(A1:A10)") == "'@SUM(A1:A10)"
    assert sanitize_csv_cell("+cmd|'/c calc'!A0") == "'+cmd|'/c calc'!A0"
    assert sanitize_csv_cell("-5+2") == "'-5+2"
    assert sanitize_csv_cell("\tmalicious_tab") == "'\tmalicious_tab"
    assert sanitize_csv_cell("Safe Normal Text") == "Safe Normal Text"


def test_csv_export_endpoint(client, temp_db):
    """Tests CSV export HTTP endpoint and cell escaping."""
    IncidentService.create_incident(
        IncidentCreateRequest(
            title="=cmd|'/C calc'!A0",
            description="Testing formula injection",
            severity="WARNING",
            category="OPERATIONAL",
        ),
        reported_by="tester",
        db_path=temp_db,
    )

    resp = client.get("/api/v1/incidents/export/csv")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment; filename=" in resp.headers["content-disposition"]
    # Check that dangerous leading '=' is escaped with single quote
    assert "'=cmd|'/C calc'!A0" in resp.text


# -------------------------------------------------------------
# 4. HTTP API Endpoints Tests
# -------------------------------------------------------------

def test_http_routing_calculate_and_block_cycle(client, temp_db):
    """Tests calculating route via HTTP, blocking edge, and seeing route change."""
    # Seed operator
    operator = UserService.create_user("route_op", "OperatorPass123", "Routing Operator", ROLE_EVENT_MANAGER, db_path=temp_db)
    login_resp = client.post("/api/v1/auth/login", json={"username": "route_op", "password": "OperatorPass123"})
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Calculate normal route
    route_resp = client.post(
        "/api/v1/routing/calculate",
        json={"origin": "node_gate_a", "destination": "node_gate_c"},
    )
    assert route_resp.status_code == 200
    data = route_resp.json()
    assert data["status"] == "FOUND"
    assert data["primary_route"]["total_distance_meters"] == 515.0

    # 2. Block edge
    block_resp = client.post(
        "/api/v1/routing/edges/edge_north_spine/block",
        json={"reason": "Water main leak on north spine"},
        headers=headers,
    )
    assert block_resp.status_code == 200
    assert block_resp.json()["is_blocked"] is True

    # 3. Recalculate route - must use bypass
    route_resp2 = client.post(
        "/api/v1/routing/calculate",
        json={"origin": "node_gate_a", "destination": "node_gate_c"},
    )
    assert route_resp2.status_code == 200
    data2 = route_resp2.json()
    assert data2["primary_route"]["total_distance_meters"] == 1775.0

    # 4. Reopen edge
    reopen_resp = client.post(
        "/api/v1/routing/edges/edge_north_spine/reopen",
        json={"reason": "Leak repaired"},
        headers=headers,
    )
    assert reopen_resp.status_code == 200
    assert reopen_resp.json()["is_blocked"] is False


def test_routing_unauthorized_operations_rejected(client):
    """Verifies that unauthenticated write operations return 401."""
    # Attempt to block without token
    block_resp = client.post(
        "/api/v1/routing/edges/edge_north_spine/block",
        json={"reason": "Unauthorized block attempt"},
    )
    assert block_resp.status_code == 401

    # Attempt to reopen without token
    reopen_resp = client.post(
        "/api/v1/routing/edges/edge_north_spine/reopen",
        json={"reason": "Unauthorized reopen attempt"},
    )
    assert reopen_resp.status_code == 401


def test_routing_invalid_edge_id_rejected(client, temp_db):
    """Verifies that non-existent edge IDs return 404."""
    operator = UserService.create_user("route_op2", "OperatorPass123", "Routing Operator", ROLE_ADMIN, db_path=temp_db)
    login_resp = client.post("/api/v1/auth/login", json={"username": "route_op2", "password": "OperatorPass123"})
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post(
        "/api/v1/routing/edges/non_existent_edge_id/block",
        json={"reason": "Testing invalid ID"},
        headers=headers,
    )
    assert resp.status_code == 404


def test_routing_simulated_blocked_edges_isolation(temp_db):
    """Verifies that ephemeral simulated blocked edges affect pathfinding without modifying database."""
    # Normal route from Gate A to Gate C: direct spine (515m)
    res_normal = RoutingService.calculate_route("node_gate_a", "node_gate_c", db_path=temp_db)
    assert res_normal.primary_route.total_distance_meters == 515.0

    # Calculate with simulated block on edge_north_spine
    res_sim = RoutingService.calculate_route(
        "node_gate_a",
        "node_gate_c",
        simulated_blocked_edges=["edge_north_spine"],
        db_path=temp_db,
    )
    assert res_sim.status == "FOUND"
    assert res_sim.primary_route.total_distance_meters == 1775.0
    assert "edge_north_spine" in res_sim.blocked_edges_encountered

    # Verify that the persistent database blocked_edges table is still EMPTY
    persisted_blocked = RoutingService.get_blocked_edge_ids(db_path=temp_db)
    assert len(persisted_blocked) == 0


def test_incident_unauthorized_operations_rejected(client):
    """Verifies that unauthenticated incident creation and updates return 401."""
    # Create incident without token
    create_resp = client.post(
        "/api/v1/incidents",
        json={"title": "Unauthorized Incident", "severity": "WARNING", "category": "CROWD_DENSITY"},
    )
    assert create_resp.status_code == 401


def test_incident_assignment_and_audit(temp_db):
    """Tests assigning an incident and auditing the assignment event."""
    inc = IncidentService.create_incident(
        IncidentCreateRequest(title="Stairway Congestion", severity="ADVISORY", category="OPERATIONAL"),
        reported_by="operator_dan",
        db_path=temp_db,
    )
    assert inc.assigned_to is None

    # Assign responsibility
    assigned = IncidentService.assign_incident(
        incident_id=inc.id,
        assigned_to="staff_member_7",
        assigned_to_name="Officer Jane Doe",
        operator_username="operator_dan",
        note="Dispatched to clear stairway.",
        db_path=temp_db,
    )
    assert assigned.assigned_to == "staff_member_7"
    assert assigned.assigned_to_name == "Officer Jane Doe"

    # Verify timeline contains ASSIGNED action
    history = assigned.history
    actions = [h.action for h in history]
    assert "ASSIGNED" in actions
    assign_event = next(h for h in history if h.action == "ASSIGNED")
    assert "Officer Jane Doe" in assign_event.note


def test_incident_time_range_and_source_filtering(temp_db):
    """Tests filtering incidents by time range and source."""
    # Create 2 incidents with different sources
    inc1 = IncidentService.create_incident(
        IncidentCreateRequest(
            title="Observation 1",
            severity="WARNING",
            category="CROWD_DENSITY",
            source="CAMERA_ASSISTED",
        ),
        reported_by="camera_watcher",
        db_path=temp_db,
    )
    inc2 = IncidentService.create_incident(
        IncidentCreateRequest(
            title="Observation 2",
            severity="CRITICAL",
            category="FIRE_HAZARD",
            source="OPERATOR_REPORTED",
        ),
        reported_by="patrol_guard",
        db_path=temp_db,
    )

    # Filter by source
    cam_incidents = IncidentService.list_incidents(source="CAMERA_ASSISTED", db_path=temp_db)
    assert len(cam_incidents) == 1
    assert cam_incidents[0].id == inc1.id

    op_incidents = IncidentService.list_incidents(source="OPERATOR_REPORTED", db_path=temp_db)
    assert len(op_incidents) == 1
    assert op_incidents[0].id == inc2.id

    # Filter by time range
    t_start = "2020-01-01T00:00:00"
    t_end = "2030-01-01T00:00:00"
    in_range = IncidentService.list_incidents(start_time=t_start, end_time=t_end, db_path=temp_db)
    assert len(in_range) == 2

    out_of_range = IncidentService.list_incidents(start_time="2099-01-01T00:00:00", db_path=temp_db)
    assert len(out_of_range) == 0

