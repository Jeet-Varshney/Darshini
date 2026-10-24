# Phase 2: Persistent Detection History — Implementation & Verification Report

**Darshini Project — Phase 2 Deliverable**  
**Date:** October 2026  
**Status:** Completed & Verified (Alerts, Acknowledgement, CSV Export, and Milestone 4 Remain Paused)

---

## 1. Executive Summary

Phase 2 introduces persistent detection history into Darshini, allowing genuine computer-vision telemetry to be stored, queried, and surfaced even after live cameras stop streaming or the backend service restarts.

### Core Achievements
1. **SQLite-Backed Storage Service (`DetectionHistoryService`):**
   - Implemented in `backend/app/services/history_service.py` using Python's standard-library `sqlite3`.
   - Uses write-ahead logging (`PRAGMA journal_mode=WAL;`) and normalized synchronization for high concurrency and zero blocking.
   - Database location configured relative to backend project root: `backend/app/data/darshini.db`.
2. **Deterministic Sampling Rate-Limiter:**
   - Enforces a strict rate-limiting rule: no more than **one sample per camera/client per 2.0 seconds** ($\ge 2.0\text{s}$).
   - Even if cameras stream frames at 15–20 FPS, database writes occur at most once every two seconds per camera.
   - Decoupled from camera loops: SQLite errors or disk bottlenecks are logged and never crash the active camera stream or inference workers.
3. **Bounded Retention Policy:**
   - Configurable retention limit (default: **1,000 detection samples**).
   - Atomic FIFO pruning removes the oldest excess rows during each insertion without interrupting active read/write operations.
4. **Historical Telemetry Schema (Zero Synthetic Data & No Base64 Storage):**
   - **Never stores base64 images or continuous video streams in SQLite.**
   - Stores only genuine numerical and textual telemetry:
     - `timestamp` (UTC ISO 8601)
     - `camera_id` (source or client identifier)
     - `camera_name` (friendly camera label)
     - `zone_id` and `zone_name` (assigned venue sector)
     - `person_count` (actual instantaneous count from YOLOv8n)
     - `stationary_count` and `moving_count` (from dwell hysteresis tracker)
     - `avg_confidence` (arithmetic mean of genuine detections; strictly `null` if 0 persons)
     - `inference_duration_ms` (actual model inference latency)
     - `data_source` (`"LIVE_CAMERA_INFERENCE"`)
5. **REST API Endpoint (`GET /api/detections/history`):**
   - Supports filtering by `camera_id`, `zone_id`, `start_time`, `end_time`.
   - Supports bounded limits (`limit` between 1 and 500; default 50) and stable chronological ordering (`order=desc` or `order=asc`).
   - Uses parameterized SQL queries to eliminate SQL injection vulnerabilities.
6. **Recent Detection History Panel in Frontend:**
   - Mounted as Section 3 in the Universal Live Camera Feed screen.
   - Clearly distinguishes historical records (`HISTORICAL ARCHIVE • SQLITE`) from the current live camera feed (`LIVE CAMERA DATA • REAL-TIME CV`).
   - Features a responsive filter toolbar (Zone dropdown, Camera/source filter input, Limit selector, and manual Refresh action).
   - Handles loading, error, empty, and populated table states with full visual fidelity to `DESIGN.md`.
   - Periodic 10-second background polling keeps history up-to-date while active camera streaming is underway.

---

## 2. API Endpoint Schema: `GET /api/detections/history`

### Request Parameters
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `camera_id` | `string` | No | `None` | Filter by camera/client ID or name |
| `zone_id` | `string` | No | `None` | Filter by assigned venue zone ID |
| `start_time` | `string` | No | `None` | Filter records at or after this ISO 8601 UTC timestamp |
| `end_time` | `string` | No | `None` | Filter records at or before this ISO 8601 UTC timestamp |
| `limit` | `integer` | No | `50` | Maximum records returned (1–500) |
| `order` | `string` | No | `"desc"` | Chronological sort order: `"desc"` (newest first) or `"asc"` |

### Response Schema (`DetectionHistoryResponse`)
```json
{
  "total": 2,
  "limit": 50,
  "records": [
    {
      "id": 6,
      "timestamp": "2026-10-23T21:40:07.148320+00:00",
      "camera_id": "ws-consecutive-client-01",
      "camera_name": "USB Mobile Webcam",
      "zone_id": "zone-gate-a",
      "zone_name": "Gate A Entry Corridor",
      "person_count": 4,
      "stationary_count": 2,
      "moving_count": 2,
      "avg_confidence": 0.8125,
      "inference_duration_ms": 67.7,
      "data_source": "LIVE_CAMERA_INFERENCE"
    }
  ],
  "camera_id": null,
  "zone_id": null,
  "timestamp": "2026-10-23T21:45:00.000000+00:00"
}
```

---

## 3. Files Modified & Added

| File | Nature of Changes |
| :--- | :--- |
| `backend/app/config.py` | Configured `DATA_DIR`, `DATABASE_PATH` (`app/data/darshini.db`), `DETECTION_HISTORY_MAX_RECORDS` (1,000), and `DETECTION_HISTORY_MIN_INTERVAL_SEC` (2.0s). |
| `backend/app/schemas.py` | Added Pydantic schemas: `DetectionHistoryRecord` and `DetectionHistoryResponse`. |
| `backend/app/services/history_service.py` | **(New)** Implemented `DetectionHistoryService` with SQLite WAL mode, table creation, rate-limited persistence, retention pruning, query filters, and test isolation support. |
| `backend/app/services/camera_stream.py` | Hooked `detection_history_service.record_detection(...)` into both `_inference_worker` (server V4L2) and `process_client_frame` (browser client). |
| `backend/app/api/routes.py` | Implemented `GET /api/detections/history` endpoint with input validation and parameterized queries. |
| `backend/tests/test_detection_history.py` | **(New)** Added 8 unit tests verifying DB initialization, schema, 2.0s rate limiting, retention pruning, filters, ordering, error resilience, and the API endpoint. |
| `frontend/src/types/detection.ts` | Added `DetectionHistoryRecord`, `DetectionHistoryResponse`, and `DetectionHistoryFilterParams` interfaces. |
| `frontend/src/services/detectionApi.ts` | Implemented `fetchDetectionHistory` API client function. |
| `frontend/src/styles/detection.css` | Added styling for `.history-panel-card`, `.history-toolbar`, `.history-detection-table`, `.provenance-chip-archive`, filters, and empty/loading states. |
| `frontend/src/screens/CameraDetectionScreen.tsx` | Added Section 3 "Persistent Detection History" panel with zone/camera filters, table inspector, relative time formatting, and polling effect. |

---

## 4. Retention & Sampling Behavior Verification

1. **Sampling Rate-Limit:**
   - Evaluated by `test_sampling_rate_limit_enforcement`:
   - Sample at $t=100.0\text{s}$: Recorded ($\Delta t = \infty$).
   - Sample at $t=100.5\text{s}$: Skipped ($\Delta t = 0.5\text{s} < 2.0\text{s}$).
   - Sample at $t=101.9\text{s}$: Skipped ($\Delta t = 1.9\text{s} < 2.0\text{s}$).
   - Different camera at $t=101.0\text{s}$: Recorded (independent source clock).
   - Sample at $t=102.1\text{s}$: Recorded ($\Delta t = 2.1\text{s} \ge 2.0\text{s}$).
2. **FIFO Retention Pruning:**
   - Evaluated by `test_retention_policy_pruning`:
   - Configured with `max_records = 10`.
   - Inserted 15 consecutive samples.
   - Result: Exactly 10 records remained, retaining the most recent 10 and pruning the earliest 5.
3. **Data Integrity:**
   - When 0 persons are detected in a frame, `avg_confidence` is explicitly stored as `NULL` (never fabricated).
   - Base64 images are never stored in SQLite.

---

## 5. Verification & Test Results

### A. Backend Automated Test Suite
- Command: `PYTHONPATH=. .venv/bin/python -m pytest tests`
- Result: **52 passed in 8.46s (Exit code 0)**
  - `tests/test_detection_history.py`: **8 passed (100%)**
  - `tests/test_camera.py`: 11 passed (100%)
  - `tests/test_detection.py`: 7 passed (100%)
  - `tests/test_detection_accuracy.py`: 10 passed (100%)
  - `tests/test_health.py`: 3 passed (100%)
  - `tests/test_location_session.py`: 3 passed (100%)
  - `tests/test_simulation.py`: 10 passed (100%)

### B. Frontend Production Build
- Command: `npm run build` (in `frontend/`)
- Result: **Passed (Exit code 0)**
- Output: Vite production bundle built successfully in 1.67s; TypeScript (`tsc -b`) passed with 0 errors.

### C. Live Backend Endpoint Testing
- `GET /api/detections/history`: Returns 200 OK with persisted samples from `darshini.db`.
- `GET /api/detections/history?zone_id=zone-north-plaza`: Successfully filters only records from North Gate Plaza.
- `GET /api/detections/history?camera_id=test-browser-client-01`: Successfully filters only records from specified camera client.
- `GET /api/detections/history?limit=1`: Correctly bounds return to 1 record with latest timestamp.
- Direct SQLite verification script: Confirmed records remain persisted on disk in `backend/app/data/darshini.db`.

### D. Testing Environment Disclosure
- **Physical Camera Status:** No physical USB camera was attached to this headless Linux environment. Testing was executed using browser client frames, test client scripts, and unit tests using temporary SQLite databases (`tmp_path`) to ensure zero pollution of the live database.

---

## 6. Current Status & Next Steps

Phase 2 is complete and verified. Milestone 4 (Emergency Route Solver), real-time alerts generation, alert acknowledgement, and CSV export remain paused. All code changes have been validated, preserving existing tests, uncommitted files, and camera features.
