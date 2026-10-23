# Darshini — Technical Implementation Plan
**Project:** Darshini Hackathon MVP (Crowd Safety, Congestion Monitoring, Digital Twin Simulation & Emergency Routing)
**Document Version:** 1.0.0-draft (Step 0 Technical Implementation Plan)
**Status:** Pre-Scaffold Planning Phase (Implementation Guardrails Enforced)

---

## 1. Repository and Stack Audit

### 1.1 Current Repository Status
- **Workspace Path:** `/home/jyno/Projects/Darshini`
- **Initial State:** Empty directory (`.` and `..` only).
- **Git Repository Status:** Not yet initialized (`fatal: not a git repository`). No pre-existing commits, branches, or untracked application files exist.
- **Pre-existing Uncommitted Changes:** None. The repository is pristine and unpopulated.

### 1.2 System Environment Audit
An inspection of the local runtime environment reveals:
- **Node.js:** `v24.18.0` (active and functional)
- **npm:** `11.16.0` (active and functional)
- **Python:** `Python 3.13.12` (system interpreter)
- **Available Pre-installed Python Libraries:**
  - `fastapi` (`0.135.3`)
  - `uvicorn` (`0.38.0`)
  - `networkx` (`3.4.2`)
  - `numpy` (`2.3.5`)
  - `pydantic` (`2.13.4`)
  - `PIL` (Pillow `12.2.0`)
  - `torch` (`2.14.0+cpu`)
  - `sqlite3` (Python Standard Library)
- **Missing Vision / CV Packages:**
  - `cv2` (OpenCV) is not installed.
  - `ultralytics` (YOLOv8) is not installed.
  - `torchvision` is not installed.
- **System Binaries:**
  - `/usr/bin/ffmpeg` is installed and operational.
  - `/usr/bin/git` is installed and operational.

### 1.3 Stack Selection & Technical Rationale
Given the requirements and the audit above, the architecture is selected to achieve high performance, visual beauty, zero runtime crashes, and complete offline presentation reliability:

```
+---------------------------------------------------------------------------------------+
|                                    DARSHINI MVP                                       |
+---------------------------------------------------------------------------------------+
|  FRONTEND (Single Page App)                           BACKEND (FastAPI Microservice)  |
|  - React 18 + TypeScript + Vite                      - FastAPI 0.135 (Python 3.13)    |
|  - Vanilla CSS Design Tokens (Zero Tailwind lock-in) - NetworkX 3.4 (Graph Simulation)|
|  - Leaflet / React-Leaflet (Interactive Street Maps) - Pydantic v2 (Schema Validation)|
|  - HTML5 Canvas Detection Overlay                    - SQLite / In-Memory Seed Store  |
|  - Offline Vector SVG Map Fallback                   - Uvicorn Async Server (Port 8000)|
+---------------------------------------------------------------------------------------+
|                                INTEGRATION LAYER                                      |
|  REST API (/api/v1) + Client-Side Fallback Mode (Full Standalone Offline Capability)  |
+---------------------------------------------------------------------------------------+
```

1. **Frontend Architecture:**
   - **Framework:** React 18 with TypeScript via Vite. Fast compile times, strong typing for complex spatial/graph data structures.
   - **Styling:** Modular Vanilla CSS utilizing CSS variables declared in a centralized `tokens.css`. This directly implements the locked Command Center design system without Tailwind bloat, class contention, or styling regressions.
   - **Mapping Engine:** Leaflet with high-contrast light OpenStreetMap Carto tiles, supplemented with an inline SVG Vector Schematic map fallback if internet connectivity is interrupted.
   - **Video & Vision Rendering:** Native HTML5 `<video>` element with an overlaid dynamic `<canvas>` layer rendering bounding boxes and region-of-interest polygons with exact frame synchronization.

2. **Backend Architecture:**
   - **Framework:** FastAPI with Uvicorn. Lightweight, ultra-fast asynchronous REST API.
   - **Simulation & Graph Engine:** NetworkX for road/gate network representation, Dijkstra/A* emergency route planning, and capacity-constrained node-link flow propagation.
   - **Persistence:** In-memory repository with JSON seed fixtures, coupled with SQLite for recording operator acknowledgments and incident history.

3. **Standalone Client-Side Mode (Fail-Safe Strategy):**
   - The frontend will include an embedded `MockDataService` that mirrors all backend endpoints.
   - If the backend is running, the frontend queries `http://localhost:8000/api`.
   - If the backend is not started or encounters network errors, the frontend automatically falls back to local mock data without breaking the UI.

---

## 2. Proposed Architecture and Module Responsibilities

### 2.1 File & Directory Structure
```
Darshini/
├── DESIGN.md                                 # Locked Design Specification
├── IMPLEMENTATION_PLAN.md                    # Technical Plan & Ownership
│
├── frontend/                                 # Client-side Command Center Web App
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── public/
│   │   ├── samples/                          # Sample video clips & thumbnail assets
│   │   └── data/                             # Static JSON fallbacks
│   └── src/
│       ├── main.tsx                          # App entry point
│       ├── App.tsx                           # App shell, navigation & global states
│       ├── styles/
│       │   ├── tokens.css                    # Locked design tokens (colors, spacing, radii)
│       │   ├── reset.css                     # Minimal baseline reset
│       │   └── command-center.css            # Layout grids, cards, tables, badges
│       ├── types/                            # Shared TypeScript domain interfaces
│       │   ├── zone.ts
│       │   ├── camera.ts
│       │   ├── simulation.ts
│       │   ├── route.ts
│       │   └── incident.ts
│       ├── services/
│       │   ├── apiClient.ts                  # Fetch client with timeout & fallback logic
│       │   ├── mockData.ts                   # Complete deterministic mock datasets
│       │   └── graphUtils.ts                 # Geometry, coordinates, and LoS helpers
│       ├── components/
│       │   ├── common/
│       │   │   ├── Header.tsx                # App bar, live clock, status chip
│       │   │   ├── Navigation.tsx            # 5-screen tab bar with hotkeys
│       │   │   ├── StatusBadge.tsx           # Accessible semantic status badges
│       │   │   ├── ProvenanceTag.tsx         # [OBSERVED] vs [SIMULATED] attribution
│       │   │   ├── PanelCard.tsx             # Standard command center card container
│       │   │   ├── SliderControl.tsx         # Labeled numeric slider
│       │   │   └── ModalDrawer.tsx           # Contextual slide-out evidence drawer
│       │   └── map/
│       │       ├── CommandMap.tsx            # Leaflet wrapper with layer management
│       │       ├── HeatmapLayer.tsx          # Dynamic Gaussian density heatmap
│       │       ├── ZonePolygonLayer.tsx      # Interactive zone boundaries
│       │       ├── RouteLayer.tsx            # Primary/alternative polyline renderers
│       │       ├── MapLegend.tsx             # Fruin LoS scale and layer toggles
│       │       └── SchematicFallback.tsx     # Offline SVG vector fallback canvas
│       └── screens/
│           ├── LiveOperations.tsx            # Screen 1: Street map, zones, alerts
│           ├── CameraDetection.tsx           # Screen 2: Sample video player & boxes
│           ├── ScenarioLab.tsx               # Screen 3: Digital Twin & what-if lab
│           ├── EmergencyRouting.tsx          # Screen 4: Path solver & blocked roads
│           └── IncidentsReports.tsx          # Screen 5: Audit log, evidence & export
│
└── backend/                                  # Server-side API & Simulation Engine
    ├── requirements.txt
    ├── app/
    │   ├── __init__.py
    │   ├── main.py                           # FastAPI initialization & CORS
    │   ├── config.py                         # App settings and data paths
    │   ├── models/                           # Pydantic data validation schemas
    │   │   ├── zone_schemas.py
    │   │   ├── camera_schemas.py
    │   │   ├── simulation_schemas.py
    │   │   ├── route_schemas.py
    │   │   └── incident_schemas.py
    │   ├── data/                             # JSON Seed Data & Pre-computed Annotations
    │   │   ├── precinct_zones.json           # Zone polygons, areas, capacities
    │   │   ├── road_network.json             # Nodes, edges, distances, throughput limits
    │   │   ├── camera_metadata.json          # Camera positions, FOVs, video paths
    │   │   ├── sample_detections.json        # Pre-computed frame annotations
    │   │   └── initial_incidents.json        # Seed incident register
    │   ├── services/
    │   │   ├── detection_service.py          # Frame annotations & count aggregations
    │   │   ├── risk_service.py               # Fruin LoS & surge anomaly heuristics
    │   │   ├── network_service.py            # NetworkX graph builder & route solver
    │   │   ├── simulation_service.py         # Bottleneck flow & what-if simulator
    │   │   └── incident_service.py           # In-memory / SQLite incident management
    │   └── api/
    │       ├── routes_zones.py
    │       ├── routes_cameras.py
    │       ├── routes_simulation.py
    │       ├── routes_routing.py
    │       └── routes_incidents.py
    └── tests/
        ├── test_routing.py                   # Route graph & blocked edge unit tests
        ├── test_simulation.py                # Capacity flow & bottleneck tests
        └── test_risk.py                      # Fruin LoS threshold calculation tests
```

---

## 3. Frontend/Backend Integration Boundaries & API Contracts

All endpoints return standard JSON responses with explicit ISO 8601 timestamps and source attribution metadata.

### 3.1 Zone & Live Operations Endpoints
- `GET /api/v1/zones`
  - **Purpose:** Retrieve all monitored precinct zones with current estimated crowd metrics.
  - **Response (200 OK):**
    ```json
    {
      "timestamp": "2026-10-22T09:45:00Z",
      "data_source": "CALIBRATED_ESTIMATE",
      "zones": [
        {
          "id": "zone-gate-1",
          "name": "Gate 1 Concourse",
          "area_sqm": 850.0,
          "safe_capacity": 1700,
          "current_count": 2720,
          "density_per_sqm": 3.2,
          "fruin_los": "F",
          "status": "CRITICAL",
          "inflow_rate_per_min": 240,
          "outflow_rate_per_min": 110,
          "coordinates": [
            [28.6139, 77.2090],
            [28.6145, 77.2092],
            [28.6142, 77.2105],
            [28.6136, 77.2101]
          ]
        }
      ]
    }
    ```

- `GET /api/v1/zones/{zone_id}/telemetry`
  - **Purpose:** Retrieve 60-minute time-series crowd density and inflow for trend sparklines.

### 3.2 Camera & Detection Endpoints
- `GET /api/v1/cameras`
  - **Purpose:** List all configured cameras, locations, viewing angles, and stream states.
- `GET /api/v1/cameras/{camera_id}/detections`
  - **Purpose:** Retrieve frame-indexed bounding boxes, class counts, and optical flow vectors for video playback overlay.
  - **Response (200 OK):**
    ```json
    {
      "camera_id": "cam-01",
      "camera_name": "Gate 1 Main Inflow",
      "sample_video_url": "/samples/gate1_sample.mp4",
      "fps": 25,
      "total_frames": 750,
      "inference_model": "Pre-computed YOLOv8 Calibration Baseline",
      "frames": [
        {
          "frame_index": 120,
          "timestamp_offset_sec": 4.8,
          "person_count": 64,
          "vehicle_count": 2,
          "bounding_boxes": [
            {
              "id": 1,
              "class_name": "person",
              "confidence": 0.91,
              "box_normalized": [0.12, 0.45, 0.08, 0.22],
              "vector": [0.02, -0.01]
            }
          ],
          "anomaly_detected": true,
          "anomaly_type": "RAPID_CONVERGENCE"
        }
      ]
    }
    ```

### 3.3 Digital Twin Simulation Endpoints
- `POST /api/v1/simulation/run`
  - **Purpose:** Execute a what-if capacity simulation over the road/gate network graph.
  - **Request Body:**
    ```json
    {
      "scenario_name": "Turnstile 1B Opening + 30% Perimeter Diversion",
      "duration_minutes": 60,
      "inflow_multiplier": 1.4,
      "gate_overrides": {
        "gate_1a": "OPEN",
        "gate_1b": "OPEN",
        "gate_2": "RESTRICTED_50"
      },
      "road_closures": ["edge_ring_road_south"],
      "traffic_diversion_pct": 30.0,
      "shuttle_dispatch_multiplier": 1.2
    }
    ```
  - **Response (200 OK):**
    ```json
    {
      "scenario_id": "sim-2026-004",
      "generated_at": "2026-10-22T09:45:10Z",
      "status": "COMPLETED",
      "baseline_comparison": {
        "peak_density_reduction_pct": 38.2,
        "evacuation_time_delta_mins": -17.0,
        "critical_bottlenecks_averted": 2
      },
      "projected_edge_loads": [
        {
          "edge_id": "edge_corridor_north",
          "name": "North Meadow Bypass",
          "capacity_limit_vph": 1200,
          "simulated_flow_vph": 980,
          "utilization_pct": 81.6,
          "breach_predicted": false
        }
      ],
      "warnings": [
        "Corridor North approaching 85% capacity at T+25 minutes. Monitor junction N4."
      ]
    }
    ```

### 3.4 Emergency Routing Endpoints
- `POST /api/v1/routing/plan`
  - **Purpose:** Compute optimal and alternative emergency routes around active choke points and blocked roads.
  - **Request Body:**
    ```json
    {
      "origin_node_id": "node_fire_station_1",
      "destination_node_id": "node_gate_2_concourse",
      "vehicle_type": "AMBULANCE",
      "manually_blocked_edges": ["edge_stadium_avenue_east"],
      "avoid_critical_crowd_zones": true
    }
    ```
  - **Response (200 OK):**
    ```json
    {
      "request_id": "route-req-9102",
      "calculated_at": "2026-10-22T09:45:12Z",
      "routes": [
        {
          "route_id": "route_primary_cleared",
          "is_recommended": true,
          "title": "Cleared Corridor via Perimeter Bypass",
          "total_distance_km": 4.8,
          "estimated_travel_minutes": 7.2,
          "chokepoints_encountered": 0,
          "obstacle_clearance_rating": "OPTIMAL",
          "nodes": ["node_fs1", "node_jct_outer", "node_perimeter_rd", "node_g2"],
          "polyline_coordinates": [
            [28.6110, 77.2050],
            [28.6125, 77.2045],
            [28.6180, 77.2080],
            [28.6160, 77.2120]
          ],
          "turn_by_turn": [
            { "step": 1, "instruction": "Exit Station onto Outer West Link", "distance_m": 450 },
            { "step": 2, "instruction": "Turn right onto Perimeter Service Corridor", "distance_m": 3200 },
            { "step": 3, "instruction": "Arrive at Gate 2 Medical Access Point", "distance_m": 1150 }
          ]
        },
        {
          "route_id": "route_direct_compromised",
          "is_recommended": false,
          "title": "Direct Arterial (COMPROMISED)",
          "total_distance_km": 3.1,
          "estimated_travel_minutes": 24.5,
          "chokepoints_encountered": 2,
          "obstacle_clearance_rating": "BLOCKED",
          "notes": "Severe pedestrian spillover on Stadium Avenue. Impassable for emergency vehicles."
        }
      ]
    }
    ```

### 3.5 Incidents & Audit Endpoints
- `GET /api/v1/incidents` (Filterable by `status`, `severity`, `zone_id`)
- `POST /api/v1/incidents/{incident_id}/acknowledge`
  - Payload: `{"operator_id": "OPR-01", "action_taken": "Dispatched ground marshals to open Auxiliary Gate 1B"}`
- `GET /api/v1/incidents/{incident_id}/evidence`
  - Returns snapshot image URI, detection metadata, and telemetry history at trigger time.
- `POST /api/v1/incidents/export`
  - Generates downloadable post-event summary payload.

---

## 4. Comprehensive Data Models

### 4.1 TypeScript Domain Models (`frontend/src/types/`)
```typescript
// --- Zone & Telemetry Models ---
export type FruinLoS = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type OperationalStatus = 'NORMAL' | 'WARNING' | 'CRITICAL';

export interface Zone {
  id: string;
  name: string;
  area_sqm: number;
  safe_capacity: number;
  current_count: number;
  density_per_sqm: number;
  fruin_los: FruinLoS;
  status: OperationalStatus;
  inflow_rate_per_min: number;
  outflow_rate_per_min: number;
  coordinates: [number, number][]; // LatLng polygon points
}

// --- Video & Vision Models ---
export interface BoundingBox {
  id: number;
  class_name: 'person' | 'vehicle' | 'bicycle';
  confidence: number;
  box_normalized: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  vector?: [number, number]; // optical flow vector [dx, dy]
}

export interface FrameDetection {
  frame_index: number;
  timestamp_offset_sec: number;
  person_count: number;
  vehicle_count: number;
  bounding_boxes: BoundingBox[];
  anomaly_detected: boolean;
  anomaly_type?: string;
}

export interface CameraStream {
  id: string;
  name: string;
  location_name: string;
  stream_url: string;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
  fps: number;
  fov_angle_deg: number;
  current_person_count: number;
  current_density: number;
  frames: FrameDetection[];
}

// --- Digital Twin Simulation Models ---
export interface NetworkNode {
  id: string;
  name: string;
  type: 'GATE' | 'PLAZA' | 'JUNCTION' | 'SAFE_ZONE';
  x: number;
  y: number;
  capacity_limit: number;
  current_occupancy: number;
}

export interface NetworkEdge {
  id: string;
  source: string;
  target: string;
  name: string;
  length_m: number;
  capacity_per_hour: number;
  current_flow_rate: number;
  is_closed: boolean;
  congestion_level: number; // 0.0 to 1.0+
}

export interface SimulationParams {
  scenario_name: string;
  inflow_multiplier: number;
  gate_overrides: Record<string, string>;
  road_closures: string[];
  traffic_diversion_pct: number;
  transit_boost_pct: number;
}

export interface SimulationResult {
  scenario_id: string;
  timestamp: string;
  baseline_evacuation_mins: number;
  simulated_evacuation_mins: number;
  peak_density: number;
  critical_chokepoints_count: number;
  edge_loads: Record<string, number>;
  projected_warnings: string[];
}

// --- Emergency Routing Models ---
export interface RouteStep {
  step: number;
  instruction: string;
  distance_m: number;
  caution?: string;
}

export interface RouteOption {
  route_id: string;
  is_recommended: boolean;
  title: string;
  total_distance_km: number;
  estimated_travel_minutes: number;
  chokepoints_encountered: number;
  obstacle_clearance_rating: 'OPTIMAL' | 'MODERATE' | 'BLOCKED';
  polyline_coordinates: [number, number][];
  turn_by_turn: RouteStep[];
  notes?: string;
}

// --- Incident & Audit Models ---
export interface Incident {
  id: string;
  title: string;
  severity: OperationalStatus;
  type: string;
  zone_id: string;
  timestamp: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  description: string;
  evidence_snapshot_url?: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
  action_taken?: string;
}
```

### 4.2 Python Pydantic Schemas (`backend/app/models/`)
Mirrored 1-to-1 with Python Pydantic v2 schemas enforcing strict typing, field boundaries, and automatic OpenAPI documentation generation.

---

## 5. Video-Processing & Detection Flow

### 5.1 Reality-Based Architecture
The audit established that:
- OpenCV (`cv2`) and Ultralytics (`ultralytics`) are **not** installed in the local Python environment.
- System CPU PyTorch (`torch 2.14.0+cpu`) is present without `torchvision`.
- `/usr/bin/ffmpeg` is installed.

Attempting to run a heavy unverified deep learning model during a live demonstration carries extreme risk of memory exhaustion, package version conflicts, or CPU thrashing. Therefore, Darshini implements a **robust, deterministic 3-tier detection pipeline**:

```
+-----------------------------------------------------------------------------------------+
|                               DETECTION PIPELINE TIERS                                  |
+-----------------------------------------------------------------------------------------+
|  TIER 1 (Default - Crash Proof): Pre-Computed Ground-Truth Calibration Frames           |
|  - Real event video clips paired with frame-accurate bounding box coordinates.         |
|  - Frame rate: Instant 30 FPS playback with zero CPU overhead or lag.                  |
|  - Exact normalized boxes for persons, vehicles, and optical flow vectors.              |
+-----------------------------------------------------------------------------------------+
|  TIER 2 (Interactive Synthetic Injector): Operator Anomaly Simulation                   |
|  - Allows the operator to inject surges, stoppages, and crowd gathering in real-time.   |
|  - Mathematical Gaussian crowd cluster generator directly drives the canvas overlay.   |
+-----------------------------------------------------------------------------------------+
|  TIER 3 (Optional Backend Extension): Python Video Frame Analyzer                       |
|  - Background script using Pillow (PIL) and NumPy to analyze frame variance & movement.  |
|  - Generates optical flow change metrics without requiring native OpenCV binaries.       |
+-----------------------------------------------------------------------------------------+
```

### 5.2 Video Overlay Synchronization Mechanics
1. An HTML5 `<video>` element plays the sample MP4 clip (e.g., pedestrian concourse, road intersection).
2. An HTML5 `<canvas>` element sits directly above the video with identical dimensions and CSS layout.
3. A `requestAnimationFrame` loop monitors `video.currentTime`.
4. The canvas renderer fetches the corresponding frame's bounding boxes and draws:
   - Precision bounding box rectangle (`stroke: #365F8D`, `lineWidth: 2`).
   - Semi-transparent class tag chip (`fill: #365F8D`, white monospace text).
   - Dynamic counting tripwire line that flashes amber whenever a bounding box centroid crosses it.
5. All displayed video feeds feature the persistent label: `[SAMPLE SURVEILLANCE FEED — CALIBRATION DATASET]`.

---

## 6. Risk and Anomaly Calculation Methodology

### 6.1 Pedestrian Crowd Density (Fruin Standards)
Crowd density $D$ in zone $Z$ with surface area $A_z$ ($m^2$) is computed as:
$$D = \frac{N_{\text{observed}}}{A_z} \quad (\text{persons} / m^2)$$

The density is mapped to established civil engineering **Fruin Level of Service (LoS)** thresholds:
- **LoS A:** $D < 0.27 \text{ p}/m^2$ (Free flow, unrestricted speed)
- **LoS B:** $0.27 \le D < 0.43 \text{ p}/m^2$ (Normal walking, minor bypass maneuvers)
- **LoS C:** $0.43 \le D < 0.72 \text{ p}/m^2$ (Noticeable crowd presence, walking speed moderated)
- **LoS D:** $0.72 \le D < 1.08 \text{ p}/m^2$ (Restricted passing, reverse flow difficult)
- **LoS E:** $1.08 \le D < 2.17 \text{ p}/m^2$ (Shuffling flow, queues form rapidly)
- **LoS F:** $D \ge 2.17 \text{ p}/m^2$ (Critical congestion, contact unavoidable, high surge danger)

### 6.2 Crowd Surge Index (CSI) Anomaly Detector
A sudden surge occurs when inflow velocity vastly outpaces physical gate or corridor evacuation throughput. The heuristic Surge Index $S$ over sliding window $\Delta t = 3 \text{ minutes}$ is defined as:
$$S = w_1 \left( \frac{\Delta \text{Inflow}}{\Delta t} \right) + w_2 \left( \frac{D}{D_{\text{safe}}} \right) + w_3 \left( 1 - \frac{V_{\text{outflow}}}{V_{\text{inflow}}} \right)$$
- If $S \ge 0.75$, the system triggers a **CRITICAL SURGE ALERT**.
- If $0.50 \le S < 0.75$, the system flags an **ELEVATED WARNING**.

### 6.3 Stated Limitations & Operational Assumptions
- **Heuristic Nature:** This calculation is a decision-support heuristic, not a certified structural life-safety calculation.
- **Occlusion Bias:** Fixed-angle cameras suffer from visual occlusion at densities exceeding $3.0 \text{ p}/m^2$. The system applies a calibrated perspective scaling factor to mitigate count under-reporting.

---

## 7. Graph-Based Scenario Simulation & Capacity Validation

### 7.1 Topological Graph Representation
Using Python's `networkx` library, the precinct is modeled as a directed capacitated multigraph $G = (V, E)$:
- **Nodes ($V$):** Entry gates, concourse hubs, ticket turnstiles, road intersections, and external evacuation safe zones.
- **Edges ($E$):** Corridors, walkways, turnstile banks, and roadways.
- **Edge Attributes:**
  - $L_e$: Physical length in meters.
  - $W_e$: Effective corridor width in meters.
  - $C_e$: Maximum physical capacity ($\text{persons} / \text{hour}$ or $\text{vehicles} / \text{hour}$).
  - $F_e(t)$: Current simulated flow rate.

### 7.2 Capacity Constraint & Bottleneck Validation
The simulation models discrete time steps $t \in [0, T]$ with user-adjustable interventions:
1. **Flow Conservation:** For each internal hub node $v \in V$:
   $$\sum_{e \in \text{In}(v)} F_e(t) - \sum_{e \in \text{Out}(v)} F_e(t) = \frac{\Delta \text{Occupancy}(v, t)}{\Delta t}$$
2. **Capacity Saturation Ratio:**
   $$\rho_e(t) = \frac{F_e(t)}{C_e}$$
3. **Chokepoint Violation:** If $\rho_e(t) > 1.0$, edge $e$ is saturated; queuing occurs at upstream nodes, and an alert is flagged with predicted time to overflow.
4. **Interventions Evaluated:**
   - **Gate Opening:** Increases $C_e$ on auxiliary gate edge by up to 100%.
   - **Perimeter Diversion:** Redistributes flow at entry junctions across alternate perimeter paths.
   - **Transit Headway Reduction:** Increases discharge capacity $C_{exit}$ at the Metro station node.

---

## 8. Emergency Route Calculation & Blocked-Edge Handling

### 8.1 Routing Formulation
Emergency paths are calculated over the road sub-graph $G_{road} \subseteq G$ using a modified **Dijkstra's Shortest Path Algorithm** with dynamic impedance weights:
$$\text{Cost}(e) = \text{TravelTime}(e) \times \text{CongestionPenalty}(e) \times \text{Impedance}(e)$$
Where:
- $\text{TravelTime}(e) = \frac{L_e}{V_{\text{free}}}$
- $\text{CongestionPenalty}(e) = 1 + \left( \frac{\text{CurrentLoad}_e}{\text{Capacity}_e} \right)^3$
- $\text{Impedance}(e) = \begin{cases} \infty & \text{if edge is blocked or flagged impassable} \\ 1.0 & \text{otherwise} \end{cases}$

### 8.2 Blocked-Edge Handling
1. **Dynamic Edge Removal:** When an edge is marked blocked (either by an active incident like a crowd spillover or by manual operator toggle), its cost is set to $\infty$ or temporarily excised from $G_{road}$.
2. **K-Shortest Loop-Free Paths:** The engine uses Yen's algorithm (`networkx.shortest_simple_paths`) to generate:
   - **Route 1 (Primary Cleared):** Avoids all blocked edges and high-density zones.
   - **Route 2 (Perimeter Alternative):** Uses secondary bypass corridors.
   - **Route 3 (Compromised Direct):** Traces the direct path, explicitly highlighting where and why it is obstructed.

---

## 9. Sample-Data Strategy and Labels

### 9.1 Venue Selection: Pragati Maidan / Central Stadium Precinct
To make the demonstration immediately recognizable, realistic, and operationally convincing, the prototype will use a calibrated spatial model of a major convention and stadium precinct (e.g., Pragati Maidan / National Stadium Complex, New Delhi):
- Defined Gates: Gate 1 (Bhairon Marg), Gate 2 (Mathura Road), Gate 3 (Metro Link), Gate 4 (Service Lane).
- Defined Zones: Central Exhibition Concourse, Pavilion Hall A Plaza, North Transit Corridor, Ring Road Arterial.

### 9.2 Transparency Badging Policy
Every single UI card, chart, and map element must carry an unambiguous provenance badge:
- Video feeds: `[SAMPLE VIDEO FEED — EVENT CALIBRATION CLIP]`
- Map background: `[MAP CONTEXT: OPENSTREETMAP CARTO — GEOGRAPHIC BASELINE]`
- Simulation outcomes: `[SIMULATION OUTPUT — TOPOLOGICAL TWIN MODEL]`
- Incident list: `[SAMPLE INCIDENT LOG — FOR DEMONSTRATION PURPOSES]`

---

## 10. Four-Person Task Breakdown with Clear File/Module Ownership

To enable clean parallel execution across a 4-person hackathon team without merge conflicts:

```
+--------------------------------------------------------------------------------------------------+
|                                    FOUR-PERSON TASK BREAKDOWN                                    |
+--------------------------------------------------------------------------------------------------+
| PERSON 1: UI Foundation, App Shell & Live Operations Lead                                        |
| Primary Files:                                                                                   |
| - frontend/src/styles/tokens.css, command-center.css                                             |
| - frontend/src/App.tsx, components/common/Header.tsx, Navigation.tsx, StatusBadge.tsx            |
| - frontend/src/screens/LiveOperations.tsx                                                        |
| - frontend/src/components/map/CommandMap.tsx, HeatmapLayer.tsx, ZonePolygonLayer.tsx             |
| Deliverables: Flawless light-theme shell, tokens, responsive split layout, interactive map.      |
+--------------------------------------------------------------------------------------------------+
| PERSON 2: Computer Vision, Video Canvas & Camera Detection Lead                                  |
| Primary Files:                                                                                   |
| - frontend/src/screens/CameraDetection.tsx                                                       |
| - frontend/src/components/camera/VideoPlayerWithOverlay.tsx, CameraGrid.tsx                      |
| - backend/app/services/detection_service.py                                                      |
| - backend/app/data/sample_detections.json, camera_metadata.json                                   |
| - backend/app/api/routes_cameras.py                                                              |
| Deliverables: Synchronized video player, canvas bounding box overlay, camera switching grid.    |
+--------------------------------------------------------------------------------------------------+
| PERSON 3: Digital Twin & Graph Simulation Engine Lead                                            |
| Primary Files:                                                                                   |
| - backend/app/services/simulation_service.py, network_service.py                                 |
| - backend/app/data/road_network.json                                                             |
| - backend/app/api/routes_simulation.py                                                           |
| - frontend/src/screens/ScenarioLab.tsx                                                           |
| - frontend/src/components/simulation/NetworkTopologyViewer.tsx, ScenarioComparisonTable.tsx       |
| Deliverables: NetworkX flow simulation, what-if parameter sliders, side-by-side comparison table.  |
+--------------------------------------------------------------------------------------------------+
| PERSON 4: Emergency Routing, Incidents & Audit Reporting Lead                                    |
| Primary Files:                                                                                   |
| - backend/app/api/routes_routing.py, routes_incidents.py                                         |
| - backend/app/services/incident_service.py                                                       |
| - frontend/src/screens/EmergencyRouting.tsx, IncidentsReports.tsx                                |
| - frontend/src/components/routing/RouteComparisonCard.tsx, TurnByTurnDrawer.tsx                  |
| - frontend/src/components/incidents/EvidenceModal.tsx, ReportExporter.tsx                        |
| Deliverables: Obstacle-aware Dijkstra router, blocked road manager, incident registry & export. |
+--------------------------------------------------------------------------------------------------+
```

---

## 11. Incremental Implementation Milestones & Acceptance Criteria

### Milestone 1: App Shell, Design System & Interactive Map (Person 1)
- **Goal:** Establish repo structure, Vite React setup, locked CSS design tokens, persistent header, navigation tabs, and baseline Leaflet map.
- **Acceptance Criteria:**
  - Viewport loads with `#F5F7FA` background and steel blue `#365F8D` accents.
  - Header displays live ticking clock, operator chip, and `[DEMO MODE]` badge.
  - Tab bar switches cleanly between all 5 screens with active tab underline and hotkeys `1`-`5`.
  - Leaflet map renders smoothly with polygon zones and Gaussian heatmap overlay.
  - If map tiles fail or disconnect, SVG Schematic fallback renders without throwing console errors.

### Milestone 2: Video Playback & Bounding Box Detection Canvas (Person 2)
- **Goal:** Implement Screen 2 with sample video streaming, canvas box rendering, and camera selector.
- **Acceptance Criteria:**
  - Sample video plays at 25-30 FPS with responsive scrubber and play/pause controls.
  - Canvas overlay draws bounding boxes accurately aligned with moving pedestrians/vehicles.
  - Tripwire line accurately detects crossline events and updates inflow counter.
  - Camera switcher instantly swaps active video stream and detection metadata.

### Milestone 3: Backend API & NetworkX Simulation Engine (Person 3)
- **Goal:** Initialize FastAPI backend, load network topology graph, and implement what-if flow simulation.
- **Acceptance Criteria:**
  - `POST /api/v1/simulation/run` returns complete scenario projection within 250ms.
  - Changing the crowd multiplier slider from `1.0x` to `2.0x` demonstrates clear capacity saturation on corridor edges.
  - Side-by-side comparison table updates dynamically, highlighting percentage improvement.

### Milestone 4: Emergency Route Solver & Blocked-Edge Manager (Person 4)
- **Goal:** Implement Screen 4 routing engine with interactive obstacle toggling and turn-by-turn clearance.
- **Acceptance Criteria:**
  - Selecting Origin and Destination renders Route 1 (Primary Cleared) and Route 2 (Perimeter).
  - Clicking a road segment to "Block" instantly recalculates the path, diverting the route around the obstruction within 100ms.
  - Route clearance metrics display travel time, distance, and chokepoints avoided.

### Milestone 5: Incident Management & Evidence Drawer (Person 4 + Person 1)
- **Goal:** Complete Screen 5 with incident filtering, evidence inspection, and report export.
- **Acceptance Criteria:**
  - Operator can click "Acknowledge" on any incident card to log action and timestamp.
  - Clicking "View Evidence" opens slide-out drawer showing snapshot frame, detection boxes, and telemetry sparkline.
  - "Export Report" produces a clean, printable PDF-ready summary sheet.

### Milestone 6: End-to-End Integration, Polish & Rehearsal (All Team Members)
- **Goal:** Seamless integration of frontend and backend, comprehensive state testing, and demo rehearsal.
- **Acceptance Criteria:**
  - Zero unhandled console warnings or network errors.
  - Full offline fallback mode tested and operational.
  - 3-minute pitch rehearsal executed smoothly.

---

## 12. Test Plan, Integration Risks, Fallback Behaviour & Demo Rehearsal Checklist

### 12.1 Automated & Unit Test Plan
- **Routing Engine Tests (`backend/tests/test_routing.py`):**
  - Verify Dijkstra shortest path calculates correct path on benchmark graph.
  - Verify route solver never traverses an edge marked `is_blocked = True`.
  - Verify graceful handling when all paths between origin and destination are impassable.
- **Simulation Engine Tests (`backend/tests/test_simulation.py`):**
  - Verify conservation of flow at intermediate nodes.
  - Verify bottleneck warnings trigger when $\rho_e > 0.85$.
- **Risk Calculation Tests (`backend/tests/test_risk.py`):**
  - Verify Fruin LoS categorizations match theoretical cutoffs.

### 12.2 Integration Risks & Mitigations
| Risk | Severity | Mitigation Strategy |
| :--- | :--- | :--- |
| **No Internet Connectivity at Hackathon Venue** | High | **Built-in Offline Fallback:** Pre-packaged local raster tiles + SVG vector schematic map. App operates 100% offline. |
| **Heavy Python CV Model Latency / Out of Memory** | High | **Deterministic Pre-computed Annotations:** Avoid running live heavy deep-learning inference during pitch; rely on frame-indexed annotations. |
| **FastAPI Backend Process Drops** | Medium | **Client-Side Mock Mode:** Frontend detects API timeout (>1.5s) and seamlessly falls back to embedded TypeScript mock services. |
| **Video Decoding Glitches on Browser** | Low | Standard H.264 MP4 sample encoding verified for cross-browser HTML5 video compatibility. |

### 12.3 3-Minute Hackathon Demo Rehearsal Checklist
- [ ] **0:00 - 0:30 (The Problem & Live Operations):**
  - Open Screen 1 (Live Operations).
  - Point out the clean Light Command Center aesthetic, balanced density, and clear steel blue accents.
  - Highlight the real-time heatmap overlay and the active `CRITICAL SURGE` alert at Gate 1 Concourse.
- [ ] **0:30 - 1:15 (Camera Verification & Anomaly Detection):**
  - Click `[View Camera]` or switch to Screen 2.
  - Show live video playback with synchronized bounding boxes, pedestrian counts, and tripwire flow.
  - Emphasize the data integrity badge: `[SAMPLE SURVEILLANCE FEED — CALIBRATION DATASET]`.
- [ ] **1:15 - 2:00 (Digital Twin & What-If Simulation):**
  - Switch to Screen 3 (Digital Twin).
  - Demonstrate the node-link graph of the venue.
  - Adjust the Inflow Multiplier to 1.5x, toggle Auxiliary Gate 1B to Open, and click `[Run Simulation]`.
  - Show the side-by-side comparison table: 38% reduction in peak chokepoint density and 17 minutes saved.
- [ ] **2:00 - 2:35 (Emergency Route Clearance):**
  - Switch to Screen 4 (Emergency Routing).
  - Select Origin (Disaster Base) to Destination (Gate 1 Medical).
  - Block the central avenue with one click; watch the engine instantly re-route the ambulance along the perimeter bypass with zero choke encounters.
- [ ] **2:35 - 3:00 (Auditable Incident History & Conclusion):**
  - Switch to Screen 5 (Incidents & Reports).
  - Open the incident audit drawer showing the captured evidence frame and logged operator intervention.
  - Close with Darshini's core mission: empowering human operators with calm, predictive clarity before minor bottlenecks become major tragedies.

---

## 13. Decisions Requiring User Approval

Before proceeding to **Step 1 (Scaffolding & Implementation)**, the following key decisions require explicit user confirmation:

1. **Frontend Project Setup:**
   - Confirm approval to initialize the frontend using `Vite + React 18 + TypeScript` in `frontend/` directory with pure Vanilla CSS tokens (no Tailwind).
2. **Backend Architecture & Folder Structure:**
   - Confirm approval to initialize the backend using `FastAPI` in `backend/` utilizing system Python 3.13 and existing packages (`fastapi`, `uvicorn`, `networkx`, `pydantic`).
3. **Computer Vision Approach:**
   - Confirm approval of the **Pre-Computed Frame Annotations + Synthetic Inflow Generator** strategy for the video player (avoids installing heavy unverified OpenCV/YOLO packages on the host machine).
4. **Venue Geographic Baseline:**
   - Confirm approval to model the **Pragati Maidan / Stadium Complex Precinct** (or specify an alternative event/city geography if preferred).
5. **Git Repository Initialization:**
   - Confirm approval to run `git init` in the root directory to track incremental milestone commits.
