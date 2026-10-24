# Leaflet `_leaflet_pos` Runtime Error Fix Report

## 1. Confirmed Root Cause

### Error Stack
```text
Uncaught TypeError: can't access property "_leaflet_pos", el is undefined
getPosition DomUtil.js:247
_getMapPanePos Map.js:1488
_rawPanBy Map.js:1266
invalidateSize Map.js:581
CommandMap CommandMap.tsx:468
```

### Mechanism of the Error
1. **Unmanaged / Uncancelled Timer**:
   In `frontend/src/components/map/CommandMap.tsx`, line 467 previously scheduled a delayed map size invalidation inside the map initialization `useEffect`:
   ```tsx
   setTimeout(() => {
     map.invalidateSize();
   }, 150);
   ```
   The timer ID was neither stored nor cleared in the `useEffect` cleanup return callback (`return () => { map.remove(); mapInstanceRef.current = null; };`).

2. **Leaflet Teardown Lifecycle vs. `invalidateSize()`**:
   When the user navigated away (e.g. switching tabs from "Live Operations" to "Camera & Detection" or "Scenario Lab"), toggled view modes (from Street Map to Vector Schematic), or when React 18 ran strict-mode effect cleanup/remount:
   - `useEffect` cleanup ran synchronously, invoking `map.remove()`.
   - Leaflet's `remove()` function detaches DOM panes and deletes `this._mapPane` (`delete this._mapPane`), but **does not** set `this._loaded = false` (`this._loaded` remains `true`).
   - 150ms after initial mount, the orphaned `setTimeout` callback fired and invoked `map.invalidateSize()` on the removed map instance.
   - Inside Leaflet's `invalidateSize()` (`Map.js:581`), because `this._loaded` was still `true`, it proceeded to calculate viewport size changes and invoked `this._rawPanBy(offset)`.
   - `_rawPanBy` called `_getMapPanePos()`, which executed `DomUtil.getPosition(this._mapPane)`.
   - Because `this._mapPane` was deleted during `map.remove()`, `el` was `undefined`.
   - In `DomUtil.js:247`, accessing `el._leaflet_pos` threw the fatal runtime exception:
     `Uncaught TypeError: can't access property "_leaflet_pos", el is undefined`.

3. **Absence of DOM & Map Usability Checks**:
   Additionally, prior to this fix:
   - There was no check that the map container was still attached (`container.isConnected`) before invalidating or panning.
   - Sizing invalidation relied solely on the arbitrary delay rather than responding to actual container layout and resize events.

---

## 2. Files Changed and Reason for Each

### `frontend/src/components/map/CommandMap.tsx`
- **Reason**: This was the single call site of `invalidateSize()` in the codebase and where the Leaflet map lifecycle, container refs, and event listeners are managed.
- **Modifications**:
  1. Added component mount tracking (`isMountedRef`) to guard asynchronous callbacks (such as `navigator.geolocation.getCurrentPosition`).
  2. Guarded programmatic map camera movements (`panTo`, `flyTo`, `fitBounds`) with `mapInstanceRef.current.getContainer()?.isConnected` to ensure actions are only dispatched when the map is attached to the active DOM.
  3. Replaced the unmanaged `setTimeout` with a lifecycle-safe sizing architecture:
     - Implemented `safeInvalidateSize()` with strict guards: verifies `!isDisposed`, `container.isConnected`, `mapInstanceRef.current === map`, `map.getContainer()?.isConnected`, and `map.getPanes()?.mapPane`.
     - Implemented `scheduleInvalidate()` coalesced with `requestAnimationFrame` to avoid duplicate or re-entrant size calculations.
     - Attached a `ResizeObserver` on `mapContainerRef.current` to automatically and safely react to responsive changes, sidebar toggles, and viewport reflows.
     - Scheduled a secondary 150ms fallback invalidation that is explicitly cancelled upon unmount.
     - In the `useEffect` cleanup function: set `isDisposed = true`, cleared pending timers (`clearTimeout`), cancelled animation frames (`cancelAnimationFrame`), disconnected `ResizeObserver`, cleaned up layer group refs, and invoked `map.remove()`.

---

## 3. Explanation of the Fix

### Lifecycle Safety Invariant
The fix enforces that `invalidateSize()` and other map operations can **only** execute when all of the following conditions are met:
1. The component is still mounted and the effect has not entered its cleanup phase (`!isDisposed`).
2. The React container reference is connected to the DOM (`mapContainerRef.current?.isConnected`).
3. The active map instance reference matches the current map (`mapInstanceRef.current === map`).
4. Leaflet's container element is still connected to the DOM (`map.getContainer()?.isConnected`).
5. Leaflet's panes (specifically `mapPane`) exist and have not been destroyed by `map.remove()` (`map.getPanes()?.mapPane`).

### Dynamic Resizing via `ResizeObserver` + `requestAnimationFrame`
Rather than relying on arbitrary magic timeouts, resizing now listens directly to layout changes on the map container via `ResizeObserver`. Requests are coalesced through `requestAnimationFrame` so that multiple rapid layout passes (e.g., during window resize or animated flex transitions) coalesce into a single map redraw.

### Clean Teardown
When the map component unmounts:
```tsx
return () => {
  isDisposed = true;

  if (initialTimerId !== null) {
    clearTimeout(initialTimerId);
    initialTimerId = null;
  }

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  polygonLayerGroupRef.current = null;
  markersLayerGroupRef.current = null;
  userLocationLayerGroupRef.current = null;

  map.remove();
  mapInstanceRef.current = null;
};
```
This guarantees that no pending timer, animation frame, or resize observer callback can execute on a destroyed Leaflet instance.

---

## 4. Build and Test Results

### 1. Frontend Production Build (`npm run build`)
```text
> darshini-frontend@0.3.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
✓ 49 modules transformed.
dist/index.html                   1.17 kB │ gzip:   0.64 kB
dist/assets/index-CiPuFiH8.css   86.44 kB │ gzip:  17.00 kB
dist/assets/index-B8U8HWth.js   431.95 kB │ gzip: 125.10 kB
✓ built in 1.68s
```
- **Result**: Passed cleanly with **0 TypeScript errors** and **0 build warnings**.

### 2. Backend Automated Test Suite (`pytest`)
```text
============================= test session starts ==============================
platform linux -- Python 3.13.12, pytest-9.0.3, pluggy-1.6.0
rootdir: /home/jyno/Projects/Darshini/backend
plugins: anyio-4.12.1, typeguard-4.4.4
collected 52 items

tests/test_camera.py ...........                                         [ 21%]
tests/test_detection.py .......                                          [ 34%]
tests/test_detection_accuracy.py ..........                              [ 53%]
tests/test_detection_history.py ........                                 [ 69%]
tests/test_health.py ...                                                 [ 75%]
tests/test_location_session.py ...                                       [ 80%]
tests/test_simulation.py ..........                                      [100%]

============================== 52 passed in 8.84s ==============================
```
- **Result**: **52 passed, 0 failed**. Zero regressions across all camera, detection, historical persistence, and simulation modules.

---

## 5. Remaining Manual Browser Verification

> [!NOTE]
> Automated browser subagent execution (`open_browser_url`) failed due to environment driver CDN connectivity (404 from Azure CDN for Playwright Linux binary). As required, automated browser verification is not falsely claimed.

To complete final end-to-end verification in a browser:
1. Open `http://localhost:5173` in Chrome/Firefox.
2. In the top navigation bar, rapidly toggle between:
   - **Live Operations (1)**
   - **Camera & Detection (2)**
   - **Scenario Lab (3)**
   - **Emergency Routing (4)**
3. On the "Live Operations" screen, click **Vector Schematic (Fallback)** and then **Street Map (Leaflet)** multiple times in quick succession (<150ms).
4. Resize the browser window horizontally and vertically.
5. Open Developer Tools (`F12` / `Ctrl+Shift+I` -> `Console`) and confirm:
   - No `_leaflet_pos` errors.
   - No `TypeError: can't access property "_leaflet_pos", el is undefined`.
   - No unhandled Promise rejections.
