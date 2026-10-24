# Darshini — Milestone 3: Digital Twin & NetworkX Simulation Engine Implementation Report

## Executive Summary

Milestone 3 ("Backend API & NetworkX Simulation Engine" from `IMPLEMENTATION_PLAN.md`) has been fully implemented and validated. The placeholder `ScenarioLabPlaceholder.tsx` has been replaced with an interactive **Scenario Lab / Digital Twin** screen powered by a FastAPI endpoint (`POST /api/v1/simulation/run`) running deterministic NetworkX graph-based crowd flow and capacity saturation calculations.

Additionally, the **"PLANNED"** badges displayed next to the navigation options in the top navigation toggle bar have been removed, preserving all icons, labels, keyboard shortcuts (`1`–`5`), and active-tab styling.

---

## 1. Files Created and Modified

### Backend Modules Created
- [`backend/app/data/road_network.json`](file:///home/jyno/Projects/Darshini/backend/app/data/road_network.json): Topological venue graph dataset containing 13 nodes (Gates A–D, North Plaza, Central Promenade Concourse, East Pavilion Hall A, South Metro Terminal Hub, and 4 Perimeter Ring junctions) and 12 directed corridors/roads with calibrated physical capacities (pax/hr), lengths, and SVG canvas coordinates.
- [`backend/app/services/network_service.py`](file:///home/jyno/Projects/Darshini/backend/app/services/network_service.py): NetworkX directed graph service (`nx.DiGraph`). Loads and validates graph topology, node holding capacities, and edge capacities with graph cloning support for isolated simulation runs.
- [`backend/app/services/simulation_service.py`](file:///home/jyno/Projects/Darshini/backend/app/services/simulation_service.py): Deterministic what-if simulation engine. Calculates baseline versus projected corridor flows, gate throttling, road closures, perimeter diversion, bottleneck saturation thresholds (>85% and >100%), node accumulation risks, and evacuation clearance times.
- [`backend/app/api/routes_simulation.py`](file:///home/jyno/Projects/Darshini/backend/app/api/routes_simulation.py): FastAPI routing module exposing `POST /api/v1/simulation/run` and `GET /api/v1/simulation/network`.
- [`backend/tests/test_simulation.py`](file:///home/jyno/Projects/Darshini/backend/tests/test_simulation.py): Comprehensive unit and integration test suite (10 test cases) covering baseline, 1.0x vs 2.0x surge, gate overrides, road closures, traffic diversions, parameter validation, alias parameter support, and latency benchmarking.

### Backend Modules Modified
- [`backend/app/main.py`](file:///home/jyno/Projects/Darshini/backend/app/main.py): Registered `simulation_router` under the FastAPI application instance.
- [`backend/app/schemas.py`](file:///home/jyno/Projects/Darshini/backend/app/schemas.py): Added schemas `SimulationRunRequest`, `ProjectedEdgeLoad`, `NetworkNodeStatus`, `BaselineComparison`, and `SimulationRunResponse`, with parameter aliasing support (`crowd_multiplier`, `closed_road_ids`, `gate_b_override`).

### Frontend Modules Created
- [`frontend/src/types/simulation.ts`](file:///home/jyno/Projects/Darshini/frontend/src/types/simulation.ts): TypeScript interfaces for simulation requests, responses, edge loads, node statuses, baseline comparisons, and topology responses.
- [`frontend/src/services/simulationApi.ts`](file:///home/jyno/Projects/Darshini/frontend/src/services/simulationApi.ts): Typed client service integrating `fetchNetworkTopology()` and `runSimulation()` with timeout handling and error reporting.
- [`frontend/src/styles/simulation.css`](file:///home/jyno/Projects/Darshini/frontend/src/styles/simulation.css): Command Center styling adhering to light theme, Steel Blue (`#365F8D`) accents, pulsing bottleneck highlights, interactive SVG nodes, and responsive layout.
- [`frontend/src/screens/ScenarioLab.tsx`](file:///home/jyno/Projects/Darshini/frontend/src/screens/ScenarioLab.tsx): Interactive Scenario Lab screen featuring the Topological Venue Network Twin SVG, crowd multiplier slider (1.0x–2.0x), scenario presets, intervention workbench, baseline vs. projected outcome matrix, bottleneck warnings drawer, and element inspector.

### Frontend Modules Modified
- [`frontend/src/components/layout/Navigation.tsx`](file:///home/jyno/Projects/Darshini/frontend/src/components/layout/Navigation.tsx): Removed the `PLANNED` badge from all navigation options while keeping icons, labels, shortcuts, and styling intact.
- [`frontend/src/screens/ScenarioLabPlaceholder.tsx`](file:///home/jyno/Projects/Darshini/frontend/src/screens/ScenarioLabPlaceholder.tsx): Re-exported `ScenarioLab` as `ScenarioLabPlaceholder` to guarantee complete backward-compatible screen registration.
- [`frontend/src/App.tsx`](file:///home/jyno/Projects/Darshini/frontend/src/App.tsx): Registered and rendered `<ScenarioLab />` for Section 3 (`scenario-lab`).
- [`frontend/src/index.css`](file:///home/jyno/Projects/Darshini/frontend/src/index.css): Imported `./styles/simulation.css`.

---

## 2. Simulation Architecture & Flow/Capacity Calculation Approach

```
                  ┌───────────────────────────────────────────────┐
                  │          FastAPI Simulation API               │
                  │        POST /api/v1/simulation/run            │
                  └───────────────────────┬───────────────────────┘
                                          │
                                          ▼
                  ┌───────────────────────────────────────────────┐
                  │             SimulationService                 │
                  │   Deterministic Flow & Capacity Evaluator     │
                  └───────┬───────────────────────────────┬───────┘
                          │                               │
                          ▼                               ▼
            ┌───────────────────────────┐   ┌───────────────────────────┐
            │   Baseline Run (1.0x)     │   │  Intervention Run (N.Nx)  │
            │   - 1.0x Inflow           │   │  - Crowd Multiplier       │
            │   - No closures           │   │  - Gate Overrides         │
            │   - No diversions         │   │  - Road Closures          │
            │   - Raw NetworkX DiGraph  │   │  - Perimeter Diversion    │
            └─────────────┬─────────────┘   └─────────────┬─────────────┘
                          │                               │
                          └───────────────┬───────────────┘
                                          ▼
                  ┌───────────────────────────────────────────────┐
                  │    Delta Calculation & Bottleneck Detection   │
                  │    - Utilization %: (Flow / Capacity) * 100   │
                  │    - Bottleneck: Utilization >= 85%           │
                  │    - Capacity Breach: Flow > Capacity         │
                  │    - Clearance Time: Total Pax / Throughput   │
                  └───────────────────────────────────────────────┘
```

### Deterministic Flow Propagation
1. **Network Representation**:
   - The venue is modeled as a directed graph $G = (V, E)$ in NetworkX.
   - Nodes $V$ represent Gates, Arrival Plazas, Main Concourse Hubs, Pavilion Halls, and Perimeter Road Junctions.
   - Edges $E$ represent unidirectional walkways, concourses, turnstile banks, and perimeter boulevard links with calibrated capacity bounds $C_e$ (persons/hour).

2. **Flow Assignment**:
   - Gate nodes ingest crowd volume proportional to their base intake multiplied by the crowd multiplier $M \in [1.0, 2.0]$.
   - Gate overrides (e.g. `Gate B = RESTRICTED`) throttle ingress by 50% ($0.5 \times M$) or 0% for `CLOSED`.
   - Flow splits at central decision nodes (e.g., Central Promenade Concourse) based on downstream corridor capacities using proportional capacity-weighted distribution.
   - Closed road edges have capacity $C_e = 0$ and simulated flow $F_e = 0$.

3. **Perimeter Diversion Ratio**:
   - When parameter `traffic_diversion_pct` ($D \in [0, 100]$) is applied, a fraction of inflow from outer gates is redirected along the perimeter ring roads (`North Perimeter Boulevard`, `East Exhibition Link`, `South Terminal Way`), relieving load on the central concourse spines.

4. **Metrics & Delta Formulation**:
   - **Corridor Saturation (%)**:
     $$\text{Utilization}_e = \frac{F_e}{C_e} \times 100$$
   - **Bottleneck Classification**:
     - `NORMAL`: $\text{Utilization}_e < 60\%$
     - `WARNING`: $60\% \le \text{Utilization}_e < 85\%$
     - `CRITICAL`: $\text{Utilization}_e \ge 85\%$ (or $F_e > C_e$, physical capacity breached)
   - **Average Network Saturation**:
     $$\overline{U} = \frac{1}{|E_{\text{active}}|} \sum_{e \in E_{\text{active}}} \text{Utilization}_e$$
   - **Clearance Duration (Minutes)**:
     $$T_{\text{clearance}} = \frac{\sum_{v \in \text{Gates}} \text{Inflow}_v \times \left(\frac{\text{Duration}}{60}\right)}{\sum_{e \in \text{Exit Corridors}} \min(F_e, C_e)} \times 60$$
   - **Percentage Change**:
     $$\Delta\% = \frac{\text{Projected} - \text{Baseline}}{\text{Baseline}} \times 100$$

---

## 3. API Request & Response Examples

### Request: `POST /api/v1/simulation/run`

```json
{
  "crowd_multiplier": 2.0,
  "duration_minutes": 60,
  "gate_b_override": "OPEN",
  "traffic_diversion_pct": 0.0,
  "closed_road_ids": []
}
```

### Response: `HTTP 200 OK`

```json
{
  "scenario_id": "sim-20261023201430-b4f2",
  "scenario_name": "Crowd Multiplier 2.0x Scenario",
  "generated_at": "2026-10-23T20:14:30.089123+00:00",
  "execution_time_ms": 2.45,
  "status": "COMPLETED",
  "inflow_multiplier": 2.0,
  "duration_minutes": 60,
  "baseline_comparison": {
    "network_flow_status": "CRITICAL_SATURATION",
    "summary": "Crowd influx causes 4 corridor capacity breaches. Average network utilization increased by +40.5%.",
    "baseline_inflow_rate_pph": 7200,
    "projected_inflow_rate_pph": 14400,
    "baseline_avg_utilization_pct": 45.7,
    "projected_avg_utilization_pct": 86.2,
    "utilization_delta_pct": 40.5,
    "baseline_critical_bottlenecks": 0,
    "projected_critical_bottlenecks": 4,
    "bottlenecks_delta": 4,
    "estimated_clearance_minutes_baseline": 29.3,
    "estimated_clearance_minutes_projected": 58.7,
    "clearance_time_delta_mins": 29.4,
    "peak_density_p_sqm_baseline": 2.8,
    "peak_density_p_sqm_projected": 5.6,
    "peak_density_delta_p_sqm": 2.8
  },
  "projected_edge_loads": [
    {
      "edge_id": "edge_north_spine",
      "name": "North Spine Concourse Walkway",
      "source_node": "node_north_plaza",
      "target_node": "node_central_promenade",
      "corridor_type": "WALKWAY",
      "length_meters": 180.0,
      "capacity_limit_pph": 3600,
      "base_flow_pph": 2500,
      "simulated_flow_pph": 5000,
      "utilization_pct": 138.9,
      "saturation_status": "CRITICAL",
      "breach_predicted": true,
      "delay_factor": 2.39,
      "is_blocked": false,
      "svg_coords": [440, 95, 440, 245]
    },
    {
      "edge_id": "edge_south_spine",
      "name": "South Spine Walkway Link",
      "source_node": "node_central_promenade",
      "target_node": "node_south_terminal",
      "corridor_type": "WALKWAY",
      "length_meters": 190.0,
      "capacity_limit_pph": 3400,
      "base_flow_pph": 2100,
      "simulated_flow_pph": 4200,
      "utilization_pct": 123.5,
      "saturation_status": "CRITICAL",
      "breach_predicted": true,
      "delay_factor": 2.24,
      "is_blocked": false,
      "svg_coords": [440, 245, 440, 405]
    }
  ],
  "network_nodes": [
    {
      "node_id": "node_gate_a",
      "name": "North Entry Gate A",
      "node_type": "GATE",
      "coordinates": [28.6171, 77.21],
      "svg_pos": [440, 35],
      "inflow_pph": 6400,
      "outflow_pph": 6400,
      "capacity_pax": 4800,
      "accumulation_risk": "HIGH"
    }
  ],
  "warnings": [
    "CAPACITY BREACH: 'North Spine Concourse Walkway' exceeds physical limit by +1,400 pax/hr (138.9% capacity). Chokepoint onset predicted.",
    "CAPACITY BREACH: 'South Spine Walkway Link' exceeds physical limit by +800 pax/hr (123.5% capacity). Chokepoint onset predicted.",
    "CAPACITY BREACH: 'East Arena Connector Corridor' exceeds physical limit by +200 pax/hr (106.7% capacity). Chokepoint onset predicted."
  ],
  "data_provenance": {
    "model": "NetworkX DiGraph Flow Model v1.0",
    "disclaimer": "SIMULATED DATA: Represents a mathematical projection based on configured topology.",
    "human_in_the_loop_notice": "Automated advisory only. Physical field dispatch requires human verification.",
    "badge_category": "PROJECTED: TWIN"
  }
}
```

---

## 4. How the 1.0x and 2.0x Scenarios Differ

| Parameter / Metric | Baseline Scenario (`1.0x`) | Peak Saturation Scenario (`2.0x`) | Mathematical Delta |
|:---|:---|:---|:---|
| **Total Inflow Rate** | 7,200 pax/hr | 14,400 pax/hr | **+100.0%** ($+7,200\text{ pph}$) |
| **Average Network Utilization** | 45.7% | 86.2% | **+40.5%** |
| **Critical Bottlenecks ($>85\%$)** | **0 corridors** | **4 corridors** | **+4 bottlenecks** |
| **North Spine Concourse Flow** | 2,500 pax/hr (69.4% capacity) | 5,000 pax/hr (**138.9% capacity**) | **+69.5% saturation** (CRITICAL) |
| **South Spine Walkway Link** | 2,100 pax/hr (61.8% capacity) | 4,200 pax/hr (**123.5% capacity**) | **+61.7% saturation** (CRITICAL) |
| **East Arena Connector** | 1,600 pax/hr (53.3% capacity) | 3,200 pax/hr (**106.7% capacity**) | **+53.4% saturation** (CRITICAL) |
| **Pavilion East Egress** | 1,100 pax/hr (50.0% capacity) | 2,200 pax/hr (**100.0% capacity**) | **+50.0% saturation** (CRITICAL) |
| **Estimated Clearance Duration** | 29.3 minutes | 58.7 minutes | **+29.4 minutes (+100%)** |
| **Peak Zone Density** | 2.80 persons/m² | 5.60 persons/m² | **+2.80 p/m²** |
| **Network Status Classification** | `OPTIMAL` | `CRITICAL_SATURATION` | Status degradation |
| **Visual SVG Representation** | Green & amber solid lines | 4 Red pulsing bottleneck corridors with warning badges | Dynamic visual shift |

---

## 5. Automated Tests Run & Exact Pass/Fail Counts

### Backend Test Suite (`pytest`)
Ran via `PYTHONPATH=. .venv/bin/python -m pytest tests`:

```
tests/test_camera.py ...........                                         [ 25%]
tests/test_detection.py .......                                          [ 40%]
tests/test_detection_accuracy.py ..........                              [ 63%]
tests/test_health.py ...                                                 [ 70%]
tests/test_location_session.py ...                                       [ 77%]
tests/test_simulation.py ..........                                      [100%]

============================== 44 passed in 8.52s ==============================
```

- **Total Backend Tests**: **44 passed, 0 failed, 0 skipped (100% pass rate)**.
- **Milestone 3 Simulation Tests**:
  1. `test_network_service_graph_initialization`: PASSED
  2. `test_simulation_endpoint_baseline`: PASSED
  3. `test_crowd_multiplier_1_0x_vs_2_0x_saturation`: PASSED
  4. `test_gate_overrides_closed`: PASSED
  5. `test_road_closures`: PASSED
  6. `test_traffic_diversion_reduces_central_spine_load`: PASSED
  7. `test_get_network_topology_endpoint`: PASSED
  8. `test_simulation_validation_errors`: PASSED
  9. `test_simulation_benchmark_latency`: PASSED
  10. `test_simulation_alias_parameters`: PASSED

### Frontend Geolocation Test Suite
Ran via `node scripts/test_geolocation.mjs`:
- **Result**: **17 passed, 0 failed (100% pass rate)**.

---

## 6. Actual Measured Endpoint Latency & Measurement Method

### Measurement Method
Endpoint latency was measured on the local host by executing 30 consecutive `POST /api/v1/simulation/run` requests using `fastapi.testclient.TestClient(app)` alternating between `1.0x` and `2.0x` crowd multipliers, timed with Python's monotonic high-resolution clock (`time.perf_counter()`).

### Measured Results (Target: < 250.0 ms)
- **Minimum Execution Time**: **2.15 ms**
- **Average Execution Time**: **2.46 ms**
- **Median Execution Time**: **2.32 ms**
- **95th Percentile**: **3.13 ms**
- **Maximum Execution Time**: **3.30 ms**
- **Target Comparison**: **Passed** (observed maximum of 3.30 ms is ~75x faster than the 250.0 ms threshold).

---

## 7. Frontend Production Build Result

Ran via `npm run build` (`tsc -b && vite build`):

```
> darshini-frontend@0.3.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
✓ 49 modules transformed.
dist/index.html                   1.17 kB │ gzip:   0.64 kB
dist/assets/index-Bf64uLmT.css   79.74 kB │ gzip:  16.27 kB
dist/assets/index-D_DFISU-.js   417.04 kB │ gzip: 121.65 kB
✓ built in 1.65s
```

- **Exit Code**: `0`
- **TypeScript Errors**: `0`
- **Output Bundle**: Clean production build generated in `dist/`.

---

## 8. Verification of Acceptance Criteria

| # | Acceptance Criterion | Status | Verification Detail |
|---|---|---|---|
| 1 | `POST /api/v1/simulation/run` is registered and functional | **PASSED** | Registered in `backend/app/main.py`; verified via HTTP requests. |
| 2 | Valid request returns structured baseline & projected scenario | **PASSED** | Returns complete schema with edge loads, node statuses, and metrics. |
| 3 | `1.0x` to `2.0x` multiplier produces clear capacity-saturation difference | **PASSED** | Average saturation climbs from 45.7% to 86.2%; bottlenecks increase from 0 to 4. |
| 4 | Comparison UI updates using backend responses | **PASSED** | Real-time fetch and update via `simulationApi.ts` without hardcoded fallbacks. |
| 5 | UI shows meaningful capacity & bottleneck information | **PASSED** | Displays flow vs capacity, saturation %, pulsing red highlights, and advice. |
| 6 | Percentage-change calculations defined & mathematically consistent | **PASSED** | Explicit formulas for saturation %, utilization delta, and clearance times. |
| 7 | NetworkX used by actual simulation path | **PASSED** | `nx.DiGraph` loaded in `network_service.py` and traversed in `simulation_service.py`. |
| 8 | Measured endpoint execution time reported against 250 ms target | **PASSED** | Observed max 3.30 ms vs. 250 ms target (< 2% of budget). |
| 9 | Tests cover normal, surge, saturation, invalid inputs, and closures | **PASSED** | 10 unit/integration tests in `test_simulation.py` covering all edge cases. |
| 10 | Existing camera endpoints and UI remain functional | **PASSED** | All 11 camera tests and 17 detection accuracy tests pass with zero regression. |
| 11 | Frontend production build succeeds | **PASSED** | `tsc -b && vite build` succeeds in 1.65s. |
| 12 | Backend tests relevant to this feature pass | **PASSED** | Full pytest suite passes (44/44 passed). |
| 13 | `DESIGN.md` visual direction & data-provenance rules respected | **PASSED** | Command Center aesthetic, light theme, `#365F8D` accent, and explicit simulation labels. |
| 14 | Navigation bar "PLANNED" labels removed | **PASSED** | "PLANNED" badge removed across all nav items; layout and active styling preserved. |

---

## 9. Local Execution Commands

### Run the Backend
```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Run the Frontend
```bash
cd frontend
npm run dev
```

Navigate to [http://localhost:5173](http://localhost:5173) and press shortcut key **`3`** (or click **Scenario Lab** in the top navigation bar) to interact with the Digital Twin.

---

## 10. Known Limitations

1. **Topological Graph Scope**: The current graph is a calibrated fixture representing the 13 nodes and 12 primary corridors of the fictional exhibition precinct. Fine-grained sub-meter pedestrian step-level physics (e.g. Social Force Model) are abstracted to macro flow-capacity conservation equations suitable for real-time what-if decision support.
2. **Emergency Routing & Incidents Screens**: As strictly mandated by the task instructions, screens 4 and 5 remain untouched placeholders for upcoming milestones.
