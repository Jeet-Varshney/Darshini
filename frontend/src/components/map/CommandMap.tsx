import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { VenueConfiguration, VenueZone, VenueCameraStation } from '../../types/venue';
import type { ZoneLiveStatus } from '../../types/detection';
import { SchematicMap } from './SchematicMap';
import { MapLegend } from './MapLegend';

interface CommandMapProps {
  venue: VenueConfiguration;
  selectedZone: VenueZone | null;
  onSelectZone: (zone: VenueZone) => void;
  liveZoneStatuses?: Record<string, ZoneLiveStatus>;
  onNavigateToCamera?: (zoneId: string) => void;
}

export type GeolocationSource = 'navigator.geolocation' | 'manual-selection' | 'manual-drag';

interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number;
  source: GeolocationSource;
  timestamp: number;
}

const isManualLocation = (loc: UserLocation | null): boolean => {
  if (!loc) return false;
  return loc.source === 'manual-selection' || loc.source === 'manual-drag';
};

// Threshold (in meters) above which location is classified as coarse / poor accuracy (e.g. IP-based city centroid)
const POOR_ACCURACY_THRESHOLD_METERS = 150;

export const CommandMap: React.FC<CommandMapProps> = ({
  venue,
  selectedZone,
  onSelectZone,
  liveZoneStatuses,
  onNavigateToCamera,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const polygonLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const userLocationLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const [viewMode, setViewMode] = useState<'tiles' | 'schematic'>('tiles');
  const [tileErrorDetected, setTileErrorDetected] = useState<boolean>(false);

  // Milestone 4: Geolocation ("Use My Location") State
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'timeout' | 'insecure' | 'unsupported'
  >('idle');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationDiagDetails, setLocationDiagDetails] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState | null>(null);

  // Milestone 4 & 5: Manual Location Selection & Low Accuracy Warning
  const [isSelectingLocation, setIsSelectingLocation] = useState<boolean>(false);
  const [isPoorAccuracyDismissed, setIsPoorAccuracyDismissed] = useState<boolean>(false);
  const isSelectingLocationRef = useRef<boolean>(false);

  useEffect(() => {
    isSelectingLocationRef.current = isSelectingLocation;
  }, [isSelectingLocation]);

  // Development mode telemetry logging - strictly never expose sensitive location data in production
  const logLocationTelemetry = useCallback(
    (
      source: 'navigator.geolocation' | 'manual-selection' | 'manual-drag',
      lat: number,
      lng: number,
      accuracy: number,
      timestamp: number,
      markerCoords?: [number, number]
    ) => {
      if (import.meta.env?.DEV) {
        console.log('[Darshini Geolocation Telemetry]', {
          source,
          latitude: lat,
          longitude: lng,
          accuracyMeters: Math.round(accuracy * 10) / 10,
          timestamp: new Date(timestamp).toISOString(),
          leafletMarkerCoordinates: markerCoords || [lat, lng],
        });
      }
    },
    []
  );

  // Milestone 4: Selected Camera Station (for details modal / popup card)
  const [selectedCameraStation, setSelectedCameraStation] = useState<VenueCameraStation | null>(null);

  // Monitor network connectivity for automatic offline fallback
  useEffect(() => {
    const handleOnline = () => {
      setTileErrorDetected(false);
    };

    const handleOffline = () => {
      setTileErrorDetected(true);
      setViewMode('schematic');
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setTileErrorDetected(true);
      setViewMode('schematic');
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Query browser permission state if supported
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'permissions' in navigator && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((permissionStatus) => {
          setPermissionState(permissionStatus.state);
          permissionStatus.onchange = () => {
            setPermissionState(permissionStatus.state);
          };
        })
        .catch(() => {
          // Permissions API for geolocation not supported in this browser
        });
    }
  }, []);

  // Handle manual location placement by user (click on map)
  const handleSetManualLocation = useCallback(
    (lat: number, lng: number) => {
      const manualAccuracy = 10;
      const timestamp = Date.now();
      const manualLoc: UserLocation = {
        lat,
        lng,
        accuracy: manualAccuracy,
        source: 'manual-selection',
        timestamp,
      };

      setUserLocation(manualLoc);
      setLocationStatus('active');
      setIsSelectingLocation(false);
      setIsPoorAccuracyDismissed(true);
      setLocationError(null);
      setLocationDiagDetails(`Manually placed pin at [${lat.toFixed(6)}, ${lng.toFixed(6)}]`);

      logLocationTelemetry('manual-selection', lat, lng, manualAccuracy, timestamp, [lat, lng]);

      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo([lat, lng], { animate: true });
      }
    },
    [logLocationTelemetry]
  );

  // Request browser location with explicit user permission, high accuracy enabled, and diagnostic telemetry
  const handleUseMyLocation = useCallback(
    (forceHighAccuracy = true) => {
      // Prevent overlapping requests
      if (locationStatus === 'requesting') {
        return;
      }

      const startTime = performance.now();
      const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';

      // 1. Insecure Context Check: Browsers disallow Geolocation on HTTP unless localhost
      const isSecure = typeof window !== 'undefined' ? window.isSecureContext : true;
      if (!isSecure) {
        setLocationStatus('insecure');
        setLocationError(
          'Location access is blocked because this site is loaded over an unencrypted connection (HTTP). ' +
          'Web browsers strictly require a secure context (HTTPS or http://localhost) to display location permission prompts. ' +
          'When accessing Darshini over LAN or remote IPs, please configure an SSL proxy or connect via localhost.'
        );
        setLocationDiagDetails(`Origin: ${origin} • isSecureContext: false`);
        return;
      }

      // 2. Geolocation API Availability Check
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setLocationStatus('unsupported');
        setLocationError(
          'Browser Geolocation is not supported by your current browser environment or has been disabled in browser preferences.'
        );
        setLocationDiagDetails(`Origin: ${origin} • navigator.geolocation: undefined`);
        return;
      }

      // 3. Permission Previously Denied Check
      if (permissionState === 'denied') {
        setLocationStatus('denied');
        setLocationError(
          'Location permission is currently blocked in your browser settings. The browser will not show a prompt again automatically. ' +
          'Please click the lock or site settings icon in your browser address bar, set Location to "Allow" or "Ask", and click "Use My Location" again.'
        );
        setLocationDiagDetails(`Origin: ${origin} • PermissionState: denied`);
        return;
      }

      setLocationStatus('requesting');
      setLocationError(null);
      setLocationDiagDetails(null);
      setIsSelectingLocation(false);

      // Switch to Leaflet tiles view so location pin and map are immediately visible
      if (viewMode === 'schematic') {
        setViewMode('tiles');
      }

      // High-accuracy enabled by default with maximumAge: 0 to avoid returning stale cached coordinates.
      // Timeout is set to 15s to allow sufficient time for GPS/Wi-Fi positioning queries.
      const geoOptions: PositionOptions = {
        enableHighAccuracy: forceHighAccuracy,
        timeout: 15000,
        maximumAge: 0,
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const elapsed = Math.round(performance.now() - startTime);
          const { latitude, longitude, accuracy } = position.coords;
          const timestamp = position.timestamp || Date.now();

          // Strict coordinate validation
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
            setLocationStatus('unavailable');
            setLocationError('Received invalid coordinates from the browser location provider.');
            setLocationDiagDetails(`Invalid coordinates received after ${elapsed}ms`);
            return;
          }

          const validAccuracy = typeof accuracy === 'number' && isFinite(accuracy) ? accuracy : 1000;
          const loc: UserLocation = {
            lat: latitude,
            lng: longitude,
            accuracy: validAccuracy,
            source: 'navigator.geolocation',
            timestamp,
          };

          // Never silently replace coordinates with an arbitrary location!
          setUserLocation(loc);
          setLocationStatus('active');
          setLocationError(null);
          setIsPoorAccuracyDismissed(false);
          setLocationDiagDetails(
            `Resolved in ${elapsed}ms (accuracy: ±${Math.round(loc.accuracy)}m, mode: ${
              forceHighAccuracy ? 'High-Accuracy/GPS' : 'Standard/Network'
            })`
          );

          // Development-only telemetry logging
          logLocationTelemetry('navigator.geolocation', loc.lat, loc.lng, loc.accuracy, timestamp, [loc.lat, loc.lng]);

          if (mapInstanceRef.current) {
            // If accuracy is poor (e.g. >150m, typical of city-level IP geolocation without hardware GPS),
            // fit map bounds to the accuracy circle so the user sees the real uncertainty area
            // rather than falsely zooming deep into a single rooftop.
            if (loc.accuracy > POOR_ACCURACY_THRESHOLD_METERS) {
              const circle = L.circle([latitude, longitude], { radius: loc.accuracy });
              mapInstanceRef.current.fitBounds(circle.getBounds(), {
                maxZoom: 16,
                padding: [30, 30],
                animate: true,
              });
            } else {
              mapInstanceRef.current.flyTo([latitude, longitude], 16, {
                animate: true,
                duration: 1.2,
              });
            }
          }
        },
        (error) => {
          const elapsed = Math.round(performance.now() - startTime);
          let msg = 'Failed to obtain current location.';
          let status: 'denied' | 'unavailable' | 'timeout' = 'unavailable';

          switch (error.code) {
            case 1: // PERMISSION_DENIED
              status = 'denied';
              msg =
                'Location permission was denied. If no prompt appeared, your browser has blocked location access for this address. ' +
                'Click the lock or site settings icon in your browser address bar to allow location access and try again.';
              break;
            case 2: // POSITION_UNAVAILABLE
              status = 'unavailable';
              msg =
                'Unable to determine your location. The browser could not obtain coordinates from the available positioning providers. ' +
                'On desktop Linux systems without dedicated GPS hardware, browsers rely on external network positioning services which may be unconfigured, restricted by network firewall/VPN, or unavailable.';
              break;
            case 3: // TIMEOUT
              status = 'timeout';
              msg =
                'The request to get your location timed out. Please check your network connection or signal and try again.';
              break;
            default:
              msg = error.message || 'An unknown error occurred while retrieving device location.';
              break;
          }

          setLocationStatus(status);
          setLocationError(msg);
          setLocationDiagDetails(
            `Error Code ${error.code} (${status.toUpperCase()}) • Elapsed: ${elapsed}ms • Provider: ${
              error.message || 'No additional message'
            }`
          );
        },
        geoOptions
      );
    },
    [locationStatus, permissionState, viewMode, logLocationTelemetry]
  );

  // Recenter map back to configured venue
  const handleRecenterVenue = useCallback(() => {
    if (mapInstanceRef.current && viewMode === 'tiles') {
      mapInstanceRef.current.flyTo(venue.center, venue.defaultZoom, {
        animate: true,
        duration: 1.0,
      });
    }
  }, [venue, viewMode]);

  // Dismiss location error
  const handleDismissLocationError = () => {
    setLocationError(null);
    setLocationDiagDetails(null);
    setLocationStatus('idle');
  };

  // Clear live user location
  const handleClearLocation = () => {
    setUserLocation(null);
    setLocationStatus('idle');
    setLocationError(null);
    setLocationDiagDetails(null);
    setIsSelectingLocation(false);
    setIsPoorAccuracyDismissed(false);
    handleRecenterVenue();
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (viewMode !== 'tiles' || !mapContainerRef.current) {
      return;
    }

    // Clean up any existing map instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      center: venue.center,
      zoom: venue.defaultZoom,
      zoomControl: true,
      attributionControl: true,
    });

    mapInstanceRef.current = map;

    // Use OpenStreetMap Carto Light tiles
    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors | Fictional Venue Overlay',
    });

    let errorCount = 0;
    tileLayer.on('tileerror', () => {
      errorCount++;
      if (errorCount >= 2) {
        setTileErrorDetected(true);
      }
    });

    tileLayer.addTo(map);

    // Create Layer Groups
    const polygonsGroup = L.layerGroup().addTo(map);
    const markersGroup = L.layerGroup().addTo(map);
    const userLocationGroup = L.layerGroup().addTo(map);

    polygonLayerGroupRef.current = polygonsGroup;
    markersLayerGroupRef.current = markersGroup;
    userLocationLayerGroupRef.current = userLocationGroup;

    // Render Road Connections
    venue.roads.forEach((road) => {
      const isEmergency = road.type === 'EMERGENCY_CORRIDOR';
      L.polyline(road.polyline, {
        color: isEmergency ? '#365F8D' : '#7A8B9E',
        weight: isEmergency ? 4 : 5,
        dashArray: isEmergency ? '6, 6' : undefined,
        opacity: 0.8,
      }).addTo(markersGroup);
    });

    // Render Gates as circular marker pins
    venue.gates.forEach((gate) => {
      const isGateOpen = gate.status === 'OPEN';
      const gateIcon = L.divIcon({
        className: 'custom-gate-pin',
        html: `
          <div style="
            background-color: ${isGateOpen ? '#237A57' : '#A15C00'};
            color: #FFFFFF;
            font-family: var(--font-mono, monospace);
            font-size: 10px;
            font-weight: 700;
            padding: 3px 6px;
            border-radius: 4px;
            border: 2px solid #FFFFFF;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            white-space: nowrap;
          ">
            ${gate.code}
          </div>
        `,
        iconSize: [44, 22],
        iconAnchor: [22, 11],
      });

      const gateMarker = L.marker(gate.coordinates, { icon: gateIcon })
        .bindPopup(`<strong>${gate.name}</strong><br>Status: ${gate.status}<br>Capacity: ${gate.capacityPerHour}/hr`)
        .addTo(markersGroup);

      gateMarker.on('click', (e: L.LeafletMouseEvent) => {
        if (isSelectingLocationRef.current) {
          handleSetManualLocation(e.latlng.lat, e.latlng.lng);
        }
      });
    });

    // Manual click-to-place location pin on Leaflet map
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (isSelectingLocationRef.current) {
        handleSetManualLocation(e.latlng.lat, e.latlng.lng);
      }
    });

    // Invalidate size on mount
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [viewMode, venue, handleSetManualLocation]);

  // Milestone 4: Render User Location Marker & Accuracy Ring on Map
  useEffect(() => {
    if (viewMode !== 'tiles' || !userLocationLayerGroupRef.current) {
      return;
    }

    const group = userLocationLayerGroupRef.current;
    group.clearLayers();

    if (!userLocation) {
      return;
    }

    const { lat, lng, accuracy, source, timestamp } = userLocation;
    const isManual = isManualLocation(userLocation);
    const isPoor = accuracy > POOR_ACCURACY_THRESHOLD_METERS && !isManual;

    // Accuracy Circle - visually amber if poor/coarse accuracy, blue if accurate or manual
    L.circle([lat, lng], {
      radius: Math.max(accuracy, 15),
      color: isPoor ? '#A15C00' : '#0284C7',
      weight: 1.5,
      dashArray: '4, 4',
      fillColor: isPoor ? '#FEF0C7' : '#38BDF8',
      fillOpacity: isPoor ? 0.2 : 0.15,
    }).addTo(group);

    // GPS Pin - Draggable so the user can easily fine-tune their location
    const gpsIcon = L.divIcon({
      className: 'custom-user-gps-pin',
      html: `
        <div class="user-gps-marker" title="${isManual ? 'Custom Location Pin (Draggable)' : 'Your Current Location (Draggable)'}">
          <div class="user-gps-pulse" style="${isPoor ? 'background: rgba(245, 158, 11, 0.4);' : ''}"></div>
          <div class="user-gps-dot" style="${isPoor ? 'background-color: #D97706; box-shadow: 0 0 6px rgba(217, 119, 6, 0.8);' : ''}">📍</div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const marker = L.marker([lat, lng], { icon: gpsIcon, draggable: true }).addTo(group);

    marker.on('dragend', () => {
      const newPos = marker.getLatLng();
      const manualAccuracy = 10;
      const updatedTimestamp = Date.now();
      setUserLocation({
        lat: newPos.lat,
        lng: newPos.lng,
        accuracy: manualAccuracy,
        source: 'manual-drag',
        timestamp: updatedTimestamp,
      });
      setIsPoorAccuracyDismissed(true);
      setLocationDiagDetails(`Pin dragged to [${newPos.lat.toFixed(6)}, ${newPos.lng.toFixed(6)}]`);
      logLocationTelemetry('manual-drag', newPos.lat, newPos.lng, manualAccuracy, updatedTimestamp, [newPos.lat, newPos.lng]);
    });

    // Development logging for final marker coordinates
    logLocationTelemetry(source, lat, lng, accuracy, timestamp, [lat, lng]);

    const popupHtml = `
      <div style="font-family: var(--font-sans); font-size: 11px; color: #172B43; min-width: 190px;">
        <div style="font-weight: 700; margin-bottom: 4px; color: ${isPoor ? '#A15C00' : '#0284C7'};">
          ${isManual ? '📍 Manually Placed Location' : isPoor ? '⚠️ Approximate Location (Low Accuracy)' : '📍 Your Current Location'}
        </div>
        <div>
          ${isManual ? 'Custom position placed on map' : isPoor ? 'City/network estimate (±' + Math.round(accuracy) + 'm uncertainty)' : 'Verified device position (±' + Math.round(accuracy) + 'm accuracy)'}
        </div>
        <div style="font-size: 10px; color: #64748B; margin-top: 5px; line-height: 1.35; font-style: italic;">
          ${isManual ? 'Drag marker to refine exact position.' : isPoor ? 'Network/IP positioning detected. You can drag this pin or click "Set Location Manually".' : 'Verified browser coordinates. Venue site remains configured.'}
        </div>
      </div>
    `;

    marker.bindPopup(popupHtml).openPopup();
  }, [viewMode, userLocation, logLocationTelemetry]);

  // Milestone 4: Update Zone Polygons AND Configured Camera Station Pins
  useEffect(() => {
    if (viewMode !== 'tiles' || !mapInstanceRef.current || !polygonLayerGroupRef.current) {
      return;
    }

    const group = polygonLayerGroupRef.current;
    group.clearLayers();

    // 1. Render Venue Zone Polygons
    venue.zones.forEach((zone) => {
      const isSelected = selectedZone?.id === zone.id;
      const liveStatus = liveZoneStatuses?.[zone.id];
      const isLive = liveStatus?.camera_assigned && liveStatus.status === 'STREAMING';

      let color = '#237A57'; // Positive
      let fillColor = '#D1FADF';

      if (zone.status === 'CRITICAL') {
        color = '#B42318';
        fillColor = '#FEE4E2';
      } else if (zone.status === 'WARNING') {
        color = '#A15C00';
        fillColor = '#FEF0C7';
      }

      if (isSelected) {
        color = '#365F8D';
        fillColor = '#E0EDFA';
      }

      const polygon = L.polygon(zone.coordinates, {
        color: isLive ? '#059669' : color,
        weight: isSelected ? 3.5 : isLive ? 3 : 2,
        fillColor: isLive ? '#D1FAE5' : fillColor,
        fillOpacity: isSelected ? 0.6 : 0.45,
        dashArray: isSelected ? undefined : '4, 4',
      });

      const tooltipContent = isLive
        ? `<strong>${zone.code}: ${zone.name}</strong><br/>
           <span style="color:#059669; font-weight:700;">📷 LIVE CAMERA: ${liveStatus.instantaneous_count} pax</span><br/>
           Observed Density: ${(liveStatus.density_per_sqm || 0).toFixed(4)} pax/m²<br/>
           Camera: ${liveStatus.camera_name || 'Camera'}<br/>
           <em>Last Inference: ${liveStatus.last_inference_time ? liveStatus.last_inference_time.substring(11, 19) + ' UTC' : 'Active'}</em>`
        : `<strong>${zone.code}: ${zone.name}</strong><br/>
           Density: ${zone.densityPerSqm} p/m² (LoS ${zone.fruinLoS})<br/>
           Simulated Baseline: ${zone.simulatedCount} pax<br/>
           <em>Status: ${zone.status} (Simulated Fixture)</em>`;

      polygon.bindTooltip(tooltipContent, {
        sticky: true,
        className: 'custom-map-popup',
      });

      polygon.on('click', (e: L.LeafletMouseEvent) => {
        if (isSelectingLocationRef.current) {
          handleSetManualLocation(e.latlng.lat, e.latlng.lng);
          return;
        }
        onSelectZone(zone);
      });

      polygon.addTo(group);
    });

    // 2. Milestone 4: Render Interactive Venue Camera Stations (CAM-01 to CAM-05)
    (venue.cameras || []).forEach((station) => {
      const assignedZone = venue.zones.find((z) => z.id === station.assignedZoneId);
      const liveStatus = liveZoneStatuses?.[station.assignedZoneId];
      const isStreaming = liveStatus?.camera_assigned && liveStatus.status === 'STREAMING';
      const isStale = liveStatus?.status === 'STALE';

      const statusClass = isStreaming
        ? 'camera-pin-streaming'
        : isStale
        ? 'camera-pin-stale'
        : 'camera-pin-disconnected';

      const statusLabel = isStreaming
        ? `LIVE (${liveStatus.instantaneous_count} pax)`
        : isStale
        ? 'STALE'
        : 'DISCONNECTED';

      const camIcon = L.divIcon({
        className: 'custom-camera-station-pin',
        html: `
          <div class="camera-pin-container ${statusClass}">
            <span class="camera-pin-dot"></span>
            <span>📹 ${station.code}</span>
          </div>
        `,
        iconSize: [80, 24],
        iconAnchor: [40, 12],
      });

      const marker = L.marker(station.coordinates, { icon: camIcon });

      // Click opens camera details popover card with direct action
      marker.on('click', (e: L.LeafletMouseEvent) => {
        if (isSelectingLocationRef.current) {
          handleSetManualLocation(e.latlng.lat, e.latlng.lng);
          return;
        }
        setSelectedCameraStation(station);
        if (assignedZone) {
          onSelectZone(assignedZone);
        }
      });

      // Tooltip for quick hover context
      marker.bindTooltip(
        `<strong>${station.code}: ${station.name}</strong><br/>
         Assigned: ${assignedZone?.code} ${assignedZone?.name}<br/>
         Status: ${statusLabel}<br/>
         <em>Click for Camera Operations & Detection view</em>`,
        { direction: 'top', offset: [0, -10] }
      );

      marker.addTo(group);
    });
  }, [viewMode, venue, selectedZone, onSelectZone, liveZoneStatuses, handleSetManualLocation]);

  return (
    <div className="command-map-container" role="region" aria-label="Command Center Venue Map">
      {/* Top Map Toolbar */}
      <div className="map-toolbar">
        <div className="map-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span className="map-toolbar-label">
            MAP VIEWPORT:
          </span>
          <div className="map-view-toggle" role="group" aria-label="Map Display Mode">
            <button
              type="button"
              className={`toggle-button ${viewMode === 'tiles' ? 'active' : ''}`}
              onClick={() => setViewMode('tiles')}
              aria-pressed={viewMode === 'tiles'}
            >
              Street Map (Leaflet)
            </button>
            <button
              type="button"
              className={`toggle-button ${viewMode === 'schematic' ? 'active' : ''}`}
              onClick={() => setViewMode('schematic')}
              aria-pressed={viewMode === 'schematic'}
            >
              Vector Schematic (Fallback)
            </button>
          </div>

          {/* Milestone 4: Use My Location Control */}
          <button
            id="btn-use-my-location"
            type="button"
            className={`btn-location-toggle ${locationStatus === 'active' ? 'active' : ''} ${locationStatus === 'requesting' ? 'loading' : ''}`}
            onClick={() => handleUseMyLocation(true)}
            disabled={locationStatus === 'requesting'}
            title={
              locationStatus === 'active'
                ? 'Your location is active on the map. Click to re-center.'
                : locationStatus === 'insecure'
                ? 'Geolocation requires HTTPS or localhost'
                : 'Center the map on your device location with browser permission'
            }
            aria-live="polite"
          >
            <span className={locationStatus === 'requesting' ? 'spin-icon' : ''}>
              {locationStatus === 'requesting' ? '⏳' : '📍'}
            </span>
            <span>
              {locationStatus === 'requesting'
                ? 'Finding your location…'
                : locationStatus === 'active'
                ? 'Current location found'
                : locationStatus === 'denied'
                ? 'Location permission blocked'
                : locationStatus === 'unavailable'
                ? 'Location unavailable'
                : locationStatus === 'timeout'
                ? 'Location request timed out'
                : 'Use My Location'}
            </span>
          </button>
        </div>

        <div className="map-toolbar-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {tileErrorDetected && viewMode === 'tiles' && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--status-warning)',
                fontWeight: 600,
                backgroundColor: 'var(--status-warning-bg)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-badge)',
                border: '1px solid var(--status-warning-border)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span>⚠️ Tile latency/error detected.</span>
              <button
                type="button"
                onClick={() => setViewMode('schematic')}
                style={{
                  textDecoration: 'underline',
                  fontWeight: 700,
                  color: 'var(--status-warning)',
                  cursor: 'pointer',
                }}
              >
                Use Schematic
              </button>
            </span>
          )}
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {venue.name}
          </span>
        </div>
      </div>

      {/* Manual Pin Placement Mode Prompt */}
      {isSelectingLocation && (
        <div className="map-location-select-banner" role="status">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px' }}>📍</span>
            <span style={{ fontWeight: 600 }}>
              Click anywhere on the map to place your location pin. You can also drag the pin after placing.
            </span>
          </div>
          <button
            type="button"
            className="btn-location-action"
            onClick={() => setIsSelectingLocation(false)}
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            ✕ Cancel Selection
          </button>
        </div>
      )}

      {/* Low Geolocation Accuracy Warning Banner */}
      {locationStatus === 'active' &&
        userLocation &&
        !isManualLocation(userLocation) &&
        userLocation.accuracy > POOR_ACCURACY_THRESHOLD_METERS &&
        !isPoorAccuracyDismissed && (
          <div className="map-location-accuracy-warning-banner" role="alert">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: 1 }}>
              <span style={{ fontSize: '15px', flexShrink: 0, marginTop: '1px' }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--status-warning, #A15C00)' }}>
                  Low Geolocation Accuracy (±{Math.round(userLocation.accuracy)}m uncertainty)
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.35 }}>
                  Your browser provided an approximate city/network location rather than precise GPS coordinates.
                  The pin on the map may not match your exact physical location.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-location-action"
                onClick={() => handleUseMyLocation(true)}
                title="Retry high-accuracy GPS/Wi-Fi positioning"
              >
                🔄 Retry
              </button>
              <button
                type="button"
                className="btn-location-action btn-location-action-primary"
                onClick={() => setIsSelectingLocation(true)}
                title="Click anywhere on the map to set your location pin"
              >
                📍 Set Location Manually
              </button>
              <button
                type="button"
                onClick={() => setIsPoorAccuracyDismissed(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px 6px',
                  fontSize: '12px',
                }}
                title="Dismiss accuracy warning"
                aria-label="Dismiss accuracy warning"
              >
                ✕
              </button>
            </div>
          </div>
        )}

      {/* Milestone 4: Active Geolocation Status Sub-Bar */}
      {locationStatus === 'active' && userLocation && (
        <div className="map-location-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span
              style={{
                color:
                  userLocation.accuracy > POOR_ACCURACY_THRESHOLD_METERS && !isManualLocation(userLocation)
                    ? 'var(--status-warning, #A15C00)'
                    : '#0284C7',
                fontWeight: 700,
              }}
            >
              {isManualLocation(userLocation)
                ? '📍 MANUAL PIN:'
                : userLocation.accuracy > POOR_ACCURACY_THRESHOLD_METERS
                ? '⚠️ APPROXIMATE LOCATION:'
                : '📍 LIVE LOCATION:'}
            </span>
            <span>
              {isManualLocation(userLocation)
                ? `Custom map position (±${Math.round(userLocation.accuracy)}m)`
                : `Device Position (±${Math.round(userLocation.accuracy)}m uncertainty)`}
            </span>
            {!isManualLocation(userLocation) && userLocation.accuracy > POOR_ACCURACY_THRESHOLD_METERS && (
              <span
                style={{
                  backgroundColor: 'var(--status-warning-bg, #FEF0C7)',
                  color: 'var(--status-warning, #A15C00)',
                  border: '1px solid var(--status-warning-border, #FEDF89)',
                  padding: '1px 6px',
                  borderRadius: '3px',
                  fontSize: '10px',
                  fontWeight: 600,
                }}
              >
                Low Accuracy
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn-location-action"
              onClick={() => setIsSelectingLocation(true)}
              title="Click on the map or drag the pin to adjust your position"
            >
              📍 {isManualLocation(userLocation) ? 'Reposition Pin' : 'Adjust Pin Manually'}
            </button>
            <button
              type="button"
              className="btn-location-action"
              onClick={handleRecenterVenue}
              title="Center view back on the configured venue"
            >
              🏛️ Return to Venue Operations
            </button>
            <button
              type="button"
              onClick={handleClearLocation}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '11px',
                cursor: 'pointer',
                padding: '2px 4px',
              }}
              title="Stop tracking user location"
            >
              ✕ Clear
            </button>
          </div>
        </div>
      )}

      {/* Geolocation Error / Denial / Insecure / Unavailable Banner */}
      {locationError && (
        <div className="map-location-error-banner" role="alert">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ fontSize: '14px', flexShrink: 0 }}>⚠️</span>
              <span style={{ fontSize: '12px', lineHeight: 1.4 }}>{locationError}</span>
            </div>
            {locationDiagDetails && (
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  paddingLeft: '22px',
                  wordBreak: 'break-word',
                }}
              >
                Diagnostic: {locationDiagDetails}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap' }}>
            {locationStatus !== 'insecure' && locationStatus !== 'unsupported' && (
              <>
                <button
                  type="button"
                  className="btn-location-action"
                  onClick={() => handleUseMyLocation(true)}
                  style={{ borderColor: 'var(--status-warning)', color: 'var(--status-warning)' }}
                  title="Retry geolocation"
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="btn-location-action"
                  onClick={() => setIsSelectingLocation(true)}
                  style={{
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-secondary)',
                    fontSize: '10px',
                  }}
                  title="Set location manually on map"
                >
                  📍 Set Pin Manually
                </button>
              </>
            )}
            <button
              type="button"
              className="btn-location-action"
              onClick={handleRecenterVenue}
              style={{
                borderColor: 'var(--border-default)',
                color: 'var(--text-secondary)',
                fontSize: '10px',
              }}
              title="Center map on configured venue"
            >
              🏛️ Venue Map
            </button>
            <button
              type="button"
              onClick={handleDismissLocationError}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: '12px',
              }}
              title="Dismiss error notice"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Map Body: Either Leaflet or SVG Schematic */}
      {viewMode === 'tiles' ? (
        <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: '480px' }}>
          <div
            ref={mapContainerRef}
            className={`map-leaflet-view ${isSelectingLocation ? 'manual-pin-cursor' : ''}`}
            style={{ width: '100%', height: '100%' }}
          />
          <MapLegend />

          {/* Selected Camera Station Floating Details Card */}
          {selectedCameraStation && (
            <div
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                width: '280px',
                backgroundColor: 'rgba(255, 255, 255, 0.96)',
                backdropFilter: 'blur(8px)',
                borderRadius: 'var(--radius-panel, 8px)',
                border: '1px solid var(--border-default)',
                boxShadow: '0 8px 24px rgba(23, 43, 67, 0.2)',
                zIndex: 1000,
                padding: '12px',
              }}
            >
              <div className="cam-popup-title">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="cam-popup-code">{selectedCameraStation.code}</span>
                  <span className="cam-popup-name">{selectedCameraStation.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCameraStation(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: 'var(--text-muted)',
                  }}
                  aria-label="Close camera details"
                >
                  ✕
                </button>
              </div>

              <div className="cam-popup-body">
                <div className="cam-popup-row">
                  <span className="cam-popup-label">Marker Type:</span>
                  <span className="cam-popup-val">Configured Station (Fixed)</span>
                </div>
                <div className="cam-popup-row">
                  <span className="cam-popup-label">Assigned Zone:</span>
                  <span className="cam-popup-val font-mono">
                    {venue.zones.find((z) => z.id === selectedCameraStation.assignedZoneId)?.name ||
                      selectedCameraStation.assignedZoneId}
                  </span>
                </div>
                <div className="cam-popup-row">
                  <span className="cam-popup-label">Operational Status:</span>
                  <span
                    className="cam-popup-val font-mono"
                    style={{
                      color:
                        liveZoneStatuses?.[selectedCameraStation.assignedZoneId]?.status === 'STREAMING'
                          ? 'var(--status-positive)'
                          : liveZoneStatuses?.[selectedCameraStation.assignedZoneId]?.status === 'STALE'
                          ? 'var(--status-warning)'
                          : 'var(--text-muted)',
                    }}
                  >
                    {liveZoneStatuses?.[selectedCameraStation.assignedZoneId]?.status || 'DISCONNECTED'}
                  </span>
                </div>

                {liveZoneStatuses?.[selectedCameraStation.assignedZoneId]?.instantaneous_count !== null &&
                  liveZoneStatuses?.[selectedCameraStation.assignedZoneId]?.instantaneous_count !== undefined && (
                    <div className="cam-popup-row">
                      <span className="cam-popup-label">Instantaneous FOV:</span>
                      <span className="cam-popup-val font-mono" style={{ color: 'var(--status-positive)' }}>
                        {liveZoneStatuses[selectedCameraStation.assignedZoneId].instantaneous_count} pax
                      </span>
                    </div>
                  )}

                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '4px' }}>
                  Location: Configured demo station inside venue. Not a personal GPS coordinate.
                </div>
              </div>

              {onNavigateToCamera && (
                <button
                  type="button"
                  className="cam-popup-action-btn"
                  onClick={() => {
                    onNavigateToCamera(selectedCameraStation.assignedZoneId);
                  }}
                >
                  <span>📹 Open in Camera & Detection</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <SchematicMap
          venue={venue}
          selectedZoneId={selectedZone?.id ?? null}
          onSelectZone={onSelectZone}
          isFallbackActive={tileErrorDetected}
          liveZoneStatuses={liveZoneStatuses}
          onNavigateToCamera={onNavigateToCamera}
        />
      )}
    </div>
  );
};
