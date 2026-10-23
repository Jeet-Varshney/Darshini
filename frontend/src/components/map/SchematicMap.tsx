import React from 'react';
import type { VenueConfiguration, VenueZone } from '../../types/venue';
import type { ZoneLiveStatus } from '../../types/detection';

interface SchematicMapProps {
  venue: VenueConfiguration;
  selectedZoneId: string | null;
  onSelectZone: (zone: VenueZone) => void;
  isFallbackActive?: boolean;
  liveZoneStatuses?: Record<string, ZoneLiveStatus>;
  onNavigateToCamera?: (zoneId: string) => void;
}

export const SchematicMap: React.FC<SchematicMapProps> = ({
  venue,
  selectedZoneId,
  onSelectZone,
  isFallbackActive = false,
  liveZoneStatuses,
  onNavigateToCamera,
}) => {
  const getZoneFill = (zone: VenueZone, isSelected: boolean, isLive: boolean) => {
    if (isSelected) {
      return '#E0EDFA'; // Light steel blue highlight
    }
    if (isLive) {
      return '#D1FAE5'; // Soft emerald green for live active camera
    }
    switch (zone.status) {
      case 'CRITICAL':
        return '#FEE4E2'; // Soft critical red
      case 'WARNING':
        return '#FEF0C7'; // Soft warning amber
      case 'NORMAL':
      default:
        return '#D1FADF'; // Soft positive green
    }
  };

  const getZoneStroke = (zone: VenueZone, isSelected: boolean, isLive: boolean) => {
    if (isSelected) {
      return '#365F8D';
    }
    if (isLive) {
      return '#059669'; // Emerald border
    }
    switch (zone.status) {
      case 'CRITICAL':
        return '#B42318';
      case 'WARNING':
        return '#A15C00';
      case 'NORMAL':
      default:
        return '#237A57';
    }
  };

  return (
    <div className="schematic-wrapper">
      <div className="schematic-notice-banner">
        <span className="schematic-notice-text">
          <strong>{isFallbackActive ? '⚠️ TILE NETWORK UNAVAILABLE —' : 'ℹ️'} LOCAL SCHEMATIC MAP:</strong> Rendering deterministic vector blueprint of {venue.name}.
        </span>
        <span className="schematic-resilient-badge">
          OFFLINE RESILIENT MODE
        </span>
      </div>

      <div className="schematic-svg-container">
        <svg
          viewBox="0 0 900 520"
          className="schematic-svg"
          aria-label="Schematic Vector Map of Darshini Precinct"
        >
          {/* Subtle Grid Background */}
          <defs>
            <pattern id="schematic-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E6ECF2" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="900" height="520" fill="url(#schematic-grid)" rx="8" />

          {/* Road Network Connections */}
          <g className="roads-layer" aria-label="Road Connections">
            {/* North Ring */}
            <line x1="40" y1="20" x2="840" y2="20" className="svg-road" />
            <text x="440" y="14" textAnchor="middle" className="svg-label" style={{ fontSize: '10px', fill: '#526174' }}>
              North Perimeter Boulevard (Cleared)
            </text>

            {/* East Arterial */}
            <line x1="840" y1="20" x2="840" y2="480" className="svg-road" stroke="#FEDF89" />
            <text x="855" y="250" textAnchor="middle" transform="rotate(90, 855, 250)" className="svg-label" style={{ fontSize: '10px', fill: '#A15C00' }}>
              East Exhibition Link (Congested)
            </text>

            {/* South Terminal Way */}
            <line x1="840" y1="480" x2="40" y2="480" className="svg-road" />
            <text x="440" y="496" textAnchor="middle" className="svg-label" style={{ fontSize: '10px', fill: '#526174' }}>
              South Terminal Way (Cleared)
            </text>

            {/* West Emergency Lane */}
            <line x1="40" y1="480" x2="40" y2="20" className="svg-road" stroke="#365F8D" strokeDasharray="6 4" />
            <text x="25" y="250" textAnchor="middle" transform="rotate(-90, 25, 250)" className="svg-label" style={{ fontSize: '10px', fill: '#365F8D', fontWeight: 'bold' }}>
              West Emergency Corridor (First Responders Only)
            </text>
          </g>

          {/* Fictional Venue Zones */}
          <g className="zones-layer" aria-label="Venue Zones">
            {venue.zones.map((zone) => {
              const isSelected = selectedZoneId === zone.id;
              const liveStatus = liveZoneStatuses?.[zone.id];
              const isLive = liveStatus?.camera_assigned && liveStatus.status === 'STREAMING';
              const fill = getZoneFill(zone, isSelected, isLive);
              const stroke = getZoneStroke(zone, isSelected, isLive);

              return (
                <g
                  key={zone.id}
                  className={`svg-zone ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectZone(zone)}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`${zone.name}, status ${zone.status}, density ${zone.densityPerSqm} persons per square meter`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectZone(zone);
                    }
                  }}
                >
                  <rect
                    x={zone.svgRect.x}
                    y={zone.svgRect.y}
                    width={zone.svgRect.width}
                    height={zone.svgRect.height}
                    rx="8"
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isSelected ? 3.5 : 2}
                  />

                  {/* Zone Header / Code Badge */}
                  <rect
                    x={zone.svgRect.x + 8}
                    y={zone.svgRect.y + 8}
                    width="44"
                    height="18"
                    rx="4"
                    fill={stroke}
                  />
                  <text
                    x={zone.svgRect.x + 30}
                    y={zone.svgRect.y + 21}
                    textAnchor="middle"
                    fill="#FFFFFF"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700 }}
                  >
                    {zone.code}
                  </text>

                  {/* Live Camera Badge if streaming */}
                  {isLive && (
                    <>
                      <rect
                        x={zone.svgRect.x + zone.svgRect.width - 98}
                        y={zone.svgRect.y + 8}
                        width="90"
                        height="18"
                        rx="4"
                        fill="#065F46"
                      />
                      <text
                        x={zone.svgRect.x + zone.svgRect.width - 53}
                        y={zone.svgRect.y + 20}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700 }}
                      >
                        📷 {liveStatus.instantaneous_count} LIVE PAX
                      </text>
                    </>
                  )}

                  {/* Zone Name */}
                  <text
                    x={zone.svgRect.labelX}
                    y={zone.svgRect.labelY - 14}
                    textAnchor="middle"
                    className="svg-label"
                  >
                    {zone.name}
                  </text>

                  {/* Density & LoS readout */}
                  <text
                    x={zone.svgRect.labelX}
                    y={zone.svgRect.labelY + 12}
                    textAnchor="middle"
                    className="svg-density-label"
                    fill={stroke}
                  >
                    {isLive
                      ? `LIVE: ${liveStatus.instantaneous_count} pax • ${(liveStatus.density_per_sqm || 0).toFixed(3)} p/m²`
                      : `${zone.densityPerSqm} p/m² • LoS ${zone.fruinLoS} (${zone.simulatedCount} pax)`}
                  </text>

                  {/* Operational Status Tag */}
                  <text
                    x={zone.svgRect.labelX}
                    y={zone.svgRect.labelY + 28}
                    textAnchor="middle"
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: '9px',
                      fontWeight: 700,
                      fill: stroke
                    }}
                  >
                    {isLive ? `[LIVE CAMERA INFERENCE]` : `[${zone.status} • SIMULATED]`}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Access Gates */}
          <g className="gates-layer" aria-label="Gates">
            {venue.gates.map((gate) => (
              <g key={gate.id} className="svg-gate" transform={`translate(${gate.svgPoint.x}, ${gate.svgPoint.y})`}>
                <circle
                  r="12"
                  fill={gate.status === 'OPEN' ? '#237A57' : '#A15C00'}
                  stroke="#FFFFFF"
                  strokeWidth="2"
                />
                <text
                  textAnchor="middle"
                  dy="4"
                  fill="#FFFFFF"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 800 }}
                >
                  {gate.code.replace('GATE-', '')}
                </text>
                <text
                  y="24"
                  textAnchor="middle"
                  style={{ fontFamily: 'var(--font-sans)', fontSize: '9px', fontWeight: 600, fill: '#172B43' }}
                >
                  {gate.name} ({gate.status})
                </text>
              </g>
            ))}
          </g>

          {/* Configured Camera Stations Layer */}
          <g className="cameras-layer" aria-label="Camera Stations">
            {(venue.cameras || []).map((station) => {
              const liveStatus = liveZoneStatuses?.[station.assignedZoneId];
              const isStreaming = liveStatus?.camera_assigned && liveStatus.status === 'STREAMING';
              const isStale = liveStatus?.status === 'STALE';
              const bgColor = isStreaming ? '#065F46' : isStale ? '#B45309' : '#1E293B';
              const dotColor = isStreaming ? '#34D399' : isStale ? '#FBBF24' : '#94A3B8';

              return (
                <g
                  key={station.id}
                  className="svg-camera-station"
                  transform={`translate(${station.svgPoint.x - 36}, ${station.svgPoint.y - 12})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (onNavigateToCamera) {
                      onNavigateToCamera(station.assignedZoneId);
                    } else {
                      const zone = venue.zones.find((z) => z.id === station.assignedZoneId);
                      if (zone) onSelectZone(zone);
                    }
                  }}
                >
                  <rect
                    width="72"
                    height="22"
                    rx="11"
                    fill={bgColor}
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                    filter="drop-shadow(0 2px 4px rgba(0,0,0,0.25))"
                  />
                  <circle cx="10" cy="11" r="3.5" fill={dotColor} />
                  <text
                    x="20"
                    y="14"
                    fill="#FFFFFF"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      fontWeight: 800,
                      userSelect: 'none',
                    }}
                  >
                    📹 {station.code}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
};
