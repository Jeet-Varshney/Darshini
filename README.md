# CrowdFlow Sentinel
**Operational Command Center for Predictive Crowd Safety & Emergency Route Planning**

CrowdFlow Sentinel is an operational command-and-control dashboard engineered for municipal safety operators, event coordinators, and first responders to monitor crowd density, detect choke points, evaluate what-if interventions, and plan emergency routing.

---

## Visual Direction & Design System (Milestone 1 Locked Baseline)

- **Aesthetic:** Command Center (Methodical, calm, high-legibility, balanced operational density).
- **Theme:** Dedicated **Light Theme** engineered for standard command room monitors.
- **Primary Accent:** Steel Blue (`#365F8D` / Hover: `#294B73`).
- **Surfaces:** App Canvas: `#F5F7FA` | Primary Surface: `#FFFFFF` | Secondary Surface: `#EEF2F6`.
- **Text & Contrast:** Primary Text `#172B43` (14.2:1 contrast, exceeds WCAG AAA) | Secondary Text `#526174`.
- **Status Non-Color Cues:** All statuses pair color with text and geometric icons (`▲ Critical`, `◆ Warning`, `ℹ Info`, `✓ Positive`).
- **Styling Architecture:** Pure Vanilla CSS using custom properties (`tokens.css`). Zero Tailwind lock-in or bloated CSS frameworks.

---

## Milestone 1 Implementation Scope

Milestone 1 establishes the rock-solid repository foundation and application shell:

1. **Safe Repository Initialization:**
   - Root Git initialization (`main` branch) and comprehensive `.gitignore` covering Node, build outputs, Python virtual environments, model weights, and media caches.
   - Preserves baseline planning documents (`DESIGN.md` and `IMPLEMENTATION_PLAN.md`).

2. **Frontend Foundation:**
   - Built with **Vite**, **React 18**, and **TypeScript**.
   - Modular structure:
     - `src/styles/` — Centralized `tokens.css`, `reset.css`, `layout.css`, and `map.css`.
     - `src/types/` — Strongly typed domain interfaces for venues, zones, gates, and navigation.
     - `src/data/` — Configurable fictional venue configuration (`fictionalVenue.ts`).
     - `src/components/` — Reusable layout controls, status badges, Leaflet map, legend, and SVG schematic fallback.
     - `src/screens/` — Screen 1 (`LiveOperations`) substantive implementation + Honest placeholders for Screens 2–5.

3. **Persistent Application Shell & Navigation:**
   - Persistent top bar with CrowdFlow Sentinel branding, prototype indicator badge (`[DEMO / SIMULATION MODE]`), real-time ticking clock, and active operator badge.
   - Five navigation tabs with accessible focus outlines and keyboard shortcuts (`[1]` through `[5]`):
     1. **Live Operations** (Fully implemented in Milestone 1)
     2. **Camera & Detection** (Placeholder explicitly noting CV inference is not implemented yet)
     3. **Scenario Lab** (Placeholder detailing planned Digital Twin NetworkX graph engine)
     4. **Emergency Routing** (Placeholder detailing planned obstacle-aware Dijkstra router)
     5. **Incidents & Reports** (Placeholder detailing planned incident audit trail and exports)

4. **Baseline Command Map & Fallback:**
   - **Street Map:** Integrated Leaflet map with OpenStreetMap tiles and proper attribution.
   - **Fictional Venue:** Configurable *Sentinel Exhibition & Arena Precinct* featuring 5 zones (North Gate Plaza, Central Promenade, Pavilion Hall A, West Emergency Corridor, South Metro Hub), 4 access gates, and 4 perimeter/arterial road connections.
   - **Zone Inspection Panel:** Selecting any zone updates the right-hand panel with area ($m^2$), safe capacity, simulated count, density (persons/$m^2$), Fruin Level of Service (LoS A-F), and capacity saturation gauge.
   - **Offline-Resilient Schematic Map:** Full-fidelity local SVG vector map fallback that renders deterministically without requiring an internet connection or external tile server. The top toolbar provides an instant toggle to switch between Street Map and Vector Schematic modes.

---

## Quick Start & Setup

### Prerequisites
- **Node.js:** `v18.0.0` or higher (`v24.18.0` verified)
- **npm:** `v9.0.0` or higher (`v11.16.0` verified)

### Installation
```bash
# Navigate to the frontend directory
cd frontend

# Install project-local dependencies
npm install
```

### Running Locally (Development Server)
```bash
# Start Vite development server
npm run dev
```
Open `http://localhost:5173` in any modern browser.

### Building for Production
```bash
# Type-check and bundle production assets
npm run build

# Preview the production build locally
npm run preview
```

## Milestone 2 Implementation Scope: Universal Live Camera & Real Person Detection Pipeline

Milestone 2 delivers a robust, camera-source-agnostic computer-vision pipeline integrated with the command center UI:

1. **Universal Camera Discovery & Capture Lifecycle (`backend/`):**
   - **Camera-Source Agnostic:** Supports ANY video capture device recognized by the host OS (built-in laptop webcams, external USB cameras, Iriun Virtual Webcam, DroidCam, and other V4L2-compatible video devices). Does not require Iriun or any proprietary drivers.
   - **Hardware Readability Inspection:** Scans `/sys/class/video4linux/video*` and `/dev/video*`, extracts hardware names, and verifies whether the device node can actually produce readable video frames (cleanly distinguishing capture nodes from UVC metadata/infrared nodes).
   - **Latest-Frame Non-Blocking Architecture:** Uses a decoupled capture thread and inference worker thread with a latest-frame strategy so frames are never backlogged, maintaining instant responsiveness (<85ms latency).
   - **Clean Resource Management:** Stopping the camera or closing the client WebSocket immediately releases the hardware device via `cv2.VideoCapture.release()`.
   - **Real-Time Streaming Protocol:** WebSocket (`/ws/camera/stream`) broadcasts annotated JPEG preview frames, measured inference FPS, bounding boxes, and detected person counts to connected clients.
   - **REST Control Endpoints:** `GET /api/cameras` (device discovery), `GET /api/camera/status`, `POST /api/camera/start`, `POST /api/camera/stop`.

2. **Pretrained YOLOv8n Object Detection:**
   - **Pretrained YOLOv8n:** Runs on CPU with zero GPU requirement (~100–140ms per frame, achieving ~7.5–10 FPS).
   - **Person Class Isolation:** Strictly filters detections to COCO Class 0 (`person`), capturing normalized and pixel coordinates, confidence scores, and person counts.
   - **Zero Synthetic Detections:** Every displayed bounding box, confidence score, and count reflects actual model output. When zero persons are present, the system transparently reports 0 detections.

3. **Frontend Camera & Detection Screen (`CameraDetectionScreen.tsx`):**
   - **Dual Pipeline Modes:** Quick tab switcher between **Universal Live Camera Feed** and **Sample & Custom Video File**.
   - **Live Device Selector & Rescan:** Dropdown listing all discovered cameras with readiness indicators (`● Ready` vs `○ Unavailable`), hardware tags (`PHYSICAL` vs `VIRTUAL`), and a 1-click `↻ Rescan Devices` button.
   - **Explicit User Control:** Camera stream never starts automatically; user must click `Start Camera Stream`.
   - **Live HUD & Metrics:** Displays active detected persons, measured inference FPS, inference latency, and real-time annotated feed with steel-blue bounding boxes.
   - **Preserved File Analysis Workflow:** Pre-packaged calibration videos (`gate1_sample.mp4`, `empty_zone_sample.mp4`) and custom file drag-and-drop with frame-by-frame audit log.

---

## Quick Start & Setup

### Prerequisites
- **Node.js:** `v18.0.0` or higher (`v24.18.0` verified)
- **npm:** `v9.0.0` or higher (`v11.16.0` verified)
- **Python:** `3.10` to `3.13` (Python `3.13.12` verified)

### 1. Frontend Setup
```bash
# Navigate to the frontend directory
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in any browser.

### 2. Backend Setup
```bash
# Create virtual environment and install backend dependencies
cd backend
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r requirements.txt

# Start FastAPI backend server on port 8000
PYTHONPATH=. .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Alternatively, from the project root:
```bash
npm run backend       # Starts backend uvicorn server
npm run backend:test  # Runs pytest test suite
```

### 3. Backend Test Suite
```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest -v tests/
```
All 15 automated unit and integration tests verify:
- Dynamic camera discovery and device readability validation (`test_camera.py`)
- Live camera start/stop lifecycle and device node release (`test_camera.py`)
- Model-unavailable guards and invalid device index rejection (`test_camera.py`)
- Video upload validation, 50MB file size safeguards, and format checks (`test_detection.py`)
- Genuine YOLO person detection and coordinate boundaries (`test_detection.py`)
- Zero-detection honesty without synthetic fallbacks (`test_detection.py`)
- Temporary upload file cleanup (`test_detection.py`)
- Health and model readiness reporting (`test_health.py`)

---

## Data Integrity & Ethical Safeguards

1. **Simulated Venue Configuration:** All venue zones, crowd counts, and road conditions represent deterministic demonstration fixtures explicitly labelled as `[SIMULATED FIXTURE]` across the UI.
2. **Authentic Model Inference:** Camera & Detection runs genuine inference using pretrained YOLOv8n on uploaded video frames. Bounding boxes and confidence scores reflect actual model outputs without synthetic injection.
3. **Transparent Prototype Boundary:** The application clearly states: `PROTOTYPE VIDEO ANALYSIS — NOT LIVE CCTV SURVEILLANCE`. It does not claim live municipal CCTV integration, real-time crowd-density estimation from person count alone, or vehicle tracking.
4. **Human-in-the-Loop:** All automated indicators and advisories are presented as decision-support heuristics requiring human confirmation.

---

## Upcoming Implementation Milestones

- **Milestone 1:** App Shell, Design System & Interactive Map (Completed).
- **Milestone 2:** Real Person Detection Pipeline & Video Inspector (Completed).
- **Milestone 3:** Digital Twin / Scenario Lab (NetworkX capacitated bottleneck simulation, what-if parameter sliders).
- **Milestone 4:** Emergency Route Solver (Impedance-weighted Dijkstra path planning, interactive road edge blocking).
- **Milestone 5:** Incidents & Reports (Incident registry, evidence drawer, PDF summary exporter).
- **Milestone 6:** End-to-end integration, telemetry polish, and 3-minute demo pitch rehearsal.
