# Darshini — 404 Simulation API Routes Diagnostic Report

## 1. Executive Summary

During verification of Milestone 3, requests to `GET /api/v1/simulation/network` returned `HTTP 404 Not Found`, and `/openapi.json` omitted the simulation routes while existing camera and detection routes remained functional.

Inspection of the code on disk confirmed that the simulation implementation:
1. Already existed completely in `backend/app/services/network_service.py`, `backend/app/services/simulation_service.py`, `backend/app/schemas.py`, and `backend/app/api/routes_simulation.py`.
2. Was already mounted in `backend/app/main.py` via `from app.api.routes_simulation import router as simulation_router` and `app.include_router(simulation_router)`.
3. Matched the router paths called by `frontend/src/services/simulationApi.ts` (`/api/v1/simulation/network` and `/api/v1/simulation/run`).

**Root Cause:**
The running process PID `254278` listening on `0.0.0.0:8000` was started **5 hours and 27 minutes prior** (`Fri Oct 23 20:30:57 2026`) with the exact command:
```bash
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Because uvicorn was started **without the `--reload` flag**, it was running a static snapshot of the Python bytecode loaded hours before Milestone 3 files were written to disk. The disk code was valid and passed all 44 unit tests, but the running operating system process on port 8000 never reloaded its modules from disk.

---

## 2. Diagnosis Details

### A. Process Inspection
- **Command executed:** `ps -p 254278 -o pid,etime,lstart,cmd`
- **Output:**
  ```
  PID     ELAPSED                  STARTED CMD
  254278  05:27:17 Fri Oct 23 20:30:57 2026 .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
  ```
- **Finding:** The server process was started prior to Milestone 3 implementation without `--reload`. Uvicorn in single-process mode without `--reload` does not watch files or reload bytecode.

### B. Disk Code Route Inspection
A test Python command was executed against the active virtual environment on disk:
```bash
.venv/bin/python -c "
from app.main import app
for r in app.routes:
    print(r.path)
"
```
**Output:**
```
/openapi.json
/docs
/health
/api/model/status
/api/detect/video
/api/cameras
/api/camera/status
/api/camera/start
/api/camera/assign-zone
/api/zones/live-status
/api/camera/stop
/api/camera/infer-frame
/ws/camera/stream
/api/location/session
/api/location/update
/ws/location/{session_id}
/api/v1/simulation/run
/api/v1/simulation/network
/
```
**Conclusion:** The disk code in `backend/app/main.py` and `backend/app/api/routes_simulation.py` already had both simulation routes registered correctly.

### C. Path Comparison with Frontend
- **Frontend (`frontend/src/services/simulationApi.ts`):**
  - Line 16: `${API_BASE_URL}/api/v1/simulation/network`
  - Line 45: `${API_BASE_URL}/api/v1/simulation/run`
- **Backend Router (`backend/app/api/routes_simulation.py`):**
  - Line 23: `@router.post("/api/v1/simulation/run", ...)`
  - Line 67: `@router.get("/api/v1/simulation/network", ...)`
- **Backend App Mount (`backend/app/main.py`):**
  - `app.include_router(simulation_router)`
- **Alignment:** 100% path parity. No router path or prefix changes were needed.

---

## 3. Safe Restart Procedure Executed

To safely switch port 8000 from the stale in-memory snapshot to the current code on disk:

1. **Gracefully stop the stale process:**
   ```bash
   kill 254278
   ```
2. **Verify port 8000 is released:**
   ```bash
   ss -ltnp | grep ':8000'
   # Confirmed: Port 8000 free
   ```
3. **Launch the server with live reload enabled:**
   ```bash
   .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   *Benefit:* With `--reload`, any future code edits in `backend/app/` will be reloaded automatically into memory without needing manual restarts.

---

## 4. Verification Results

### 1. Live OpenAPI Path Listing
```bash
curl -s http://127.0.0.1:8000/openapi.json | python -c "import json,sys; d=json.load(sys.stdin); print('\n'.join(d.get('paths',{}).keys()))"
```
**Output:**
```
/health
/api/model/status
/api/detect/video
/api/cameras
/api/camera/status
/api/camera/start
/api/camera/assign-zone
/api/zones/live-status
/api/camera/stop
/api/camera/infer-frame
/api/location/session
/api/location/update
/api/v1/simulation/run
/api/v1/simulation/network
/
```
Both `/api/v1/simulation/run` and `/api/v1/simulation/network` are now active and registered.

### 2. Live HTTP Request: Network Topology
```bash
curl -i http://127.0.0.1:8000/api/v1/simulation/network
```
**Response:**
```http
HTTP/1.1 200 OK
date: Fri, 23 Oct 2026 20:36:19 GMT
server: uvicorn
content-length: 5473
content-type: application/json

{"venue_id":"venue-darshini-park","venue_name":"Darshini Exhibition & Arena Precinct","disclaimer":"SIMULATED TOPOLOGY: Represents configured demonstration fixture for what-if simulation.","nodes":[...13 nodes...],"edges":[...12 edges...]}
```

### 3. Live HTTP Request: Simulation Run (2.0x Crowd Multiplier)
```bash
curl -i -X POST http://127.0.0.1:8000/api/v1/simulation/run \
  -H "Content-Type: application/json" \
  -d '{"crowd_multiplier": 2.0, "duration_minutes": 60}'
```
**Response:**
```http
HTTP/1.1 200 OK
server: uvicorn
content-type: application/json

{"scenario_id":"sim-20261023203644-xxxx", ... "status":"COMPLETED", "baseline_comparison":{"network_flow_status":"CRITICAL_SATURATION", "projected_avg_utilization_pct":86.2, ...}}
```

### 4. Regression Check on Camera & Model Endpoints
- `GET http://127.0.0.1:8000/health`: `HTTP 200 OK` (Model ready, YOLOv8n initialized on CPU).
- `GET http://127.0.0.1:8000/api/cameras`: `HTTP 200 OK` (3 devices discovered, 2 readable).

### 5. Frontend Build
- `tsc -b && vite build` succeeded in 1.79s with zero errors.
