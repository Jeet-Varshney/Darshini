# Darshini — System Design Specification
**Visual Direction: Command Center | Theme: Light | Accent: Steel Blue (#365F8D)**
**Document Version:** 1.0.0-draft (Step 0 Design Specification)
**Project Status:** Pre-Scaffold Planning Phase

---

## 1. Product Goals, Target Users & Explicit Non-Goals

### 1.1 Product Goals
**Darshini** (meaning *vision, clairvoyance, or one who shows the path*) is an operational command-and-control decision-support dashboard for municipal authorities, major event safety managers, transit operators, and emergency first responders.

The primary goals of Darshini are:
1. **Holistic Situational Awareness:** Unify video-derived crowd counts, spatial density heatmaps, and road network congestion into a single cohesive, readable operational surface.
2. **Early Chokepoint & Surge Detection:** Identify pedestrian crowding trends and vehicular gridlock before they cross critical thresholds into dangerous stampede or paralysis conditions.
3. **What-If Scenario Simulation ("Digital Twin"):** Allow safety coordinators to model interventions (e.g., gate closures, perimeter diversions, shuttle dispatch) on a graph network model before making operational decisions on the ground.
4. **Resilient Emergency Routing:** Calculate fastest cleared paths for emergency medical and fire vehicles around active chokepoints and blocked road segments.
5. **Auditable Incident Lifecycle:** Maintain transparent, evidence-backed logs of detected anomalies, recommendations, and operator actions for post-event review.

### 1.2 Target Users & Personas
- **Live Operations Controller (Primary):** Monitors real-time incoming alerts, zone densities, and live camera detection counts during an active public event or peak traffic period. Needs instant situational clarity, low cognitive fatigue, and zero clutter.
- **Incident Commander & Emergency Dispatcher:** Deploys first-response teams and guides emergency vehicles. Needs rapid corridor routing, clear obstacle visualization, and definitive obstacle-avoidance options.
- **Safety Analyst & Logistics Planner:** Performs pre-event scenario planning, analyzes bottlenecks, tests gate-throughput limits, and prepares after-action incident reports.

### 1.3 Explicit Non-Goals
To preserve absolute operational and scientific integrity, Darshini strictly defines the following **Non-Goals**:
- **No Real Municipal Hardware Actuation:** Darshini does not directly control physical traffic lights, gate turnstiles, or variable message signs. All outputs are decision-support advisories.
- **No Production CAD (Computer-Aided Dispatch) Replacement:** Darshini does not replace statutory 911/112 public safety dispatch systems or communicate directly with emergency radio networks.
- **No Facial Recognition or Individual Tracking:** The system operates purely on anonymous count statistics and bounding-box spatial aggregations. It will never perform biometric identification, re-identification across cameras, or personal surveillance.
- **No Guaranteed Safety or Life-Safety Certification:** Risk calculations and predictions are prototype indicators and decision aids; they do not carry structural or statutory life-safety guarantees.
- **No Microscopic Crowd Turbulence Physics:** The platform does not attempt agent-based fluid-dynamic Navier-Stokes equations for individual human panic physics; it relies on macroscopic, capacity-bounded network flow models.
- **No Fabricated Model Accuracy Claims:** Camera inference outputs and density scores will not be described as "100% accurate AI" or "military grade." Confidence levels and synthetic calibration baselines will be honestly disclosed.
- **No Unsupported Live Data Integrations:** When using pre-recorded video or simulated telemetry feeds, the interface will explicitly label them as `[SAMPLE FEED]` or `[SIMULATED]`.

---

## 2. Locked Visual Direction and Design Tokens

### 2.1 Visual Direction: Command Center
- **Atmosphere:** Calm, methodical, high-legibility, operational.
- **Theme:** Dedicated **Light Theme** engineered for standard command room monitors and daytime field operations.
- **Density:** Balanced. Generous enough to avoid misclicks under pressure, compact enough to present crucial KPIs, maps, and video feeds concurrently without vertical pagination.
- **Visual Restraint:**
  - Strict prohibition against generic "futuristic sci-fi AI dashboards."
  - No decorative gradients, neon drop-shadows, glowing borders, or pulsing radial glows.
  - No oversized hero banners, decorative stock photography, or non-functional 3D widgets.
  - Charts must have direct operational utility (e.g., inflow rate vs. threshold, capacity consumption).

### 2.2 Design Tokens

#### Color Palette
| Token Name | Value | Purpose / Usage | Contrast Ratio on Surface |
| :--- | :--- | :--- | :--- |
| `--bg-app` | `#F5F7FA` | Overall viewport application background | N/A (Canvas) |
| `--surface-primary` | `#FFFFFF` | Primary card panels, modal dialogs, data tables | Baseline surface |
| `--surface-secondary`| `#EEF2F6` | Table headers, secondary toolbars, metric chips | 1.1:1 on primary |
| `--text-primary` | `#172B43` | Primary headings, titles, active telemetry numbers | **14.2:1** (Exceeds WCAG AAA) |
| `--text-secondary` | `#526174` | Field labels, timestamps, metadata, captions | **5.4:1** (Exceeds WCAG AA) |
| `--border-default` | `#D9E1EA` | Structural card borders, dividers, table grid lines| 1.4:1 non-text boundary |
| `--accent-primary` | `#365F8D` | Primary actions, selected navigation, active tabs | **5.8:1** (WCAG AA compliant) |
| `--accent-hover` | `#294B73` | Hover state for buttons and interactive controls | **7.5:1** (WCAG AAA) |
| `--status-critical` | `#B42318` | Severe overcrowding, blocked routes, critical alerts| **5.9:1** (WCAG AA compliant) |
| `--status-warning` | `#A15C00` | Approaching capacity thresholds, moderate delays | **5.2:1** (WCAG AA compliant) |
| `--status-info` | `#245D9C` | Informational advisories, camera status, standard ops| **5.7:1** (WCAG AA compliant) |
| `--status-positive` | `#237A57` | Clear corridors, optimal flow, resolved incidents | **5.6:1** (WCAG AA compliant) |

#### Spatial Tokens & Geometry
- **Grid Base Unit:** `4px`
- **Spacing Scale:**
  - `space-1`: `4px` (tight icon padding, badge padding)
  - `space-2`: `8px` (button internal padding, compact card gaps)
  - `space-3`: `12px` (standard element separation, list item padding)
  - `space-4`: `16px` (panel interior padding, section margin)
  - `space-5`: `20px` (card header spacing)
  - `space-6`: `24px` (outer layout gutters)
  - `space-8`: `32px` (screen section blocks)
- **Border Radius:**
  - Cards & Modal Containers: `10px` (`--radius-card: 10px`)
  - Buttons & Inputs: `6px` (`--radius-control: 6px`)
  - Badges & Status Chips: `4px` (`--radius-badge: 4px`)
- **Control Heights:**
  - Standard Form Controls, Selects, and Buttons: `40px` (`--control-height: 40px`)
  - Compact Table / Filter Controls: `32px` (`--control-height-compact: 32px`)

#### Typography
- **Primary Font Stack:** `Inter`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `Roboto`, `sans-serif`
- **Telemetry & Numerical Monospace Stack:** `"JetBrains Mono"`, `"Roboto Mono"`, `SFMono-Regular`, `Consolas`, `monospace`
- **Type Scale:**
  - `H1` (Screen Title): `20px` / Line Height: `28px` / Weight: `600`
  - `H2` (Panel Header): `15px` / Line Height: `22px` / Weight: `600`
  - `H3` (Card Title): `13px` / Line Height: `18px` / Weight: `600`
  - `Body Regular`: `13px` / Line Height: `18px` / Weight: `400`
  - `Body Medium`: `13px` / Line Height: `18px` / Weight: `500`
  - `Caption / Meta`: `11px` / Line Height: `16px` / Weight: `400`
  - `Telemetry Stat`: `24px` / Line Height: `30px` / Weight: `700` (Monospace)

---

## 3. Application Shell, Navigation and Responsive Behaviour

### 3.1 Application Shell Architecture
```
+--------------------------------------------------------------------------------------------------+
| DARSHINI [DEMO / SIMULATION MODE]          Global Status: [NORMAL]   15:30:12 IST   Operator: OPR-1|
+--------------------------------------------------------------------------------------------------+
| [1. Live Operations]  [2. Camera & Detection]  [3. Digital Twin]  [4. Emergency Routing]  [5. Reports]|
+--------------------------------------------------------------------------------------------------+
| Active Area Context: Pragati Maidan Precinct | Active Zones: 6 | Incidents: 2 Active (1 Critical)   |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|                                    MAIN SCREEN WORKSPACE                                         |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+
| Footnote: Synthetic calibration data for demonstration. Operational decisions require human confirmation.|
+--------------------------------------------------------------------------------------------------+
```

1. **Header Bar (Height: 52px):**
   - Brand lockup: "DARSHINI" in bold uppercase steel blue, accompanied by a clean monochrome geometric compass/crosshair glyph.
   - Simulation & Prototype Flag: A clear persistent pill badge: `[DEMO / PROTOTYPE ENVIRONMENT]`.
   - Global Risk Indicator: Aggregate posture badge (`NORMAL` in positive green, `ELEVATED` in warning amber, `CRITICAL` in critical red).
   - System Clock: High-visibility UTC / Local timestamp with live ticking seconds.
   - Session & Mode Toggle: Switch between "Live Emulation Feed" and "Paused Scrub Mode".
2. **Main Navigation Bar (Height: 44px):**
   - Horizontal tabbed navigation representing the 5 core MVP screens.
   - Tab items include keyboard shortcuts (`[1]` to `[5]`), title, and live count chips (e.g., active incidents tally).
   - Active tab state: Clean bottom accent bar (`3px solid #365F8D`), white background, bold steel blue text.
3. **Context Sub-Bar (Height: 36px):**
   - Breadcrumb of active venue/geographic boundary.
   - Quick filters: Zone selector dropdown, severity filter pills, and snapshot refresh button.
4. **Footer Operational Status Line (Height: 28px):**
   - Data provenance tag: `[DATA: SAMPLE VIDEO + SYNTHETIC NETWORK CALIBRATION]`.
   - Latency indicator: `Telemetry: 42ms | Inference: CPU Baseline (15 FPS)`.
   - Disclaimer: `Prototype decision support only. Automated recommendations require operator validation.`

### 3.2 Responsive Behavior & Breakpoints
- **Desktop Command Console (1440px - 1920px+):** Target primary viewport. Multi-column 3-panel split layout (Left KPI & Zone list, Center Canvas/Map, Right Action/Detail drawer).
- **Laptop / Operations Station (1024px - 1366px):** 2-panel layout. Collapsible right drawer overlaying the map when an incident or recommendation is inspected.
- **Tablet / Field Inspection View (768px - 1023px):** Stacked views with segmented control toggling between "Map Canvas" and "Incident List".
- **Mobile Read-Only Alert Screen (<768px):** Compact incident timeline and zone status card feed for field operators (non-primary, read-only).

---

## 4. Detailed Specification for All Five Screens

### Screen 1: Live Operations (`/live`)
*Primary view for macro situational awareness, real-time crowd density, and priority advisories.*

- **Layout Structure:** 3-column operational layout.
  - **Left Rail (Width: 320px): Zone Telemetry & List**
    - High-level metric summary: Total Tracked Footfall, Peak Zone Density (persons/m²), Active Chokepoints Count.
    - Zone Status Cards: Vertical stack of defined zones (e.g., `Gate 1 Concourse`, `Central Plaza`, `Pavilion Way`, `North Metro Corridor`).
    - Each card displays: Zone identifier, area ($m^2$), current estimated head count, density indicator bar with Fruin Level of Service (LoS A-F), and change velocity ($\Delta \text{count} / \min$).
    - Clicking a zone centers and zooms the map onto the zone polygon.
  - **Center Canvas (Flexible width, min 650px): Interactive Street Map & Heatmap**
    - High-contrast street base map rendered via Leaflet / raster tiles.
    - Semi-transparent continuous Gaussian heatmap overlay representing spatial crowd density.
    - Vector zone boundary polygons with color-coded perimeter strokes (Green = Normal, Amber = Approaching Limit, Red = Over Capacity).
    - Camera icon pins with live status indicators and FOV (Field-of-View) cones.
    - Real-time incident alert markers anchored to geographic coordinates.
    - Embedded map controls: Layer toggle (Heatmap ON/OFF, Camera Pins ON/OFF, Zone Boundaries ON/OFF), Zoom, Recenter, and Map Scale.
  - **Right Rail (Width: 380px): Actionable Incidents & Decision Support**
    - Urgent Alerts Queue: Cards ranked by criticality.
    - Each card details: Severity tag, Time Elapsed (e.g., "Triggered 3m ago"), Specific Anomaly Description (e.g., "Inflow surge exceeding exit rate by 140% at Gate 1").
    - **Recommended Operational Action Box:** Prescribed action generated by rule engine (e.g., "Open Auxiliary Gate 1B to release pressure into North Meadow").
    - Action Controls:
      - `[Acknowledge & Log]`: Records operator timestamp.
      - `[Test in Scenario Lab]`: Deep-links into Screen 3 with current zone parameters pre-loaded.
      - `[Dispatch Emergency Route]`: Deep-links into Screen 4 with destination preset to incident location.

### Screen 2: Camera & Detection (`/camera`)
*Detailed visual inspection of video surveillance streams, detection verification, and vision pipeline transparency.*

- **Layout Structure:** 2-column view (Left: Main Video Feed & Overlay; Right: Multi-feed switcher, Detection breakdown, and Pipeline Metrics).
  - **Main Video Viewport (Flexible, 16:9 ratio, min height 480px):**
    - Video player container running pre-recorded sample event/traffic footage.
    - Canvas-based detection overlay synchronized with video playback:
      - Bounding boxes around detected entities (`person` in steel blue, `vehicle` in slate blue, `bicycle` in teal).
      - Class label tag and calibrated detection confidence indicator (e.g., `person 0.88`).
      - Designated Region of Interest (ROI) polygon overlay showing the monitored counting boundary.
      - Optical flow velocity vectors or entry/exit tripwire crossline with bidirectional count tallies (`In: 184 | Out: 112`).
    - Video playback controls: Play/Pause, Frame Scrubber, Playback Speed (0.5x, 1x, 2x), and Bounding Box visibility toggle.
  - **Right Telemetry & Diagnostics Panel (Width: 400px):**
    - **Camera Stream Selector:** 4-camera thumbnail grid (Cam 01: North Gate Concourse, Cam 02: Metro Exit Corridor, Cam 03: Ring Road Overpass, Cam 04: South Gate Plaza) displaying live camera health and current occupant count.
    - **Detection Pipeline Transparency Card:**
      - Model In-Use: `Pre-computed YOLOv8 Detection Metadata (Calibration Baseline)` or `CPU Faster-RCNN`.
      - Pipeline latency: `Frame processing: ~24ms | FPS: 25`.
      - Bounding box count breakdown: `Persons: 64 | Vehicles: 8 | Density: 2.1 p/m²`.
    - **Anomaly Detection Stream:** Real-time event log generated from video analysis:
      - Sudden crowd deceleration detected (chokepoint onset).
      - Counter-flow detection (pedestrians moving against primary evacuation vector).
      - Vehicle stopped in red zone / emergency lane.
    - **Data Integrity Disclaimer:** `Video feed represents sample footage for calibration. Ground-truth bounding boxes are demonstrated for operational validation.`

### Screen 3: Digital Twin / Scenario Lab (`/scenario`)
*Predictive simulation sandbox allowing operators to test interventions on a simplified topological network before real-world execution.*

- **Layout Structure:** Split-screen comparison and parameter configuration workbench.
  - **Top Parameter Formulation Bar:**
    - Scenario Preset selector: `Baseline (Current Status)`, `Heavy Inflow (+50%)`, `Gate 1 Malfunction / Closure`, `Severe Weather Evacuation`.
    - `[Reset to Baseline]` and `[Run Simulation]` control buttons.
  - **Left Work Area (45% width): Topological Network Twin**
    - Simplified node-link graph visualization of the venue/precinct network.
    - Nodes represent: Gates, Entry Plazas, Corridors, Major Intersections, and Safe Assembly Zones.
    - Edges represent: Walkways, Roads, and Turnstile Banks with defined capacity limits (persons/hour or vehicles/hour).
    - Visual status of edges: Width indicates capacity; fill color indicates simulated saturation (Green < 60%, Yellow 60-85%, Red > 85% capacity).
    - Interactive edge/node inspection: Clicking any element displays its inflow, throughput, and bottleneck probability.
  - **Right Work Area (55% width): Intervention Controls & Outcome Comparison**
    - **Adjustable Parameter Sliders:**
      - Inflow Multiplier: `0.5x` to `3.0x` (simulates surge crowds).
      - Gate B Throughput: Toggle between `Open (100%)`, `Restricted (50%)`, `Closed (0%)`.
      - Traffic Diversion Ratio: `% traffic rerouted at Outer Ring Road (0% to 100%)`.
      - Public Transit Frequency: `Normal (10m headway)` vs `Surge Express (3m headway)`.
    - **Scenario Comparison Matrix (Baseline vs. Proposed Intervention):**
      - Direct side-by-side comparison table:
        - Metric: Peak Density at Gate 1 (Baseline: 4.2 p/m² [CRITICAL] vs. Intervention: 2.1 p/m² [NORMAL]).
        - Metric: Estimated Evacuation Duration (Baseline: 48 mins vs. Intervention: 31 mins).
        - Metric: Chokepoint Risk Score (Baseline: 88/100 vs. Intervention: 42/100).
    - **Capacity Breach Alerts:** Clear, non-technical warning list (e.g., `Warning: Diverting 60% flow to Corridor C will exceed its physical width capacity at T+12 minutes`).

### Screen 4: Emergency Routing (`/routing`)
*Fastest cleared path planner for ambulances, fire tenders, and rapid response personnel navigating around crowds and traffic choke points.*

- **Layout Structure:** 2-panel interface (Left: Route Planning & Obstacle Matrix; Right: High-Legibility Street Navigation Canvas).
  - **Left Rail (Width: 380px): Route Configuration & Alternatives**
    - **Origin & Destination Pickers:**
      - Origin: Dropdown of staging posts (e.g., `Fire Station 4`, `Disaster Medical Unit A`, `Police HQ Post`).
      - Destination: Incident zone or manual map coordinate picker (e.g., `Gate 2 Concourse - Medical Incident`).
      - Vehicle Profile Selector: `Ambulance (Fast / Width-Restricted)`, `Fire Tender (Heavy / Clearance-Restricted)`, `Rapid Patrol Unit`.
    - **Active Blocked Edges Manager:**
      - List of currently impassable road segments (e.g., `Ring Road Sector 3 - Severe Congestion`, `Stadium Road - Pedestrian Surge Spillover`).
      - Toggle switch to manually block/unblock any road edge for real-time testing.
    - **Computed Route Comparison Cards:**
      - **Route 1 (Recommended - Cleared Corridor):** Distance: 4.8 km | Est. Travel Time: 7 mins | Chokepoints Encountered: 0 | Road Clearance: 94%.
      - **Route 2 (Alternative - Perimeter Bypass):** Distance: 6.9 km | Est. Travel Time: 11 mins | Chokepoints Encountered: 0 | Road Clearance: 100%.
      - **Route 3 (Direct Path - COMPROMISED):** Distance: 3.2 km | Est. Travel Time: UNRELIABLE (>22 mins) | Blocked near Gate 2.
    - Turn-by-Turn Instruction Drawer: Expandable textual directions highlighting cautionary choke warnings.
  - **Right Canvas: Emergency Routing Map**
    - Full-canvas street map with high-visibility routing polylines:
      - Primary route drawn in high-contrast solid Steel Blue (`#365F8D`) with directional arrows.
      - Alternative route drawn in dashed Slate Blue (`#526174`).
      - Blocked roads drawn with distinct red hatched cross-lines and barrier symbols.
    - Waypoint pins for Origin (Green pin), Destination (Red pulsing crosshair), and Obstacles (Red hazard icons).

### Screen 5: Incidents & Reports (`/reports`)
*Audit log, historical incident register, evidence verification, and post-event analysis export.*

- **Layout Structure:** Full-width filterable registry with contextual slide-out audit drawer.
  - **Top Control Bar:**
    - Date & Time range selector.
    - Severity filter chips (`All`, `Critical`, `Warning`, `Resolved`).
    - Zone filter dropdown.
    - Export CTA: `[Export PDF Audit Brief]` / `[Export JSON Telemetry Log]`.
  - **Main Incident Data Table:**
    - Columns:
      1. `Incident ID` (e.g., `INC-2026-0842` in monospace).
      2. `Timestamp` (Time detected and duration).
      3. `Severity` (Badge: Critical / Warning / Resolved).
      4. `Type / Classification` (e.g., Crowd Surge, Gate Chokepoint, Stationary Vehicle, Route Blockage).
      5. `Zone / Coordinates` (e.g., Gate 1 Concourse).
      6. `Detection Source` (Badge: `Camera AI`, `Density Threshold`, `Operator Manual`).
      7. `Operator Status` (Acknowledged by OPR-01 / Dispatched / Closed).
      8. `Actions` (`[View Evidence]`, `[View Simulation Comparison]`).
  - **Contextual Evidence & Audit Drawer (Width: 480px, slide-out):**
    - Captured video frame snapshot corresponding to the exact moment of incident trigger.
    - Overlaid bounding boxes and density heatmap at incident trigger time.
    - Telemetry timeline sparkline (density trend leading up to the spike).
    - Recommended action log vs. actual operator action logged.
    - Operator notes text area for post-event documentation.

---

## 5. Component Inventory and Reusable Responsibilities

### 5.1 Shell & Layout Components
- **`AppHeader`:** Top-level brand identity, live status pill, global system clock, operator profile, and emergency mode toggle.
- **`NavBar`:** Screen switching tabs with keyboard shortcut indicators and badge counters.
- **`PageContainer`:** Standardized layout wrapper enforcing consistent padding, overflow behavior, and responsive margins.
- **`PanelCard`:** Foundational surface container (`background: #FFFFFF`, `border: 1px solid #D9E1EA`, `border-radius: 10px`, `padding: 16px`). Supports header, body, and footer slots.
- **`SplitPane`:** Configurable multi-column container supporting fixed-width sidebars and fluid-width canvas areas.

### 5.2 Common Interactive Controls
- **`Button`:**
  - Variants: `Primary` (Solid `#365F8D`, white text), `Secondary` (Surface `#EEF2F6`, border `#D9E1EA`, text `#172B43`), `Critical` (Solid `#B42318`, white text), `Ghost` (Transparent, text `#365F8D`).
  - Standard height: `40px`; compact height: `32px`.
  - States: Default, Hover, Active, Disabled, Loading (with embedded spinner).
- **`StatusBadge`:**
  - Semantic variants: `Critical` (Red), `Warning` (Amber), `Info` (Blue), `Positive` (Green), `Neutral` (Slate).
  - Enforces two-token design: background tint + bold text + mandatory icon to prevent color-only reliance.
- **`ProvenanceTag` (Data Source Tag):**
  - Dedicated badge specifying data origin: `[VIDEO DETECTED]`, `[SIMULATED TWIN]`, `[MAP TILE]`, `[MANUAL ENTRY]`.
- **`RangeSlider`:** Controlled range input with numerical value readout and threshold limit tick marks.
- **`SegmentedControl`:** Multi-option pill switcher for views, camera feeds, and mode selection.

### 5.3 Map & Spatial Components
- **`LeafletMapWrapper`:** Core Leaflet container with responsive resize handling, tile error catching, and custom light-theme basemap tiles.
- **`HeatmapLayer`:** Canvas-based dynamic heatmap rendering Gaussian density distributions with calibrated color ramps.
- **`ZonePolygonLayer`:** Interactive GeoJSON/polygon layer rendering zone boundaries, hover highlights, and capacity status colors.
- **`RoutePolylineLayer`:** Multi-colored polyline renderer for primary, alternative, and blocked road segments.
- **`MapLegend`:** Floating overlay component displaying density scale (Fruin LoS), marker definitions, and layer toggles.
- **`MapFallbackView`:** Vector SVG/Canvas fallback diagram displayed if network tile fetching fails.

### 5.4 Domain-Specific Cards & Widgets
- **`ZoneKpiCard`:** Displays zone title, capacity bar, current density (p/m²), and trend arrow.
- **`IncidentCard`:** Urgent alert item featuring severity badge, time elapsed, concise anomaly summary, and action triggers.
- **`VideoPlayerWithOverlay`:** Video tag synchronized with an HTML5 Canvas bounding box overlay and scrubber.
- **`NetworkGraphViewer`:** Interactive node-link topology renderer for the Digital Twin simulation.
- **`RouteSummaryCard`:** Compares route travel time, distance, and obstacle clearance metrics.

---

## 6. Comprehensive System State Matrix

Every view and component in Darshini must handle seven distinct operational states gracefully:

| State | Visual Treatment | Operator Feedback / Behavior |
| :--- | :--- | :--- |
| **Loading** | Clean bone-gray skeleton blocks (`#EEF2F6`) with subtle shimmer animation. No jumping layout shifts. | Prevents interactions while initial telemetry or map tiles initialize. |
| **Empty** | Centered clean slate illustration with clear text (e.g., *"No Active Critical Incidents in Monitored Precinct"*). | Informs operator that system is active but zero alerts exist. |
| **Error** | Border changes to subtle red tint; displays descriptive message and `[Retry Connection]` button. | Occurs if video stream drops or routing calculation fails. |
| **Stale Data** | Yellow boundary accent line; banner: `[TELEMETRY STALE: >15s Since Last Ping]`. | Triggered if websocket or telemetry polling encounters latency. |
| **Disabled** | 40% opacity, cursor `not-allowed`, tooltip explaining why control is locked. | Used when a simulation is running or edge is un-routable. |
| **Selected** | 2px solid steel blue outline (`#365F8D`) with faint tint `#F0F4F8`. | Applied to the currently focused zone, camera, or road edge. |
| **Demo / Sample** | Persistent top-header pill and watermark badge on synthetic graphs. | Strictly clarifies that data is simulated and not live real-world tracking. |

---

## 7. Map Layers, Legend, Zone Selection and Fallback Behaviour

### 7.1 Layer Hierarchy & Stacking Order (Z-Index)
1. **Base Map Layer (z-index: 1):** Clean OpenStreetMap standard/Carto Positron street tiles. Neutral, desaturated styling so operational overlays stand out.
2. **Zone Polygons Layer (z-index: 10):** Semi-transparent filled polygons (`fillOpacity: 0.15`, `weight: 2px`) showing perimeter boundaries of designated zones.
3. **Density Heatmap Layer (z-index: 20):** Dynamic Gaussian density surface. Heatmap opacity capped at `0.65` so street labels and buildings remain legible beneath.
4. **Road Network & Routing Polylines (z-index: 30):** High-contrast street segments and active navigation paths (`weight: 4px` to `6px`).
5. **Point Markers & Overlays (z-index: 40):** Incident alert pins, camera location markers, vehicle pins, and gate bottleneck tags.
6. **Active Selection Callouts (z-index: 50):** Interactive popups and floating inspection tooltips.

### 7.2 Heatmap Density Calibration & Legend
The density heatmap strictly conforms to the **Fruin Level of Service (LoS)** pedestrian standard:
- **Level A-B (Free Flow, 0.0 - 0.72 persons/m²):** Soft blue-green hue (`#237A57`, opacity 0.3). Normal walking speed, unhindered movement.
- **Level C-D (Moderate Density, 0.73 - 1.08 persons/m²):** Amber-yellow hue (`#A15C00`, opacity 0.5). Noticeable walking restrictions, queuing begins.
- **Level E-F (Severe Congestion / Stampede Risk, > 2.0 persons/m²):** High-visibility red hue (`#B42318`, opacity 0.7). Physical contact, forward movement impeded, chokepoint danger.

### 7.3 Map Fallback Behavior (Offline / Tile Failure)
If external map tiles fail to load (e.g., lack of external internet during a hackathon evaluation or network timeout):
1. **Graceful Fallback Mode:** The map container catches tile loading errors and replaces the raster canvas with an internal **Vector SVG Schematic Map**.
2. **Schematic Map Design:** A clean, scaled vector blueprint of the precinct showing road centerlines, zone blocks, gates, and cameras on a neutral `#EEF2F6` canvas.
3. **Zero Functionality Loss:** Zone selections, routing polylines, and incident pins render seamlessly on top of the vector schematic map, guaranteeing an unbroken demonstration.

---

## 8. End-to-End User Workflows

### 8.1 Workflow 1: Investigating an Overcrowding Surge Alert
1. **Detection:** Live Operations screen displays an audible-visual alert in the Right Rail: `CRITICAL: Gate 1 Concourse density exceeded 3.2 p/m²`.
2. **Geographic Localization:** Operator clicks the incident card. The map smoothly pans to the Gate 1 zone polygon, highlighting its red boundary and displaying an elevated heatmap cluster.
3. **Visual Verification:** Operator clicks `[View Camera 01]` directly from the map popup, immediately transitioning to Screen 2 with Camera 01 pre-focused.
4. **Evidence Inspection:** Operator reviews the video player with bounding box detections confirming an influx queue bottleneck at turnstiles.
5. **Action Acknowledgment:** Operator logs acknowledgment and initiates a mitigation advisory.

### 8.2 Workflow 2: Testing an Intervention in the Digital Twin
1. **Initiation:** From the Gate 1 incident card, operator clicks `[Simulate Mitigation in Twin]`.
2. **Sandbox Pre-loading:** Screen 3 opens with baseline crowd conditions pre-populated.
3. **Intervention Setup:** Operator drags the "Turnstile 1B" toggle to `Open` and adjusts "Inflow Diversion Slider" to `35% reroute to North Corridor`.
4. **Execution:** Operator clicks `[Run Simulation]`.
5. **Outcome Analysis:** The scenario graph visualizes flow distribution. The comparison table confirms: Peak density decreases from `3.4 p/m²` to `1.8 p/m²`, safely averting the chokepoint without creating secondary bottlenecks.

### 8.3 Workflow 3: Emergency Vehicle Dispatch & Route Clearance
1. **Incident Trigger:** A medical emergency is reported inside Pavilion B.
2. **Route Initiation:** Operator navigates to Screen 4 (Emergency Routing). Destination defaults to Pavilion B Medical Access Gate.
3. **Obstacle Detection:** The system automatically flags that the primary arterial (Stadium Boulevard) is blocked by pedestrian overflow.
4. **Alternative Path Generation:** The routing engine computes and renders two alternative clear corridors.
5. **Route Selection:** Operator selects Route 2 (Perimeter Service Road), which avoids all crowd zones and adds only 90 seconds of transit time.
6. **Dispatch Broadcast:** Operator clicks `[Approve Route & Export Directions]`, generating a clean turn-by-turn clearance order.

### 8.4 Workflow 4: Post-Event Incident Audit & Evidence Review
1. **Review:** Operator opens Screen 5 (Incidents & Reports) post-shift.
2. **Filtering:** Filters by `Severity: Critical` and `Zone: Gate 1`.
3. **Detail Inspection:** Opens `INC-2026-0842`. Inspects recorded time-series telemetry, saved camera snapshot frame with detection boxes, and the log of operator interventions.
4. **Export:** Generates an auditable, standardized PDF/printable incident summary sheet.

---

## 9. Accessibility, Readable Contrast & Non-Colour Status Cues

### 9.1 Contrast Ratios (WCAG 2.1 AA & AAA Compliance)
- **Primary Text (`#172B43`) on White (`#FFFFFF`):** Contrast ratio of **14.2:1** (Far exceeds AAA standard of 7.0:1).
- **Secondary Text (`#526174`) on White (`#FFFFFF`):** Contrast ratio of **5.4:1** (Exceeds AA standard of 4.5:1).
- **Steel Blue Accent (`#365F8D`) on White (`#FFFFFF`):** Contrast ratio of **5.8:1** (Exceeds AA standard of 4.5:1).
- **Critical Red (`#B42318`) on White (`#FFFFFF`):** Contrast ratio of **5.9:1** (Exceeds AA standard).
- **Warning Amber (`#A15C00`) on White (`#FFFFFF`):** Contrast ratio of **5.2:1** (Exceeds AA standard).

### 9.2 Non-Colour Redundant Cues
To ensure complete accessibility for color-vision-deficient operators and under high-glare ambient lighting:
- **No color is ever used as the sole conveyor of information.**
- Every status indicator pairs color with a distinct typographic label AND a geometric icon:
  - **Critical:** Red color + Bold label `CRITICAL` + Triangle Alert icon `[!]`.
  - **Warning:** Amber color + Bold label `WARNING` + Diamond Caution icon `[^]`.
  - **Info:** Blue color + Bold label `INFO` + Circle Information icon `(i)`.
  - **Positive:** Green color + Bold label `NORMAL` + Checkmark icon `[✓]`.
- Map routing paths use distinct stroke patterns (Solid for Recommended, Dashed for Alternative, Hatched/Crossed for Blocked).

### 9.3 Keyboard Navigation & Focus Rings
- All interactive controls (buttons, inputs, tabs, table rows) feature an explicit 2px Steel Blue focus outline (`outline: 2px solid #365F8D; outline-offset: 2px`).
- Number keys `1` through `5` trigger instant top-level screen switching.
- Standard tab ordering is preserved sequentially from left-to-right, top-to-bottom.
- Modals and slide-out drawers trap focus and can be dismissed immediately via the `Escape` key.

---

## 10. Visual Distinction & Data Integrity System

To avoid any ambiguity between empirical surveillance observations, external map tiles, mathematical models, and simulated outcomes, Darshini implements an uncompromising visual taxonomy:

| Data Category | Visual Badge / Border | Explanation & Provenance | User Trust Boundary |
| :--- | :--- | :--- | :--- |
| **Observed Video Detections** | `[OBSERVED: CAMERA]`<br>Border: `#365F8D` (Steel Blue) | Empirical bounding-box count from sample or live camera feed. Includes camera ID and frame timestamp. | Ground truth for the camera's specific Field of View only. |
| **External Map Context** | `[MAP: OPENSTREETMAP]`<br>Border: `#D9E1EA` (Neutral Border) | Standard geographical street tiles. Disclaimed as spatial context, not real-time live traffic. | Geographic reference layer only. |
| **Heuristic Risk Estimates** | `[ESTIMATE: HEURISTIC]`<br>Border: `#A15C00` (Amber) | Derived metric calculated from density and rate of influx. | Prototype indicator, not certified life-safety prediction. |
| **Simulated Twin Inputs** | `[SIMULATION INPUT]`<br>Border: `#245D9C` (Info Blue) | Assumptions entered by the operator (e.g., +40% crowd influx slider, closed gate toggle). | User-modified synthetic parameters. |
| **Projected Scenario Outcomes**| `[PROJECTED: TWIN]`<br>Border: Purple-Slate (`#526174`) | Mathematical graph flow projection derived from what-if parameters. | Projected scenario forecast; must be validated by human operator. |

### Human-in-the-Loop Mandate
All automated advisories and emergency routing proposals generated by Darshini prominently display the human-in-the-loop notice:
> **"Notice:** Recommendations are decision-support estimates generated from heuristic models. Dispatch of personnel and route closures require explicit operational verification by a human commander."
