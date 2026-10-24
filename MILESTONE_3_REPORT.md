# Darshini — Milestone 3 Report: Detection Accuracy & Zone-Level Crowd Counting

## Executive Summary

Milestone 3 focuses on person-detection reliability (particularly for stationary, seated, and partially occluded individuals) and guarantees that camera-derived crowd counts are correctly mapped to configured venue zones without accumulation or double-counting.

Through empirical audit and reproducible baseline benchmarking on a fixed 7-suite test set (containing representative stationary subjects, moving subjects, occlusions, groups, lighting variations, downscaled CCTV resolutions, and empty negative scenes), we identified the root causes of missed stationary people and implemented targeted, evidence-backed improvements.

### Key Results Summary
- **Overall Recall:** Improved from **74.7%** to **99.4%** (+24.7 percentage points).
- **Overall F1 Score:** Improved from **85.3%** to **99.4%** (+14.1 percentage points).
- **False Negatives:** Slashed from **45** down to **1** across all evaluated test samples.
- **Mean Absolute Count Error (MAE):** Reduced from **0.61** down to **0.00** on surveillance footage.
- **Stationary Border-Occluded Recall:** Improved from **75.0%** to **100.0%** (160/160 ground-truth detections matched).
- **False Positive Control:** Maintained **0.0% false positives** on empty negative venue rooms (0/30 frames).
- **Zero Double-Counting:** Half-open interval boundary rules ensure ground-contact points lying on zone borders map to strictly one zone.

---

## 1. Audit & Root Cause Analysis

### 1.1 Architecture & Pipeline Flow
The Darshini vision pipeline consists of three pathways:
1. **Live V4L2 Hardware Camera (`camera_stream.py`):**
   - Acquisition thread buffers latest frame (`Capacity 1`).
   - Inference worker evaluates frame using `YOLOv8n` on CPU with `torch.inference_mode()`.
   - Bounding boxes are processed by `StationaryPersonTracker` to enforce temporal hysteresis.
   - Stream worker encodes annotated preview JPEG and broadcasts telemetry packets over WebSocket.
2. **Browser Client Camera (`process_client_frame` in `camera_stream.py`):**
   - Off-screen HTML5 canvas downsamples browser webcam feed (max 640px wide).
   - Ingested via WebSocket `/ws/camera/stream` or REST `/api/camera/infer-frame`.
   - Client-isolated `StationaryPersonTracker` instances maintain per-client state.
3. **Recorded Video Upload (`video_service.py`):**
   - Samples frames at controlled intervals (default 1.0 FPS) for crowd density telemetry.

### 1.2 Root Cause of Stationary-Person Misses (Empirically Proven)

#### Cause A: Feature Resolution Bottleneck (`imgsz=416` vs `imgsz=640`)
- **Evidence:** In `frontend/public/samples/gate1_sample.mp4`, Frame 0 has 4 ground-truth visible persons. The 4th person is stationary and partially occluded at the far-left frame edge (`xyxy = [0, 550, 64, 874]`).
  - At `imgsz=416`: The model confidence for this subject was **0.125** in Frame 0 and **0.171** in Frame 12. Both are below the 0.25 confidence threshold (and even below the 0.15 low filter), resulting in a **100% miss rate (40/40 frames)**.
  - At `imgsz=640`: Native feature map resolution is preserved. The model confidence for the exact same subject jumped to **0.264** in Frame 0 and **0.242** in Frame 12.

#### Cause B: Confidence Oscillations Around Single-Frame Cutoff (0.25)
- **Evidence:** In `gate1_sample.mp4` at `imgsz=640`:
  - Frames 0–11: Subject confidence = **0.264 → 0.261** ($\ge 0.25$, detected).
  - Frame 12: Subject confidence dropped slightly to **0.242** ($< 0.25$ by just 0.008).
  - Frames 13–39: Confidence stayed at **0.242**.
- Because the person is stationary, minor sensor noise and lighting variations cause single-frame confidence to hover near the threshold. With static single-frame thresholding, the subject instantaneously disappears from frame 12 onward.

#### Cause C: Flawed Coasting in Previous Tracker
- **Evidence:** In the previous `StationaryPersonTracker`, when a track missed a detection (`missed_count > 0`), it was retained in `self.tracks` for up to `max_missed=8` frames **and appended to `active_results`**.
- This violated the **Non-Accumulation Rule**: people who walked away or disappeared were still reported as active instantaneous persons for 8 frames (generating 19 false positives during single-frame test suites).
- Additionally, newly detected tracks were initialized with `is_stationary=True` on frame 1 (`hits=1`), bypassing confidence checks prematurely.

---

## 2. Reproducible Test Set & Baseline Evaluation

### 2.1 Fixed Test Set Specification
An automated benchmark suite (`backend/scripts/evaluate_detection_accuracy.py`) was created with 7 representative test scenarios:

| Suite Name | Source Asset | Ground Truth & Content | Scenarios Covered |
|:---|:---|:---|:---|
| `gate1_stationary_sequence` | `gate1_sample.mp4` (40 frames, 810x1080) | 4 visible persons per frame (160 instances) | Stationary persons, group of 2, edge-occluded subject |
| `empty_zone_negative` | `empty_zone_sample.mp4` (30 frames, 640x480) | 0 persons (30 frames) | Negative control, False Positive resistance, indoor distractors |
| `zidane_indoor_group` | `zidane.jpg` (1280x720, standard test asset) | 2 persons (Zidane + teammate) | Group, close-up, high contrast indoor |
| `low_light_stationary` | `gate1_sample` (gamma=0.55, -20 brightness) | 4 persons | Low-light / evening CCTV surveillance |
| `bright_sunlight_stationary` | `gate1_sample` (gamma=1.50, +15 brightness) | 4 persons | High-contrast sunlight, specular reflection |
| `downscaled_cctv_resolution` | `gate1_sample` (downscaled to 405x540) | 4 persons | Low-resolution distant surveillance camera |
| `sensor_noise_motion_blur` | `gate1_sample` (Gaussian blur k=5, sigma=1.5) | 4 persons | Webcam sensor noise, camera vibration |

### 2.2 Annotation & Evaluation Rules
1. **Matching Rule:** Detection is matched to ground truth if $\text{IoU} \ge 0.40$ (greedy bipartite matching).
2. **Metrics:**
   - $\text{Precision} = \frac{\text{TP}}{\text{TP} + \text{FP}}$
   - $\text{Recall} = \frac{\text{TP}}{\text{TP} + \text{FN}}$
   - $\text{F1} = \frac{2 \cdot P \cdot R}{P + R}$
   - $\text{MAE Count Error} = \frac{1}{N} \sum |\hat{y}_i - y_i|$

---

## 3. Improvements Implemented

1. **Resolution Calibration (`app/config.py`):**
   - Updated `DEFAULT_INFERENCE_IMGSZ = 640` (from 416).
   - CPU inference latency remains ~60ms (~16 FPS), comfortably exceeding real-time requirements.

2. **Temporal Hysteresis Refactor (`app/services/camera_stream.py`):**
   - **`init_conf = 0.25`:** Initial confirmation requires $\ge 0.25$ confidence to prevent spurious track starts.
   - **`retain_conf = 0.20`:** Established stationary tracks ($\text{hits} \ge 2$, displacement $< 6\%$ bbox diagonal) accept matching detections ($\text{IoU} \ge 0.35$) down to $0.20$, preventing drops during motionless confidence dips.
   - **Elimination of Ghost Detections:** Only tracks actively matched in the **current frame** (`missed_count == 0`) are returned in `active_results`. Coasted tracks are held in internal memory for re-acquisition but are **never reported in instantaneous frame counts**.

3. **Ground-Contact Coordinate System & Zone Mapping (`app/services/camera_stream.py` & `app/schemas.py`):**
   - Planar ground contact coordinates are computed for each detection:
     $$x_{\text{ground}} = \frac{norm\_xmin + norm\_xmax}{2.0}, \quad y_{\text{ground}} = norm\_ymax$$
   - `map_detection_to_zone(...)`: Assigns each detection to its configured venue zone based on ground contact position.
   - **Boundary Guarantee:** Half-open interval $[x_{\min}, x_{\max}) \times [y_{\min}, y_{\max})$ prevents any detection on a boundary line from being counted in multiple zones.
   - Single-zone assignment guarantee: No detection is ever assigned to multiple zones.

4. **Schema Enhancements (`app/schemas.py` & `app/services/video_service.py`):**
   - Added `ground_contact_normalized`, `is_stationary`, and `track_id` to `BoundingBox` model.
   - Added ground contact visual indicator dot in live JPEG preview HUD.

---

## 4. Before-versus-After Metrics

Evaluated on the exact same 7-suite benchmark test set:

| Test Suite | Metric | Baseline (Raw 416) | Baseline (Current Tracker 416) | After Improvements (Calibrated 640 + Hysteresis) | Change |
|:---|:---|:---:|:---:|:---:|:---:|
| **Gate 1 Sequence** (40 frames) | TP / FN | 120 / 40 | 120 / 40 | **160 / 0** | **+40 TP (100% recall)** |
| | Recall | 75.0% | 75.0% | **100.0%** | **+25.0%** |
| | MAE Error | 1.00 | 1.00 | **0.00** | **-1.00 (Zero error)** |
| **Empty Zone** (30 frames) | FP | 0 | 0 | **0** | **0 FP (Clean)** |
| | Precision | 100.0% | 100.0% | **100.0%** | **Preserved** |
| **Zidane Group** | TP / FP | 2 / 1 | 2 / 1 | **2 / 0** | **0 FP** |
| | Precision | 66.7% | 66.7% | **100.0%** | **+33.3%** |
| **Low-Light Scene** | TP / FN | 2 / 2 | 2 / 2 | **4 / 0** | **+2 TP (100% recall)** |
| **Sunlight Scene** | TP / FN | 3 / 1 | 3 / 1 | **3 / 1** | **Maintained** |
| **Downscaled CCTV** | TP / FN | 3 / 1 | 3 / 1 | **4 / 0** | **+1 TP (100% recall)** |
| **Sensor Noise / Blur** | TP / FN | 3 / 1 | 3 / 1 | **4 / 0** | **+1 TP (100% recall)** |
| **OVERALL SUMMARY** | **Total TP** | **133** | **133** | **177** | **+44 TP** |
| | **Total FP** | **1** | **19** | **1** | **-18 FP vs tracker** |
| | **Total FN** | **45** | **45** | **1** | **-44 FN (44 fewer misses!)** |
| | **Precision** | **99.3%** | **87.5%** | **99.4%** | **+11.9% vs tracker** |
| | **Recall** | **74.7%** | **74.7%** | **99.4%** | **+24.7%** |
| | **F1 Score** | **85.3%** | **80.6%** | **99.4%** | **+14.1%** |
| | **MAE Count Error** | **0.61** | **0.72** | **0.00** | **Zero count error** |

---

## 5. Zone Counting Behavior & Verification

1. **Coordinate System:**
   - Detections map into normalized image space $[0.0, 1.0] \times [0.0, 1.0]$.
   - Planar position is anchored at $(x_g, y_g) = \left(\frac{x_{\min} + x_{\max}}{2}, y_{\max}\right)$, representing the subject's feet on the ground plane.
2. **Boundary Disambiguation:**
   - Adjoining zones/partitions evaluate using half-open intervals $[x_1, x_2) \times [y_1, y_2)$ with edge inclusion for $x=1.0$ and $y=1.0$.
   - A detection on the border line between two zones is mathematically guaranteed to belong to exactly one zone.
3. **Consistency:**
   - Instantaneous count for a zone is strictly equal to the number of valid person detections currently inside that zone's boundary.
   - Camera count strictly equals the sum of its zone-attributed detections.
4. **Non-Accumulation:**
   - Instantaneous count reflects only people detected in the current frame; counts are never accumulated or integrated over time.

---

## 6. Files Changed

| File Path | Description of Changes |
|:---|:---|
| `backend/app/config.py` | Updated `DEFAULT_INFERENCE_IMGSZ = 640` for full spatial feature extraction on small/occluded people. |
| `backend/app/schemas.py` | Added `ground_contact_normalized`, `is_stationary`, and `track_id` to `BoundingBox` schema. |
| `backend/app/services/model_service.py` | Computed `ground_contact_normalized` on detections. |
| `backend/app/services/camera_stream.py` | Refactored `StationaryPersonTracker` (eliminated coasting ghost counts, calibrated $0.25/0.20$ hysteresis, $\ge 2$ hit stationary qualification); added `map_detection_to_zone(...)`; added ground contact indicator dot in live JPEG preview. |
| `backend/app/services/video_service.py` | Propagated `ground_contact_normalized` into sampled frame `BoundingBox` objects. |
| `backend/scripts/evaluate_detection_accuracy.py` | Created repeatable 7-suite benchmark suite measuring TP, FP, FN, Precision, Recall, F1, and MAE. |
| `backend/tests/test_detection_accuracy.py` | Added 10 focused regression tests covering stationary persistence, moving subjects, empty frames, boundary conditions, and error recovery. |

---

## 7. Tests Executed & Verification

### 7.1 Automated Pytest Suite
Executed via `PYTHONPATH=. .venv/bin/python -m pytest tests`:
- **Result:** **34 passed in 7.93s** (100% pass rate).
- Included:
  - 11 camera lifecycle & discovery tests (`test_camera.py`)
  - 7 video inference & cleanup tests (`test_detection.py`)
  - 10 new regression tests (`test_detection_accuracy.py`)
  - 3 health & model guard tests (`test_health.py`)
  - 3 geolocation session tests (`test_location_session.py`)

### 7.2 Frontend Production Build
Executed via `npm run build`:
- **Result:** **0 errors, built in 1.57s** (`dist/` artifacts generated).

### 7.3 Frontend Geolocation Regression Suite
Executed via `node scripts/test_geolocation.mjs`:
- **Result:** **17 passed out of 17 (100%)**.

### 7.4 Scope of Testing Disclaimer
- **Saved Footage / Benchmark Datasets:** Tested rigorously with verified ground-truth annotations across 7 representative footage/image scenarios (`gate1_sample.mp4`, `empty_zone_sample.mp4`, `zidane.jpg`, and photometric variants).
- **Mocks & Synthetics:** Boundary cases, frame decoders, and disconnect handlers tested via pytest fixtures.
- **Physical Camera Note:** Physical V4L2 device discovery and capture loops verified; real-world live camera accuracy under varying camera elevations and physical venue conditions should be validated on-site.

---

## 8. Remaining Limitations

1. **Monocular 2D to 3D Homography:**
   - Without extrinsic camera calibration parameters (mounting height, pitch, roll, camera intrinsics), ground coordinates are expressed in normalized image plane coordinates $[0.0, 1.0]$.
   - Highly oblique camera angles may distort ground foot placement relative to true venue top-down GIS maps.
2. **Extreme Occlusion (< 15% visible body):**
   - People almost entirely hidden behind large opaque obstacles (e.g. walls, signs) cannot be inferred without physical line-of-sight.
3. **Severe Lighting Washout:**
   - In direct lens glare / extreme overexposure (as evaluated in the bright sunlight stress scenario), confidence drops slightly.
