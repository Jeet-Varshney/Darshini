# Darshini — Emergency Routing & Incidents/Reports Combined Implementation Report

**Status:** Completed, Fully Integrated & Verified  
**Date:** October 2026  
**Environment:** Linux / FastAPI Backend (Python 3.13) / React 18 + Vite (TypeScript) / SQLite3 (WAL mode)  
**Test Suite Status:** 79/79 Tests Passing (100% Pass Rate across Camera, CV Inference, Simulation, Detection History, Event Registration/SMS, and Routing/Incidents)  
**Frontend Build Status:** `npm run build` completed with code 0 (zero TypeScript errors)  

---

## 1. Verified Current State Before Changes

Prior to this implementation run, the Darshini Command Center platform possessed:
- A light-themed Command Center UI (`#365F8D` steel-blue accent) with five main screens plus an Event Registration & Targeted SMS module.
- A genuine YOLOv8n object detection pipeline with live camera streaming, client-frame inference, and SQLite-backed detection history (`detection_history` table).
- A NetworkX-based Scenario Lab evaluating synthetic crowd flow dynamics (`road_network.json` containing 13 nodes and 12 base corridor edges).
- SQLite-backed event management, QR check-in passes, and two-person authorization for emergency SMS broadcasts (`darshini.db`).
- Unimplemented placeholders for `EmergencyRoutingPlaceholder` and `IncidentsReportsPlaceholder`.

### Strict Preservation Rules Maintained
- Preserved all existing user changes and uncommitted work across `backend/` and `frontend/`.
- Executed no Git commits or pushes.
- Never reset, reverted, cleaned, or deleted any unrelated files.
- Preserved existing database tables (`detection_history`, `users`, `events`, `event_registrations`, `sms_dispatches`, `approval_requests`).
- Maintained the light Command Center theme, `#365F8D` steel-blue accent, fictional venue topology, and responsive layouts.

---

## 2. Actual Files Changed and Their Purpose

### Backend Persistence & Schemas
- [backend/app/db/migrations.py](file:///home/jyno/Projects/Darshini/backend/app/db/migrations.py): Added `MIGRATION_002_SQL` defining schemas and indexes for `blocked_edges`, `blocked_edge_history`, `incidents`, and `incident_history`. Enforces `PRAGMA foreign_keys = ON;`.
- [backend/app/schemas_routing.py](file:///home/jyno/Projects/Darshini/backend/app/schemas_routing.py): Pydantic models for routing nodes, edges, route requests/responses, segment breakdowns, blocked edge audit records, and simulation isolation flags (`simulated_blocked_edges`, `source`).
- [backend/app/schemas_incidents.py](file:///home/jyno/Projects/Darshini/backend/app/schemas_incidents.py): Pydantic models for incident creation, lifecycle status updates, staff responsibility assignment (`IncidentAssignRequest`), operator notes, incident history, and summary KPI analytics.

### Backend Services & Routing Algorithms
- [backend/app/services/routing_service.py](file:///home/jyno/Projects/Darshini/backend/app/services/routing_service.py):
  - Integrates the venue topology graph from `road_network.json` and incorporates four perimeter bypass corridors (`PERIMETER_BYPASS_EDGES`) to guarantee alternate clearance routes without altering the base simulation network.
  - Implements Dijkstra shortest-path calculations (`nx.shortest_path`) weighted strictly by physical distance in meters.
  - Calculates estimated travel time using a documented, transparent walking speed assumption of 1.2 m/s ($v = 1.2\text{ m/s}$).
  - Computes alternative bypass routes using NetworkX `shortest_simple_paths`, excluding blocked corridors.
  - Supports ephemeral `simulated_blocked_edges` from Scenario Lab to keep simulation runs strictly isolated from persistent operational closures.
  - Detects unreachable conditions (`NO_PATH_AVAILABLE`) when bottlenecks isolate a node.
  - Manages persistent edge closures (`blocked_edges`) and records append-only audit entries (`blocked_edge_history`).
- [backend/app/services/incident_service.py](file:///home/jyno/Projects/Darshini/backend/app/services/incident_service.py):
  - Manages incident ticketing lifecycle (`OPEN` $\rightarrow$ `ACKNOWLEDGED` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `RESOLVED` $\rightarrow$ `CLOSED`).
  - Automatically generates human-readable ticket numbers (`INC-2026-XXXX`).
  - Enforces valid lifecycle status transitions and rejects invalid state mutations.
  - Implements staff responsibility assignment (`assign_incident`) with recorded audit trail.
  - Supports multi-attribute filtering (status, severity, category, source, start time, end time, search query).
  - Maintains an append-only timeline table (`incident_history`) recording every action, previous/new status, operator identity, and note.
  - Computes real-time KPI metrics (total, active, resolved, average resolution time, breakdown maps) strictly from persisted SQLite rows.
  - Generates CSV exports with strict formula injection sanitization (CWE-1236 defense).

### Backend API Endpoints & Main Integration
- [backend/app/api/routes_routing.py](file:///home/jyno/Projects/Darshini/backend/app/api/routes_routing.py): Endpoints for `/api/v1/routing/nodes`, `/api/v1/routing/edges`, `/api/v1/routing/calculate`, `/api/v1/routing/edges/{id}/block`, `/api/v1/routing/edges/{id}/reopen`, `/api/v1/routing/edges/{id}/history`. Requires authenticated staff token for block/reopen mutations.
- [backend/app/api/routes_incidents.py](file:///home/jyno/Projects/Darshini/backend/app/api/routes_incidents.py): Endpoints for `/api/v1/incidents` (GET/POST), `/api/v1/incidents/{id}` (GET), `/api/v1/incidents/{id}/status` (PATCH), `/api/v1/incidents/{id}/assign` (PATCH), `/api/v1/incidents/{id}/notes` (POST), `/api/v1/incidents/analytics/summary` (GET), `/api/v1/incidents/export/csv` (GET).
- [backend/app/main.py](file:///home/jyno/Projects/Darshini/backend/app/main.py): Registered `routing_router` and `incidents_router` with CORS and lifecycle management.

### Frontend Types, API Clients, and Styles
- [frontend/src/types/routing.ts](file:///home/jyno/Projects/Darshini/frontend/src/types/routing.ts): TypeScript interfaces for `RoutingNode`, `RoutingEdge`, `RouteSegment`, `CalculatedRoute`, `RouteCalculationResponse`, `BlockedEdgeAuditRecord`.
- [frontend/src/types/incidents.ts](file:///home/jyno/Projects/Darshini/frontend/src/types/incidents.ts): TypeScript interfaces for `IncidentRecord`, `IncidentHistoryRecord`, `IncidentAssignRequest`, `IncidentSummaryMetrics`, `IncidentSeverity`, `IncidentCategory`, `IncidentStatus`.
- [frontend/src/services/routingApi.ts](file:///home/jyno/Projects/Darshini/frontend/src/services/routingApi.ts): REST client for routing computation and edge blocking operations, supporting `simulatedBlockedEdges` and `source`.
- [frontend/src/services/incidentApi.ts](file:///home/jyno/Projects/Darshini/frontend/src/services/incidentApi.ts): REST client for incidents listing, creation, lifecycle transitions, assignment, notes, and filtered CSV download URLs.
- [frontend/src/styles/routing.css](file:///home/jyno/Projects/Darshini/frontend/src/styles/routing.css): Styles for interactive clearance corridors, GIS Leaflet map container, custom marker pins, SVG schematic map, blocked edge manager drawer, audit history modal, and operator auth banner.
- [frontend/src/styles/incidents.css](file:///home/jyno/Projects/Darshini/frontend/src/styles/incidents.css): Styles for KPI cards, severity/status pills, incident register tables, detail drawer, staff assignment form, audit timeline feeds, and analytics breakdown bars.

### Frontend Screens & Cross-Module Integration
- [frontend/src/screens/EmergencyRoutingScreen.tsx](file:///home/jyno/Projects/Darshini/frontend/src/screens/EmergencyRoutingScreen.tsx):
  - Dual map views: Interactive GIS Leaflet Map (`tiles`) with OpenStreetMap base layer and Vector Schematic SVG (`schematic`).
  - Leaflet implementation with strict lifecycle safety (`isMountedRef`, `isDisposed = true`, `ResizeObserver` + `requestAnimationFrame`, explicit timer cancel, and no orphan `invalidateSize()` calls).
  - Operator authentication bar and modal with demo quick-login option (`operator` / `OperatorPass123`).
  - Corridor Blockage Manager with search filter, reason input, and an `[Audit History]` modal on each edge displaying chronological audit events.
  - Turn-by-turn route corridors and alternative bypass tabs.
  - Accepts `initialEdgeId` to automatically filter and focus on a corridor referenced from an incident.
- [frontend/src/screens/IncidentsReportsScreen.tsx](file:///home/jyno/Projects/Darshini/frontend/src/screens/IncidentsReportsScreen.tsx):
  - KPI Metrics overview derived from persisted SQLite storage: Total Filed, Active Surges/Hazards, Successfully Resolved, Average Resolution Duration.
  - Multi-attribute filter toolbar: Status, Severity, Category, Source, Start Date, End Date, and Search Query.
  - Staff responsibility assignment section in detail drawer allowing operators to assign tickets with documented reason.
  - Cross-module inspection link: Clicking `Inspect ➔` on a corridor ID navigates directly to Emergency Routing.
  - Camera verification link: Clicking `Camera ➔` navigates directly to Camera Detection for that zone.
  - Accepts `prefillData` from Camera Detection to automatically initialize incident creation modals with verified camera telemetry.
  - Safety Analytics & Metrics tab displaying severity breakdown, category distribution, and lifecycle pipeline progress bars.
  - Filter-aware CSV export button generating sanitized CSV downloads.
- [frontend/src/screens/CameraDetectionScreen.tsx](file:///home/jyno/Projects/Darshini/frontend/src/screens/CameraDetectionScreen.tsx):
  - Added `Actions` column to the Persistent Detection History table.
  - Added `⚠️ Escalate` button on each telemetry row to allow operators to escalate genuine YOLOv8 camera observations directly into an incident report.
- [frontend/src/App.tsx](file:///home/jyno/Projects/Darshini/frontend/src/App.tsx):
  - Managed cross-navigation states: `targetRoutingEdgeId` and `targetIncidentPrefill`.
  - Wired escalation from `CameraDetectionScreen` to `IncidentsReportsScreen`.
  - Wired corridor inspection from `IncidentsReportsScreen` to `EmergencyRoutingScreen`.
  - Wired camera inspection from `IncidentsReportsScreen` to `CameraDetectionScreen`.

---

## 3. Route Algorithm and Edge-Weight Semantics

### Graph Network Representation
- **Nodes (13 base):** Gates (`node_gate_a`, `node_gate_b`, `node_gate_c`, `node_gate_d`), plazas (`node_north_plaza`, `node_south_terminal`), corridors/intersections (`node_central_promenade`, `node_pavilion_east`, `node_west_corridor`), and perimeter road junctions (`node_perimeter_ne`, `node_perimeter_se`, `node_perimeter_sw`, `node_perimeter_nw`).
- **Base Edges (12):** Walkways defined in `road_network.json` connecting main concourses and gates.
- **Perimeter Bypass Edges (4):** Outer ring bypass connectors allowing alternate routing when internal spines are blocked:
  - `edge_bypass_gate_a_ne` (Gate A $\leftrightarrow$ NE Perimeter Junction, 350m)
  - `edge_bypass_gate_b_se` (Gate B $\leftrightarrow$ SE Perimeter Junction, 320m)
  - `edge_bypass_gate_c_sw` (Gate C $\leftrightarrow$ SW Perimeter Junction, 330m)
  - `edge_bypass_gate_d_nw` (Gate D $\leftrightarrow$ NW Perimeter Junction, 310m)

### Cost & Travel Time Semantics
- Edge weights represent **physical walkable distance in meters**.
- Cost is purely distance-based ($L$ meters).
- Travel time is estimated using standard pedestrian evacuation speed:
  $$\text{Time (seconds)} = \frac{\text{Distance (m)}}{1.2\text{ m/s}}$$
  $$\text{Time (minutes)} = \frac{\text{Time (seconds)}}{60}$$
- No fabricated crowd density reductions or guaranteed evacuation clearance times are claimed.

### Alternative Route Discovery & Isolation
- Primary route is calculated using Dijkstra's algorithm on the active sub-graph (with all blocked edges excluded).
- Alternative routes are generated using `nx.shortest_simple_paths`, filtered to provide up to 2 distinct valid corridors.
- If Scenario Lab passes `simulated_blocked_edges`, those edges are excluded on an in-memory graph copy, preventing demo simulations from polluting operational database records.

---

## 4. Persistence and Migration Details

SQLite migrations were applied using `backend/app/db/migrations.py`:

```sql
-- Migration 002: Emergency Routing & Incidents Module

CREATE TABLE IF NOT EXISTS blocked_edges (
    edge_id TEXT PRIMARY KEY,
    source_node TEXT NOT NULL,
    target_node TEXT NOT NULL,
    reason TEXT NOT NULL,
    blocked_by TEXT,
    blocked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_edge_history (
    id TEXT PRIMARY KEY,
    edge_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    operator_id TEXT,
    operator_username TEXT,
    source TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    incident_number TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    zone_id TEXT,
    zone_name TEXT,
    camera_id TEXT,
    event_id TEXT,
    related_edge_id TEXT,
    source TEXT NOT NULL,
    reported_by TEXT NOT NULL,
    assigned_to TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    closed_at TEXT
);

CREATE TABLE IF NOT EXISTS incident_history (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    action TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    operator_id TEXT,
    operator_username TEXT,
    note TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);
```

Indexes on `incidents(status)`, `incidents(severity)`, `incidents(created_at)`, `incident_history(incident_id)`, and `blocked_edge_history(edge_id)` ensure high query performance.

---

## 5. API Endpoints and Permissions

| Endpoint | Method | Role / Auth | Description |
|---|---|---|---|
| `/api/v1/routing/nodes` | `GET` | Public / Read-Only | Lists venue nodes with coordinates and types |
| `/api/v1/routing/edges` | `GET` | Public / Read-Only | Lists walkable corridors with current blocked status |
| `/api/v1/routing/calculate` | `POST` | Public / Read-Only | Calculates optimal and alternate routes, excluding blocked corridors |
| `/api/v1/routing/edges/{id}/block` | `POST` | Authenticated Staff | Blocks an edge with documented reason |
| `/api/v1/routing/edges/{id}/reopen` | `POST` | Authenticated Staff | Reopens a blocked edge with documented reason |
| `/api/v1/routing/edges/{id}/history` | `GET` | Authenticated Staff | Returns chronological audit trail of edge state changes |
| `/api/v1/incidents` | `GET` | Authenticated Staff | Lists incidents with optional status, severity, category, source, time-range filters |
| `/api/v1/incidents` | `POST` | Authenticated Staff | Files a new safety incident |
| `/api/v1/incidents/{id}` | `GET` | Authenticated Staff | Retrieves full incident record and complete audit history |
| `/api/v1/incidents/{id}/status` | `PATCH` | Authenticated Staff | Advances incident lifecycle with transition note |
| `/api/v1/incidents/{id}/assign` | `PATCH` | Authenticated Staff | Assigns incident responsibility to staff member with note |
| `/api/v1/incidents/{id}/notes` | `POST` | Authenticated Staff | Appends documented action note to incident timeline |
| `/api/v1/incidents/analytics/summary` | `GET` | Authenticated Staff | Returns persisted KPI aggregates |
| `/api/v1/incidents/export/csv` | `GET` | Authenticated Staff | Exports sanitized CSV report (CWE-1236 defended) |

---

## 6. Incident Lifecycle and Audit Behavior

### State Machine
```
[ OPEN ] ──(Acknowledge)──> [ ACKNOWLEDGED ] ──(Start Work)──> [ IN_PROGRESS ] ──(Resolve)──> [ RESOLVED ] ──(Close)──> [ CLOSED ]
   │                              │                                  │                              ▲
   └──────────────────────────────┴──────────────────────────────────┴──────────────────────────────┘
```

- **Reopening:** A closed or resolved incident can be reopened to `OPEN` or `IN_PROGRESS` if issues recur.
- **Assignment:** Operators can assign responsibility at any point (`ASSIGNED` action recorded in audit log).
- **Append-Only History:** Every status change or assignment inserts a record into `incident_history` capturing the exact UTC timestamp, operator ID/username, action type, old status, new status, and note.
- **Separation of Concerns:** Resolving an incident does **not** silently reopen a road or modify graph topology unless the operator explicitly issues a reopen command in the Routing module.

---

## 7. Provenance Rules and Security Defense

1. **Simulated Venue Disclaimer:** The venue topology is clearly identified across both UI and API payloads as `SIMULATED VENUE TOPOLOGY • Walk speed estimated at 1.2 m/s.`
2. **Camera Detections vs Incidents:** Camera detections are never automatically converted into emergency safety alarms. Operators manually or semi-manually file incidents referencing camera or zone IDs with source `OPERATOR_REPORTED`.
3. **Scenario Lab Isolation:** Simulated edge blockages pass `simulated_blocked_edges` to route calculation and never touch the persistent `blocked_edges` table.
4. **CWE-1236 Formula Injection Defense:** In `backend/app/services/incident_service.py`, any cell in the exported CSV that begins with `= `, `+`, `-`, `@`, `\t`, or `\r` is prepended with a single quote (`'`), neutralizing spreadsheet formula execution.

---

## 8. Test Commands and Actual Results

### Full Backend Test Suite
```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests/
```
**Result:**
```text
============================= test session starts ==============================
platform linux -- Python 3.13.12, pytest-9.0.3, pluggy-1.6.0
rootdir: /home/jyno/Projects/Darshini
plugins: anyio-4.12.1, typeguard-4.4.4
collected 79 items                                                             

backend/tests/test_camera.py ...........                                 [ 13%]
backend/tests/test_detection.py .......                                  [ 22%]
backend/tests/test_detection_accuracy.py ..........                      [ 35%]
backend/tests/test_detection_history.py ........                         [ 45%]
backend/tests/test_event_registration_sms.py ........                    [ 55%]
backend/tests/test_health.py ...                                         [ 59%]
backend/tests/test_location_session.py ...                               [ 63%]
backend/tests/test_routing_and_incidents.py ...................          [ 87%]
backend/tests/test_simulation.py ..........                              [100%]

============================= 79 passed in 10.90s ==============================
```

### Dedicated Routing & Incidents Tests (19 Tests)
```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests/test_routing_and_incidents.py -v
```
**Result:**
```text
backend/tests/test_routing_and_incidents.py::test_routing_nodes_and_edges_loading PASSED
backend/tests/test_routing_and_incidents.py::test_dijkstra_shortest_path_calculation PASSED
backend/tests/test_routing_and_incidents.py::test_routing_same_node_distance_zero PASSED
backend/tests/test_routing_and_incidents.py::test_routing_invalid_endpoints PASSED
backend/tests/test_routing_and_incidents.py::test_edge_blocking_recalculates_or_unreachability PASSED
backend/tests/test_routing_and_incidents.py::test_edge_history_recording PASSED
backend/tests/test_routing_and_incidents.py::test_routing_unauthorized_operations_rejected PASSED
backend/tests/test_routing_and_incidents.py::test_routing_invalid_edge_id_rejected PASSED
backend/tests/test_routing_and_incidents.py::test_routing_simulated_blocked_edges_isolation PASSED
backend/tests/test_routing_and_incidents.py::test_incident_creation_and_retrieval PASSED
backend/tests/test_routing_and_incidents.py::test_incident_lifecycle_transitions PASSED
backend/tests/test_routing_and_incidents.py::test_incident_invalid_status_rejection PASSED
backend/tests/test_routing_and_incidents.py::test_incident_metrics_calculation PASSED
backend/tests/test_routing_and_incidents.py::test_incident_unauthorized_operations_rejected PASSED
backend/tests/test_routing_and_incidents.py::test_incident_assignment_and_audit PASSED
backend/tests/test_routing_and_incidents.py::test_incident_time_range_and_source_filtering PASSED
backend/tests/test_routing_and_incidents.py::test_csv_formula_injection_defense PASSED
backend/tests/test_routing_and_incidents.py::test_csv_export_endpoint PASSED
backend/tests/test_routing_and_incidents.py::test_http_routing_calculate_and_block_cycle PASSED
```

### Frontend Production Build
```bash
cd frontend && npm run build
```
**Result:**
```text
> darshini-frontend@0.3.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
✓ 54 modules transformed.
dist/index.html                   1.17 kB │ gzip:   0.64 kB
dist/assets/index-1T1zituZ.css  105.67 kB │ gzip:  19.75 kB
dist/assets/index-CExdEUlD.js   523.03 kB │ gzip: 143.98 kB
✓ built in 1.88s
```

---

## 9. Manual Verification Steps

1. **Calculate Route:**
   - Navigate to **Emergency Routing** (Key `4` or navigation tab).
   - Origin: "North Entry Gate A", Destination: "East Concourse Pavilion".
   - Notice Primary Cleared Corridor (515m, ~7.2 min) and alternate bypass routes on both GIS Leaflet tiles and SVG schematic map.
2. **Block an Edge with Operator Authentication:**
   - Click "Operator Login" banner or button (Quick login with `operator` / `OperatorPass123`).
   - In the Corridor Blockage Manager, click "Block" on Corridor `edge_north_spine`.
   - Enter reason: "Crowd surge bottleneck at North Plaza".
   - Corridor displays red dashed indicator on both the Leaflet and schematic maps.
   - Recalculate route: Route solver automatically recalculates around the closure via perimeter bypass (1,750m).
3. **Inspect Blocked Edge Audit History:**
   - On the blocked corridor card, click `[Audit History]`.
   - Verify modal shows the exact timestamp, action (`BLOCK`), operator (`operator`), reason, and source (`OPERATOR`).
4. **Reopen Edge:**
   - In the Corridor Blockage Manager, click "Reopen Corridor" with reason "Corridor cleared by ground team".
   - Recalculate route: Primary route immediately restores the direct 515m corridor.
5. **Escalate Real Camera Telemetry to an Incident:**
   - Navigate to **Camera Detection** (Key `2`).
   - Scroll to "Persistent Detection History".
   - In any telemetry row, click `⚠️ Escalate`.
   - The app automatically navigates to **Incidents & Reports** and opens the Create Incident modal pre-filled with the camera ID, zone name, detected person count, timestamp, and provenance disclaimer.
6. **Track Incident Through Full Lifecycle & Responsibility Assignment:**
   - File the incident report.
   - Click ticket row to open the Incident Detail Drawer.
   - In "Assign Incident Responsibility", enter assignee "Officer Jane Doe" and submit.
   - Click "Acknowledge ➔" with note "Acknowledged by supervisor".
   - Click "Start Response (In Progress) ➔".
   - Click "Mark Resolved ✓" with note "Crowd dispersals complete".
   - Review timeline displaying full chronological audit history with timestamps.
7. **Cross-Module Corridor Inspection:**
   - If an incident references a corridor (`related_edge_id`), click `Inspect ➔`.
   - The app switches to Emergency Routing filtered to that exact corridor.
8. **Export Filtered CSV:**
   - In Incidents & Reports, apply date/severity/status filters.
   - Click "📥 Export CSV".
   - Verify CSV export matches filters and protects against formula injection.

---

## 10. Remaining Limitations & Boundaries

- **Turnstile / Door Micro-Modeling:** The routing solver models corridor distances and standard walking speed ($v = 1.2\text{ m/s}$); it does not simulate individual turnstile mechanical friction in real time.
- **SMS Broadcast Safety Barrier:** Resolving or escalating an incident does not auto-dispatch mass SMS messages. Broad alerts require the dedicated two-person approval workflow in the Event Management module to prevent accidental public panic.
