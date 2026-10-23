# CrowdFlow Sentinel — Frontend Application

This directory contains the single-page application (SPA) command center interface for **CrowdFlow Sentinel**, engineered with React 18, Vite, TypeScript, and pure Vanilla CSS custom properties.

---

## Technical Stack & Architecture

- **Core Framework:** React 18 (`18.3.1`) + TypeScript (`5.7.2`)
- **Build Tool:** Vite (`5.4.14`+) with `@vitejs/plugin-react`
- **Mapping & GIS:** Leaflet (`1.9.4`) with OpenStreetMap Carto Light tile layer
- **Fallback Map:** Deterministic SVG vector blueprint (`SchematicMap.tsx`) requiring zero network connectivity
- **Styling Architecture:** Pure Vanilla CSS using custom properties (`tokens.css`). Zero Tailwind or external utility CSS frameworks.
- **Design Baseline:** Command Center (Light theme `#F5F7FA`, Steel Blue `#365F8D`, high contrast, non-color status cues).

---

## Directory Structure

```
frontend/
├── index.html                 # HTML shell with Google Fonts (Inter & JetBrains Mono)
├── package.json               # Frontend dependencies and npm scripts
├── tsconfig.json              # TypeScript root configuration
├── tsconfig.app.json          # Vite application TypeScript compiler options
├── public/                    # Static favicon and vector icons
└── src/
    ├── main.tsx               # React application entry point (Strict Mode)
    ├── App.tsx                # Application shell, global keyboard navigation (1-5), and footer
    ├── App.css                # Component-level styling hooks
    ├── index.css              # Global stylesheet index importing tokens, reset, layout, and map
    ├── types/
    │   ├── navigation.ts      # SectionId, NavItem domain interfaces
    │   └── venue.ts           # VenueZone, VenueGate, VenueRoad, VenueConfiguration
    ├── styles/
    │   ├── tokens.css         # Locked design tokens (colors, radii, spacing, typography, focus)
    │   ├── reset.css          # Modern accessible element reset
    │   ├── layout.css         # Shell, header, navigation, and KPI card layouts
    │   └── map.css            # Leaflet container, custom popups, and SVG schematic styles
    ├── data/
    │   └── fictionalVenue.ts  # Configured Sentinel Exhibition & Arena Precinct fixtures
    ├── components/
    │   ├── layout/
    │   │   ├── Header.tsx     # Branding, live ticking clock, operator chip, and [DEMO MODE] badge
    │   │   ├── Navigation.tsx # Accessible 5-section tab bar with keyboard shortcuts [1]-[5]
    │   │   └── StatusPill.tsx # Accessible status badge with shape + color cues
    │   └── map/
    │       ├── CommandMap.tsx     # Leaflet map with zone polygons, gates, roads, and tile fallback
    │       ├── SchematicMap.tsx   # Local SVG vector fallback map with interactive zone selection
    │       ├── ZoneDetailPanel.tsx# Right-rail zone inspection telemetry & saturation meter
    │       └── MapLegend.tsx      # Fruin Level of Service (LoS A-F) legend overlay
    └── screens/
        ├── LiveOperations.tsx                # Screen 1: Zone rail, interactive map & telemetry (Implemented)
        ├── CameraDetectionPlaceholder.tsx    # Screen 2: Milestone 2 CV placeholder (No fabricated inference)
        ├── ScenarioLabPlaceholder.tsx        # Screen 3: Milestone 3 Digital Twin NetworkX placeholder
        ├── EmergencyRoutingPlaceholder.tsx   # Screen 4: Milestone 4 Dijkstra path solver placeholder
        └── IncidentsReportsPlaceholder.tsx   # Screen 5: Milestone 5 Incident audit drawer placeholder
```

---

## Setup & Running Locally

### 1. Prerequisites
- Node.js `v18.0.0` or higher
- npm `v9.0.0` or higher

### 2. Install Project Dependencies
```bash
npm install
```

### 3. Run Local Development Server
```bash
npm run dev
```
The server will start at `http://localhost:5173/`.

### 4. Build for Production
```bash
npm run build
```
Type checks with `tsc -b` and outputs optimized assets to `dist/`.

### 5. Preview Production Build
```bash
npm run preview
```

---

## Map & Fallback Architecture

1. **Leaflet Street Map Mode:** Renders standard OpenStreetMap tiles with attribution, plotting venue polygons, gate div-icons, and arterial road corridors.
2. **Offline-Resilient Vector Schematic:** If internet connection drops (`navigator.onLine === false`) or external map tiles fail to load (`tileerror` threshold), the map detects the fault and displays a notification with a quick switch to the SVG vector blueprint. Operators can also toggle between modes manually using the top viewport switch.
3. **Data Integrity Standard:** All zone counts and density metrics are explicitly labelled as configured demonstration fixtures (`[SIMULATED FIXTURE]`). Computer vision model inference is not simulated or fabricated.
