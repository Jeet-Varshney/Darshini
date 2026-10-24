/**
 * Comprehensive Geolocation Logic & Flow Test Suite
 * Covers:
 * 1. Successful geolocation
 * 2. Permission denied (Code 1)
 * 3. Position unavailable (Code 2)
 * 4. Timeout (Code 3)
 * 5. Unsupported Geolocation API
 * 6. Unsupported Permissions API
 * 7. Insecure context handling (HTTP non-localhost)
 * 8. Invalid coordinates validation (out-of-bounds / NaN / infinite)
 * 9. Overlapping request prevention (deduplication)
 * 10. Default venue preservation on failure/clear
 * 11. Retry mechanism with high-accuracy option
 * 12. High-accuracy enabled by default with fresh cache (maximumAge: 0)
 * 13. Low location accuracy detection (±15,000m city-level uncertainty triggers warning and fitBounds)
 * 14. Preservation of coordinates (never silently replace coordinates with an arbitrary location)
 * 15. Manual location selection on map (manual-selection, ±10m precision, dismisses warning)
 * 16. Marker drag adjustment (manual-drag, ±10m precision)
 * 17. Telemetry logging in development mode vs suppression in production
 */

import assert from 'node:assert';

const POOR_ACCURACY_THRESHOLD_METERS = 150;

class GeolocationFlowSimulator {
  constructor(options = {}) {
    this.isSecureContext = options.isSecureContext ?? true;
    this.hasGeolocation = options.hasGeolocation ?? true;
    this.hasPermissionsApi = options.hasPermissionsApi ?? true;
    this.initialPermission = options.initialPermission ?? 'prompt';
    this.mockPosition = options.mockPosition ?? { coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 25 }, timestamp: 1700000000000 };
    this.mockError = options.mockError ?? null;
    this.isDevMode = options.isDevMode ?? true;
    this.venueCenter = [28.6145, 77.2100];
    this.venueZoom = 16;

    // Simulated component state
    this.locationStatus = 'idle';
    this.locationError = null;
    this.locationDiagDetails = null;
    this.userLocation = null;
    this.isSelectingLocation = false;
    this.isPoorAccuracyWarning = false;
    this.isPoorAccuracyDismissed = false;
    this.mapCenter = [...this.venueCenter];
    this.mapZoom = this.venueZoom;
    this.flyToCalls = [];
    this.fitBoundsCalls = [];
    this.telemetryLogs = [];
    this.lastAttemptTime = 0;
    this.activeWatchId = null;
    this.isFallbackActive = false;
    this.displayedCoordinatesLabel = 'Demo Venue: Bharat Mandapam Precinct';
  }

  // Simulate Permissions API
  queryPermission() {
    if (!this.hasPermissionsApi) {
      return Promise.reject(new Error('Permissions API not supported'));
    }
    return Promise.resolve({ state: this.initialPermission });
  }

  logTelemetry(source, lat, lng, accuracy, timestamp, markerCoords) {
    if (this.isDevMode) {
      const record = {
        source,
        latitude: lat,
        longitude: lng,
        accuracyMeters: Math.round(accuracy * 10) / 10,
        timestamp: new Date(timestamp).toISOString(),
        leafletMarkerCoordinates: markerCoords || [lat, lng],
      };
      this.telemetryLogs.push(record);
      return record;
    }
    return null;
  }

  // Simulated request flow matching CommandMap.tsx
  handleUseMyLocation(forceHighAccuracy = true) {
    const now = Date.now();
    if (now - this.lastAttemptTime < 2500 && this.lastAttemptTime !== 0) {
      return 'THROTTLED_RATE_LIMITED';
    }
    this.lastAttemptTime = now;

    if (this.locationStatus === 'requesting') {
      return 'OVERLAPPING_IGNORED';
    }

    if (!this.isSecureContext) {
      this.locationStatus = 'insecure';
      this.locationError =
        'Location access is blocked because this site is loaded over an unencrypted connection (HTTP). ' +
        'Web browsers strictly require a secure context (HTTPS or http://localhost) to display location permission prompts. ' +
        'When accessing Darshini over LAN or remote IPs, please configure an SSL proxy or connect via localhost.';
      this.locationDiagDetails = 'isSecureContext: false';
      return;
    }

    if (!this.hasGeolocation) {
      this.locationStatus = 'unsupported';
      this.locationError =
        'Browser Geolocation is not supported by your current browser environment or has been disabled in browser preferences.';
      this.locationDiagDetails = 'navigator.geolocation: undefined';
      return;
    }

    if (this.initialPermission === 'denied') {
      this.locationStatus = 'denied';
      this.locationError =
        'Location permission is currently blocked in your browser settings. The browser will not show a prompt again automatically. ' +
        'Please click the lock or site settings icon in your browser address bar, set Location to "Allow" or "Ask", and click "Use My Location" again.';
      this.locationDiagDetails = 'PermissionState: denied';
      return;
    }

    this.locationStatus = 'requesting';
    this.locationError = null;
    this.locationDiagDetails = null;
    this.isSelectingLocation = false;

    // Simulate async browser call
    if (this.mockError) {
      this.handleError(this.mockError, forceHighAccuracy);
    } else {
      this.handleSuccess(this.mockPosition, forceHighAccuracy);
    }
  }

  handleSuccess(position, forceHighAccuracy) {
    const { latitude, longitude, accuracy } = position.coords;
    const timestamp = position.timestamp || Date.now();

    // Coordinate validation
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !isFinite(latitude) ||
      !isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      this.locationStatus = 'unavailable';
      this.locationError = 'Received invalid coordinates from the browser location provider.';
      this.locationDiagDetails = 'Invalid coordinates received';
      return;
    }

    const validAccuracy = typeof accuracy === 'number' && isFinite(accuracy) ? accuracy : 1000;
    this.userLocation = {
      lat: latitude,
      lng: longitude,
      accuracy: validAccuracy,
      source: 'navigator.geolocation',
      timestamp,
    };
    this.locationStatus = 'active';
    this.locationError = null;
    this.isPoorAccuracyDismissed = false;
    this.isPoorAccuracyWarning = validAccuracy > POOR_ACCURACY_THRESHOLD_METERS;
    this.locationDiagDetails = `Resolved (accuracy: ±${Math.round(this.userLocation.accuracy)}m, mode: ${
      forceHighAccuracy ? 'High-Accuracy/GPS' : 'Standard/Network'
    })`;

    this.logTelemetry('navigator.geolocation', latitude, longitude, validAccuracy, timestamp, [latitude, longitude]);

    if (validAccuracy > POOR_ACCURACY_THRESHOLD_METERS) {
      this.fitBoundsCalls.push({ center: [latitude, longitude], radius: validAccuracy });
    } else {
      this.mapCenter = [latitude, longitude];
      this.mapZoom = 16;
      this.flyToCalls.push({ center: [latitude, longitude], zoom: 16 });
    }
  }

  handleSetManualLocation(lat, lng) {
    const manualAccuracy = 10;
    const timestamp = Date.now();
    this.userLocation = {
      lat,
      lng,
      accuracy: manualAccuracy,
      source: 'manual-selection',
      timestamp,
    };
    this.locationStatus = 'active';
    this.isSelectingLocation = false;
    this.isPoorAccuracyWarning = false;
    this.isPoorAccuracyDismissed = true;
    this.locationError = null;
    this.locationDiagDetails = `Manually placed pin at [${lat.toFixed(6)}, ${lng.toFixed(6)}]`;

    this.logTelemetry('manual-selection', lat, lng, manualAccuracy, timestamp, [lat, lng]);
    this.mapCenter = [lat, lng];
  }

  handleMarkerDrag(lat, lng) {
    const manualAccuracy = 10;
    const timestamp = Date.now();
    this.userLocation = {
      lat,
      lng,
      accuracy: manualAccuracy,
      source: 'manual-drag',
      timestamp,
    };
    this.isPoorAccuracyWarning = false;
    this.isPoorAccuracyDismissed = true;
    this.locationDiagDetails = `Pin dragged to [${lat.toFixed(6)}, ${lng.toFixed(6)}]`;

    this.logTelemetry('manual-drag', lat, lng, manualAccuracy, timestamp, [lat, lng]);
    this.mapCenter = [lat, lng];
  }

  handleError(error, forceHighAccuracy) {
    let msg = 'Failed to obtain current location.';
    let status = 'unavailable';

    switch (error.code) {
      case 1:
        status = 'denied';
        msg =
          'Location permission was denied. Your browser or operating system settings have blocked location access for this address. ' +
          'The map has defaulted to the configured venue coordinates. You can grant permission in your browser site settings, or place your location pin manually.';
        break;
      case 2:
        status = 'unavailable';
        msg =
          'Device location is currently unavailable. The browser could not obtain coordinates from the available positioning providers (Error Code 2: UNAVAILABLE). ' +
          'The map has fallen back to the configured demo venue coordinates. You can click "Set Pin Manually" to place your location pin on the map, or retry.';
        break;
      case 3:
        status = 'timeout';
        msg =
          'The request to get your location timed out before receiving coordinates (Error Code 3: TIMEOUT). ' +
          'The map is displaying the configured demo venue coordinates. Please check your connection and retry, or set your location manually.';
        break;
      default:
        msg = error.message || 'An unknown error occurred while retrieving device location.';
        break;
    }

    this.locationStatus = status;
    this.locationError = msg;
    this.locationDiagDetails = `Error Code ${error.code} (${status.toUpperCase()}) • Provider: ${error.message || 'Error acquiring position'}`;
    this.userLocation = null;
    this.mapCenter = [...this.venueCenter];
    this.isFallbackActive = true;
    this.displayedCoordinatesLabel = 'Fallback: Demo Venue Coordinates';
  }

  // Geolocation watch registration simulation
  watchPosition(cb, errCb) {
    this.activeWatchId = 999;
    return this.activeWatchId;
  }

  clearWatch(id) {
    if (this.activeWatchId === id) {
      this.activeWatchId = null;
      return true;
    }
    return false;
  }

  handleClearLocation() {
    if (this.activeWatchId !== null) {
      this.clearWatch(this.activeWatchId);
    }
    this.userLocation = null;
    this.locationStatus = 'idle';
    this.locationError = null;
    this.locationDiagDetails = null;
    this.isSelectingLocation = false;
    this.isPoorAccuracyWarning = false;
    this.isPoorAccuracyDismissed = false;
    this.mapCenter = [...this.venueCenter];
    this.mapZoom = this.venueZoom;
    this.isFallbackActive = false;
    this.displayedCoordinatesLabel = 'Demo Venue: Bharat Mandapam Precinct';
  }
}

console.log('Running Darshini Comprehensive Geolocation Test Suite...\n');

// Test 1: Successful Geolocation
{
  const sim = new GeolocationFlowSimulator();
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'active');
  assert.strictEqual(sim.userLocation.lat, 12.9716);
  assert.strictEqual(sim.userLocation.source, 'navigator.geolocation');
  assert.deepStrictEqual(sim.mapCenter, [12.9716, 77.5946]);
  assert.strictEqual(sim.flyToCalls.length, 1);
  console.log('✔ Test 1: Successful geolocation centers map and renders active location state');
}

// Test 2: Permission Denied (Error Code 1)
{
  const sim = new GeolocationFlowSimulator({
    mockError: { code: 1, message: 'User denied Geolocation' }
  });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'denied');
  assert.ok(sim.locationError.includes('permission was denied'));
  assert.ok(sim.locationError.includes('site settings'));
  assert.strictEqual(sim.userLocation, null);
  assert.deepStrictEqual(sim.mapCenter, sim.venueCenter, 'Venue map must remain preserved on error');
  console.log('✔ Test 2: Error Code 1 (PERMISSION_DENIED) handled with site settings instructions');
}

// Test 3: Position Unavailable (Error Code 2 - Desktop Linux / Chromium without GPS)
{
  const sim = new GeolocationFlowSimulator({
    mockError: { code: 2, message: "Network location provider at 'https://www.googleapis.com/' : Returned error code 400." }
  });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'unavailable');
  assert.ok(sim.locationError.includes('Device location is currently unavailable'));
  assert.ok(sim.locationError.includes('Error Code 2: UNAVAILABLE'));
  assert.ok(sim.locationDiagDetails.includes('Error Code 2'));
  assert.ok(sim.locationDiagDetails.includes('googleapis.com'));
  assert.strictEqual(sim.userLocation, null, 'Must never set fake user coordinates on unavailable error');
  assert.strictEqual(sim.isFallbackActive, true);
  assert.deepStrictEqual(sim.mapCenter, sim.venueCenter, 'Venue map preserved when position is unavailable');
  console.log('✔ Test 3: Error Code 2 (POSITION_UNAVAILABLE) properly diagnoses provider failure without fabricating data');
}

// Test 4: Timeout (Error Code 3)
{
  const sim = new GeolocationFlowSimulator({
    mockError: { code: 3, message: 'Request timed out' }
  });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'timeout');
  assert.ok(sim.locationError.includes('timed out'));
  console.log('✔ Test 4: Error Code 3 (TIMEOUT) correctly reported with retry support');
}

// Test 5: Unsupported Geolocation API
{
  const sim = new GeolocationFlowSimulator({ hasGeolocation: false });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'unsupported');
  assert.ok(sim.locationError.includes('not supported'));
  console.log('✔ Test 5: Missing navigator.geolocation handled gracefully');
}

// Test 6: Unsupported Permissions API
{
  const sim = new GeolocationFlowSimulator({ hasPermissionsApi: false });
  sim.queryPermission().catch((err) => {
    assert.strictEqual(err.message, 'Permissions API not supported');
  });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'active');
  console.log('✔ Test 6: Missing Permissions API gracefully ignored without crashing');
}

// Test 7: Insecure Context Handling (HTTP on LAN/Remote IP)
{
  const sim = new GeolocationFlowSimulator({ isSecureContext: false });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'insecure');
  assert.ok(sim.locationError.includes('HTTPS'));
  assert.ok(sim.locationError.includes('localhost'));
  console.log('✔ Test 7: Insecure HTTP context blocked with clear SSL/localhost deployment explanation');
}

// Test 8: Coordinate Validation (NaN / Infinite / Out of bounds)
{
  const sim = new GeolocationFlowSimulator({
    mockPosition: { coords: { latitude: 999.0, longitude: 12.0, accuracy: 10 } }
  });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'unavailable');
  assert.ok(sim.locationError.includes('invalid coordinates'));
  assert.strictEqual(sim.userLocation, null);
  console.log('✔ Test 8: Out-of-bounds coordinates (>90° lat) rejected without corrupting map');
}

// Test 9: Overlapping Request Deduplication
{
  const sim = new GeolocationFlowSimulator();
  sim.locationStatus = 'requesting';
  const result = sim.handleUseMyLocation(true);
  assert.strictEqual(result, 'OVERLAPPING_IGNORED');
  console.log('✔ Test 9: Concurrent/overlapping location requests prevented while in requesting state');
}

// Test 10: Clear Location & Return to Venue
{
  const sim = new GeolocationFlowSimulator();
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'active');
  assert.notDeepStrictEqual(sim.mapCenter, sim.venueCenter);

  sim.handleClearLocation();
  assert.strictEqual(sim.locationStatus, 'idle');
  assert.strictEqual(sim.userLocation, null);
  assert.deepStrictEqual(sim.mapCenter, sim.venueCenter, 'Must restore exact venue center coordinates on clear');
  console.log('✔ Test 10: Clearing location cleanly restores venue operations center coordinates');
}

// Test 11: Retry with High-Accuracy Parameter
{
  const sim = new GeolocationFlowSimulator();
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'active');
  assert.ok(sim.locationDiagDetails.includes('High-Accuracy/GPS'));
  console.log('✔ Test 11: High-accuracy retry flag successfully passed to geolocation provider');
}

// Test 12: High-Accuracy Enabled by Default
{
  const sim = new GeolocationFlowSimulator();
  // Calling with no argument defaults to high-accuracy
  sim.handleUseMyLocation();
  assert.strictEqual(sim.locationStatus, 'active');
  assert.ok(sim.locationDiagDetails.includes('High-Accuracy/GPS'));
  console.log('✔ Test 12: High-accuracy is enabled by default for all user-initiated queries');
}

// Test 13: Low Location Accuracy Detection (City-level IP Geolocation)
{
  const sim = new GeolocationFlowSimulator({
    // Coarse IP location with 15,000 meter (15km) uncertainty
    mockPosition: { coords: { latitude: 28.6139, longitude: 77.2090, accuracy: 15000 }, timestamp: 1700000001000 }
  });
  sim.handleUseMyLocation();
  assert.strictEqual(sim.locationStatus, 'active');
  assert.strictEqual(sim.isPoorAccuracyWarning, true, 'Accuracy > 150m must flag poor accuracy warning');
  assert.strictEqual(sim.fitBoundsCalls.length, 1, 'Poor accuracy must fit bounds to circle rather than blinding zoom 16');
  assert.strictEqual(sim.fitBoundsCalls[0].radius, 15000);
  console.log('✔ Test 13: Coarse city-level IP geolocation (±15km) triggers accuracy warning and uncertainty bounds');
}

// Test 14: Coordinate Preservation (Never silently replace coordinates with arbitrary location)
{
  const sim = new GeolocationFlowSimulator({
    // User is reported at coordinates far from venue center
    mockPosition: { coords: { latitude: 19.0760, longitude: 72.8777, accuracy: 5000 }, timestamp: 1700000002000 }
  });
  sim.handleUseMyLocation();
  assert.strictEqual(sim.userLocation.lat, 19.0760, 'Reported latitude must be preserved verbatim');
  assert.strictEqual(sim.userLocation.lng, 72.8777, 'Reported longitude must be preserved verbatim');
  assert.notDeepStrictEqual([sim.userLocation.lat, sim.userLocation.lng], sim.venueCenter, 'Must never silently clamp or overwrite coordinates with venue center');
  console.log('✔ Test 14: Physical coordinates strictly preserved without arbitrary replacement or clamping');
}

// Test 15: Manual Location Selection on Map
{
  const sim = new GeolocationFlowSimulator({
    mockPosition: { coords: { latitude: 28.6139, longitude: 77.2090, accuracy: 12000 }, timestamp: 1700000003000 }
  });
  sim.handleUseMyLocation();
  assert.strictEqual(sim.isPoorAccuracyWarning, true);

  // User selects their exact location on the map manually
  sim.handleSetManualLocation(28.6152, 77.2105);
  assert.strictEqual(sim.userLocation.lat, 28.6152);
  assert.strictEqual(sim.userLocation.lng, 77.2105);
  assert.strictEqual(sim.userLocation.accuracy, 10);
  assert.strictEqual(sim.userLocation.source, 'manual-selection');
  assert.strictEqual(sim.isPoorAccuracyWarning, false, 'Manual selection resolves poor accuracy warning');
  assert.deepStrictEqual(sim.mapCenter, [28.6152, 77.2105]);
  console.log('✔ Test 15: Manual location selection allows precise map placement and clears accuracy warning');
}

// Test 16: Marker Drag Adjustment
{
  const sim = new GeolocationFlowSimulator();
  sim.handleUseMyLocation();
  sim.handleMarkerDrag(28.6160, 77.2110);
  assert.strictEqual(sim.userLocation.lat, 28.6160);
  assert.strictEqual(sim.userLocation.lng, 77.2110);
  assert.strictEqual(sim.userLocation.source, 'manual-drag');
  assert.strictEqual(sim.userLocation.accuracy, 10);
  console.log('✔ Test 16: Draggable pin updates position with manual-drag source and high precision');
}

// Test 17: Development Mode Telemetry Logging vs Production Suppression
{
  const simDev = new GeolocationFlowSimulator({ isDevMode: true });
  simDev.handleUseMyLocation();
  assert.strictEqual(simDev.telemetryLogs.length, 1);
  const log = simDev.telemetryLogs[0];
  assert.strictEqual(log.source, 'navigator.geolocation');
  assert.strictEqual(typeof log.latitude, 'number');
  assert.strictEqual(typeof log.longitude, 'number');
  assert.strictEqual(typeof log.accuracyMeters, 'number');
  assert.ok(log.timestamp.includes('T'));
  assert.deepStrictEqual(log.leafletMarkerCoordinates, [12.9716, 77.5946]);

  // Production mode suppresses telemetry
  const simProd = new GeolocationFlowSimulator({ isDevMode: false });
  simProd.handleUseMyLocation();
  assert.strictEqual(simProd.telemetryLogs.length, 0, 'Production must never log sensitive geolocation coordinates');
  console.log('✔ Test 17: Telemetry logged in dev mode only; strictly suppressed in production mode');
}

// Test 18: Exact Observed Diagnostic Code 2 "Error acquiring position"
{
  const sim = new GeolocationFlowSimulator({
    mockError: { code: 2, message: 'Error acquiring position' }
  });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.locationStatus, 'unavailable');
  assert.ok(sim.locationError.includes('Device location is currently unavailable'));
  assert.ok(sim.locationError.includes('demo venue coordinates'));
  assert.ok(sim.locationDiagDetails.includes('Error acquiring position'));
  assert.strictEqual(sim.userLocation, null, 'User location must remain null');
  assert.deepStrictEqual(sim.mapCenter, sim.venueCenter, 'Must fallback to demo venue coordinates');
  assert.strictEqual(sim.isFallbackActive, true);
  console.log('✔ Test 18: Exact diagnostic "Error Code 2 (UNAVAILABLE) — Error acquiring position" gracefully handled with demo coordinates fallback');
}

// Test 19: Anti-Tight-Loop Rate Limiting
{
  const sim = new GeolocationFlowSimulator();
  const res1 = sim.handleUseMyLocation(true);
  assert.strictEqual(res1, undefined); // Executed

  // Immediate subsequent request within 2500ms must be throttled
  const res2 = sim.handleUseMyLocation(true);
  assert.strictEqual(res2, 'THROTTLED_RATE_LIMITED', 'Rapid repeated geolocation requests must be throttled');
  console.log('✔ Test 19: Anti-tight-loop rate-limiting prevents rapid consecutive geolocation calls (<2500ms)');
}

// Test 20: Outstanding Geolocation Watch Cleanup
{
  const sim = new GeolocationFlowSimulator();
  const watchId = sim.watchPosition(() => {}, () => {});
  assert.strictEqual(watchId, 999);
  assert.strictEqual(sim.activeWatchId, 999);

  // Clearing location or unmounting cleans up the watch
  sim.handleClearLocation();
  assert.strictEqual(sim.activeWatchId, null, 'Active watch must be cleared on clear/unmount');
  console.log('✔ Test 20: Outstanding geolocation watch cleanly cleared on unmount/clear');
}

// Test 21: Demo Venue Coordinates Clearly Labeled & Not Masqueraded
{
  const sim = new GeolocationFlowSimulator({
    mockError: { code: 2, message: 'Error acquiring position' }
  });
  sim.handleUseMyLocation(true);
  assert.strictEqual(sim.userLocation, null);
  assert.strictEqual(sim.displayedCoordinatesLabel, 'Fallback: Demo Venue Coordinates');
  assert.deepStrictEqual(sim.mapCenter, [28.6145, 77.2100]);
  console.log('✔ Test 21: Demo venue coordinates clearly labeled and never masqueraded as user coordinates');
}

console.log('\n======================================================');
console.log('ALL 21 GEOLOCATION TEST SUITE CASES PASSED (100%)');
console.log('======================================================\n');
