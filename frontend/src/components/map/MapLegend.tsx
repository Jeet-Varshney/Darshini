import React from 'react';

export const MapLegend: React.FC = () => {
  return (
    <div className="map-legend-overlay" aria-label="Operational Map Legend">
      <div className="legend-title">
        <span>Fruin Density Scale</span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>LoS A-F</span>
      </div>

      <div className="legend-items">
        <div className="legend-item">
          <span
            className="legend-swatch"
            style={{ backgroundColor: 'var(--status-positive)' }}
            aria-hidden="true"
          />
          <div className="legend-desc">
            <span>LoS A-C (Clear)</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>&lt; 0.72 p/m²</span>
          </div>
        </div>

        <div className="legend-item">
          <span
            className="legend-swatch"
            style={{ backgroundColor: 'var(--status-warning)' }}
            aria-hidden="true"
          />
          <div className="legend-desc">
            <span>LoS D-E (Congested)</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>0.73 - 2.1 p/m²</span>
          </div>
        </div>

        <div className="legend-item">
          <span
            className="legend-swatch"
            style={{ backgroundColor: 'var(--status-critical)' }}
            aria-hidden="true"
          />
          <div className="legend-desc">
            <span>LoS F (Critical Surge)</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>&gt; 2.17 p/m²</span>
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            marginTop: '4px',
            paddingTop: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            fontSize: '10px',
            color: 'var(--text-muted)'
          }}
        >
          <div>■ Gate Turnstile (Green: Open | Amber: Restricted)</div>
          <div>━ Road Connection (Dotted: Emergency Lane)</div>
        </div>
      </div>
    </div>
  );
};
