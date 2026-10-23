import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { VenueConfiguration, VenueZone } from '../../types/venue';
import { SchematicMap } from './SchematicMap';
import { MapLegend } from './MapLegend';

interface CommandMapProps {
  venue: VenueConfiguration;
  selectedZone: VenueZone | null;
  onSelectZone: (zone: VenueZone) => void;
}

export const CommandMap: React.FC<CommandMapProps> = ({
  venue,
  selectedZone,
  onSelectZone
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const polygonLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const [viewMode, setViewMode] = useState<'tiles' | 'schematic'>('tiles');
  const [tileErrorDetected, setTileErrorDetected] = useState<boolean>(false);

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
      attributionControl: true
    });

    mapInstanceRef.current = map;

    // Use OpenStreetMap Carto Light tiles
    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors | Fictional Venue Overlay'
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
    polygonLayerGroupRef.current = polygonsGroup;
    markersLayerGroupRef.current = markersGroup;

    // Render Road Connections
    venue.roads.forEach((road) => {
      const isEmergency = road.type === 'EMERGENCY_CORRIDOR';
      L.polyline(road.polyline, {
        color: isEmergency ? '#365F8D' : '#7A8B9E',
        weight: isEmergency ? 4 : 5,
        dashArray: isEmergency ? '6, 6' : undefined,
        opacity: 0.8
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
        iconAnchor: [22, 11]
      });

      L.marker(gate.coordinates, { icon: gateIcon })
        .bindPopup(`<strong>${gate.name}</strong><br>Status: ${gate.status}<br>Capacity: ${gate.capacityPerHour}/hr`)
        .addTo(markersGroup);
    });

    // Invalidate size on mount
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [viewMode, venue]);

  // Update Zone Polygons when selectedZone or venue changes
  useEffect(() => {
    if (viewMode !== 'tiles' || !mapInstanceRef.current || !polygonLayerGroupRef.current) {
      return;
    }

    const group = polygonLayerGroupRef.current;
    group.clearLayers();

    venue.zones.forEach((zone) => {
      const isSelected = selectedZone?.id === zone.id;

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
        color: color,
        weight: isSelected ? 3.5 : 2,
        fillColor: fillColor,
        fillOpacity: isSelected ? 0.6 : 0.45,
        dashArray: isSelected ? undefined : '4, 4'
      });

      polygon.bindTooltip(
        `<strong>${zone.code}: ${zone.name}</strong><br/>
         Density: ${zone.densityPerSqm} p/m² (LoS ${zone.fruinLoS})<br/>
         <em>Status: ${zone.status} (Simulated)</em>`,
        { sticky: true, className: 'custom-map-popup' }
      );

      polygon.on('click', () => {
        onSelectZone(zone);
      });

      polygon.addTo(group);
    });
  }, [viewMode, venue, selectedZone, onSelectZone]);

  return (
    <div className="command-map-container" role="region" aria-label="Command Center Venue Map">
      {/* Top Map Toolbar */}
      <div className="map-toolbar">
        <div className="map-toolbar-left">
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
        </div>

        <div className="map-toolbar-right">
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
                gap: '4px'
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
                  cursor: 'pointer'
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

      {/* Main Map Body: Either Leaflet or SVG Schematic */}
      {viewMode === 'tiles' ? (
        <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: '480px' }}>
          <div
            ref={mapContainerRef}
            className="map-leaflet-view"
            style={{ width: '100%', height: '100%' }}
          />
          <MapLegend />
        </div>
      ) : (
        <SchematicMap
          venue={venue}
          selectedZoneId={selectedZone?.id ?? null}
          onSelectZone={onSelectZone}
          isFallbackActive={tileErrorDetected}
        />
      )}
    </div>
  );
};
