import React from 'react';
import type { VenueConfiguration, VenueZone } from '../../types/venue';

interface SchematicMapProps {
  venue: VenueConfiguration;
  selectedZoneId: string | null;
  onSelectZone: (zone: VenueZone) => void;
  isFallbackActive?: boolean;
}

export const SchematicMap: React.FC<SchematicMapProps> = ({
  venue,
  selectedZoneId,
  onSelectZone,
  isFallbackActive = false
}) => {
  const getZoneFill = (zone: VenueZone, isSelected: boolean) => {
    if (isSelected) {
      return '#E0EDFA'; // Light steel blue highlight
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

  const getZoneStroke = (zone: VenueZone, isSelected: boolean) => {
    if (isSelected) {
      return '#365F8D';
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
        <span>
          <strong>{isFallbackActive ? '⚠️ TILE NETWORK UNAVAILABLE —' : 'ℹ️'} LOCAL SCHEMATIC MAP:</strong> Rendering deterministic vector blueprint of {venue.name}.
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
          OFFLINE RESILIENT MODE
        </span>
      </div>

      <div className="schematic-svg-container">
        <svg
          viewBox="0 0 900 520"
          className="schematic-svg"
          aria-label="Schematic Vector Map of Sentinel Precinct"
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
              const fill = getZoneFill(zone, isSelected);
              const stroke = getZoneStroke(zone, isSelected);

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

                  {/* Zone Name */}
                  <text
                    x={zone.svgRect.labelX}
                    y={zone.svgRect.labelY - 14}
                    textAnchor="middle"
                    className="svg-label"
                  >
                    {zone.name}
                  </text>

                  {/* Simulated Density & LoS readout */}
                  <text
                    x={zone.svgRect.labelX}
                    y={zone.svgRect.labelY + 12}
                    textAnchor="middle"
                    className="svg-density-label"
                    fill={stroke}
                  >
                    {zone.densityPerSqm} p/m² • LoS {zone.fruinLoS} ({zone.simulatedCount} pax)
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
                    [{zone.status}]
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
        </svg>
      </div>
    </div>
  );
};
