# Phase 1: Reliable Live Camera Intelligence UI — Implementation & Verification Report

**Darshini Project — Phase 1 Deliverable**  
**Date:** October 2026  
**Status:** Completed & Verified (Milestone 4: Emergency Routing Remains Paused)

---

## 1. Executive Summary

Phase 1 establishes a reliable, truthful, and high-performance live-monitoring interface for Darshini's computer vision pipeline. The interface surfaces actual model outputs directly from the backend's YOLOv8n person-detection and stationary-hysteresis pipeline without synthetic fallbacks, mock counts, or fabricated detections.

### Core Achievements
1. **Live Camera Feed & Overlay Display:**
   - Real-time rendering of annotated video frames directly from the backend inference pipeline.
   - Bounding-box overlays and HUD telemetry reflect actual YOLOv8 predictions.
2. **Instantaneous Person Counting & Scene Tracking:**
   - Displays actual person counts from the latest successful inference frame.
   - Tracks instantaneous counts alongside stationary hysteresis counts (e.g. `X stationary • Y moving`).
   - Strictly enforces non-accumulation: consecutive frames are never summed across time.
3. **Structured Live Detection Inspector Table:**
   - Surfaced below the live preview when detections exist:
     - **Track ID:** Unique persistent ID (`#1`, `#2`, etc.) assigned by the Hungarian/IoU tracker.
     - **Class:** Verified COCO class (`person (COCO 0)`).
     - **Confidence:** Exact model confidence percentage accompanied by a proportional visual confidence meter.
     - **Motion State:** Categorized as `STATIONARY` (persisting within spatial dwell radius for $\ge 2.0\text{s}$) or `MOVING`.
     - **Assigned Zone:** Target venue zone mapped from ground-contact coordinates.
     - **Bounding Box Coordinates:** Exact pixel coordinates `[xmin, ymin, xmax, ymax]`.
4. **Honest Multi-Modal State Management & Staleness Watchdog:**
   - Active watchdog timer (500ms interval) detecting frame arrival delays.
   - If no inference frame arrives for $>3.0\text{s}$, the UI immediately flags the data as **STALE**:
     - Highlights the metric in amber (`metric-val-stale`).
     - Replaces live status pill with `FEED STALE (Xs DELAY)`.
     - Displays an explicit staleness warning banner indicating held frame age and last UTC update time.
     - Never continues presenting old counts as live.
5. **Clear Data Provenance Segregation:**
   - Explicit badges distinguish:
     - `LIVE CAMERA DATA • REAL-TIME CV` (Active browser webcam or server V4L2 device)
     - `UPLOADED VIDEO ANALYSIS • SAMPLE BENCHMARK` (Pre-recorded MP4/MOV benchmark evaluation)
     - `SIMULATED DEMO DATA` (Unassigned venue zones displaying baseline fixture data)
6. **Graceful Lifecycle & Hardware Cleanup:**
   - Camera engine switching (`Browser Camera` vs `Server Hardware V4L2`) cleanly halts active hardware and closes existing WebSockets before switching.
   - Unmounting the screen or stopping the stream triggers `stop()`, releases browser MediaStreams, terminates interval timers, and executes `mark_client_disconnected()` on the backend.

---

## 2. Pipeline Schema & Protocol Confirmation

Prior to implementation, the existing backend routes and schemas were audited:

### A. Endpoint Schema: `/api/camera/infer-frame` (REST Fallback)
- **Input:** `ClientFrameInferRequest` (`image: str`, `client_id: str`, `zone_id: str`, `camera_name: str`, `conf_threshold: float`).
- **Output:**
  ```json
  {
    "type": "frame",
    "frame_id": 123456,
    "timestamp": "2026-10-23T21:23:36.213040+00:00",
    "device_index": -1,
    "camera_name": "Webcam (Front)",
    "assigned_zone_id": "zone-north-plaza",
    "assigned_zone_name": "North Gate Plaza",
    "person_count": 2,
    "detections": [
      {
        "box_pixels": [120, 85, 290, 410],
        "box_normalized": [0.177, 0.187, 0.854, 0.453],
        "confidence": 0.842,
        "class_id": 0,
        "class_name": "person",
        "track_id": 1,
        "is_stationary": true,
        "assigned_zone_id": "zone-north-plaza",
        "ground_contact_normalized": [0.32, 0.854]
      }
    ],
    "inference_fps": 12.4,
    "inference_duration_ms": 68.2,
    "frame_age_ms": 71.0,
    "last_inference_time": "2026-10-23T21:23:36.213040+00:00",
    "is_stale": false,
    "data_source": "LIVE_CAMERA_INFERENCE",
    "image": "data:image/jpeg;base64,...",
    "status": "streaming"
  }
  ```

### B. Endpoint Protocol: `/ws/camera/stream` (Bi-Directional WebSocket)
- Bidirectional WebSocket supporting:
  - Client command: `{"action": "infer_frame", "image": "...", "client_id": "...", "zone_id": "...", "camera_name": "...", "conf_threshold": 0.35}`
  - Server broadcast: Returns identical packet schema to `/api/camera/infer-frame`.
  - Disconnect cleanup: Automatically clears subscriber queue and purges active client session observations via `live_camera_manager.mark_client_disconnected(client_id)`.

---

## 3. Files Modified

| File | Nature of Changes |
| :--- | :--- |
| `backend/app/services/camera_stream.py` | Added `"detections": detections` to `_stream_worker` frame broadcast packet alongside `bounding_boxes` for complete consistency across client and server streams. |
| `frontend/src/types/detection.ts` | Expanded `LiveStreamPacket.detections` type definition to include `track_id`, `is_stationary`, `assigned_zone_id`, `ground_point_pixels`, and `ground_contact_normalized`. |
| `frontend/src/styles/detection.css` | Added styling for provenance chips (`.provenance-badge-live`, `.provenance-badge-upload`, `.provenance-badge-simulated`), staleness indicators (`.badge-status-stale`, `.metric-val-stale`, `.stale-warning-banner`), camera telemetry strip, structured detection inspector table, confidence meters, and zero-detection notices. |
| `frontend/src/screens/CameraDetectionScreen.tsx` | Implemented staleness watchdog interval, clean engine/mode switching, Live Metrics Row formatting, structured detections inspector table, live provenance tags, zero-detection banner, and explicit operational guardrails notices. |

---

## 4. Truthful Computer Vision & Data Integrity Rules

The UI strictly adheres to the following boundaries:
1. **No Synthetic Detections:**
   - Under no circumstances does the live camera screen substitute synthetic bounding boxes or randomized person counts when camera feed or inference is disrupted.
2. **Instantaneous Count $\neq$ Calibrated Density:**
   - Disclaimers explicitly inform operators that person count is an optical bounding box count within the camera field of view, not calibrated crowd density ($p/\text{m}^2$).
3. **No Behavior / Panic Claims:**
   - UI does not claim detection of panic, abnormal behavior, or stampede conditions. The model is documented truthfully as YOLOv8n person bounding-box localization coupled with a spatial dwell filter.
4. **Zone Isolation:**
   - Active camera strictly updates its assigned zone. Unassigned zones display configured baseline fixtures labeled `[SIMULATED DEMO DATA]`.
5. **Non-Accumulation:**
   - Person count displays instantaneous occupants in frame. Consecutive frames are never summed across time.

---

## 5. Verification & Test Results

### A. Frontend Production Build
- Command: `npm run build` (in `frontend/`)
- Result: **Passed (Exit code 0)**
- Output: Vite production bundle built successfully in 1.67s; TypeScript compilation (`tsc -b`) passed with 0 errors.

### B. Backend Automated Test Suite
- Command: `PYTHONPATH=. .venv/bin/python -m pytest tests` (in `backend/`)
- Result: **44 passed in 9.68s (Exit code 0)**
  - `tests/test_camera.py`: 11 passed (100%)
  - `tests/test_detection.py`: 7 passed (100%)
  - `tests/test_detection_accuracy.py`: 10 passed (100%)
  - `tests/test_health.py`: 3 passed (100%)
  - `tests/test_location_session.py`: 3 passed (100%)
  - `tests/test_simulation.py`: 10 passed (100%)

### C. Live Backend Endpoint Testing
- `/api/camera/status`: Returns 200 OK with camera state, model readiness, and FPS telemetry.
- `/api/camera/infer-frame`: Tested via Python client script with synthetic video frame. Returned 200 OK with `status: "streaming"`, `person_count: 0`, and `detections: []`.
- `/api/zones/live-status`: Verified that when client frame transmission ceased, the zone status updated automatically to:
  - `status: "STALE"`
  - `is_stale: true`
  - `notes: "Client camera stream delayed (33.6s ago); count marked STALE."`

### D. Testing Environment Disclosure
- **Physical Camera Status:** No physical USB camera or V4L2 device was physically connected to this headless Linux test container. Verification of camera pipeline mechanics was performed using the browser client pipeline, direct `/api/camera/infer-frame` API calls, and simulated frame streaming. Physical camera acquisition was tested against V4L2 device enumeration logic (`/api/cameras`) and fallback handling.

---

## 6. Current Status & Next Steps

Phase 1 is complete and verified. Milestone 4 (Emergency Route Solver) remains paused. All code changes have been validated and preserve existing functionality, tests, and uncommitted files. Awaiting review before starting subsequent phases.
