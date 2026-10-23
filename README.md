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

---

## Data Integrity & Ethical Safeguards

1. **Simulated Venue Configuration:** All venue zones, crowd counts, and road conditions represent deterministic demonstration fixtures. They are explicitly labelled as `[SIMULATED FIXTURE]` across the UI.
2. **No Fabricated Model Inference:** Computer vision inference is **NOT** claimed or simulated in this milestone. Camera & Detection clearly communicates that models will be integrated in Milestone 2.
3. **Map Tiles Disclaimer:** Street map tiles provide geographical and spatial context; they do not represent real-time municipal traffic telemetry.
4. **Human-in-the-Loop:** All automated indicators and advisories are presented as decision-support heuristics requiring human confirmation.

---

## Upcoming Implementation Milestones

- **Milestone 2:** Computer Vision & Video Detection Canvas (Synchronized bounding-box overlays, tripwire counting).
- **Milestone 3:** Digital Twin / Scenario Lab (NetworkX capacitated bottleneck simulation, what-if parameter sliders).
- **Milestone 4:** Emergency Route Solver (Impedance-weighted Dijkstra path planning, interactive road edge blocking).
- **Milestone 5:** Incidents & Reports (Incident registry, evidence drawer, PDF summary exporter).
- **Milestone 6:** End-to-end integration, telemetry polish, and 3-minute demo pitch rehearsal.
