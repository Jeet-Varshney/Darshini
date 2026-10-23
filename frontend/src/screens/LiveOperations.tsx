import React from 'react';
import type { VenueConfiguration, VenueZone } from '../types/venue';
import { CommandMap } from '../components/map/CommandMap';
import { ZoneDetailPanel } from '../components/map/ZoneDetailPanel';

interface LiveOperationsProps {
  venue: VenueConfiguration;
  selectedZone: VenueZone | null;
  onSelectZone: (zone: VenueZone) => void;
  onClearZone: () => void;
}

export const LiveOperations: React.FC<LiveOperationsProps> = ({
  venue,
  selectedZone,
  onSelectZone,
  onClearZone
}) => {
  const totalSimulatedCount = venue.zones.reduce((sum, z) => sum + z.simulatedCount, 0);
  const criticalZonesCount = venue.zones.filter((z) => z.status === 'CRITICAL').length;
  const warningZonesCount = venue.zones.filter((z) => z.status === 'WARNING').length;

  return (
    <div className="live-ops-grid" role="tabpanel" id="panel-live-operations" aria-labelledby="tab-live-operations">
      {/* Left Rail: Zone List & Global Precinct KPIs */}
      <div className="panel-card panel-left">
        <div className="panel-header">
          <div className="panel-title">
            <span aria-hidden="true">🏢</span>
            <span>Venue Zones</span>
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              padding: '1px 6px',
              backgroundColor: 'var(--surface-secondary)',
              borderRadius: 'var(--radius-badge)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)'
            }}
          >
            {venue.zones.length} ZONES
          </span>
        </div>

        <div className="panel-body">
          {/* Precinct Summary KPIs */}
          <div className="kpi-row">
            <div className="kpi-block">
              <div className="kpi-label">Total Headcount</div>
              <div className="kpi-value">{totalSimulatedCount.toLocaleString()}</div>
              <div className="kpi-caption">Simulated Crowd Total</div>
            </div>
            <div className="kpi-block">
              <div className="kpi-label">Active Alerts</div>
              <div
                className="kpi-value"
                style={{ color: criticalZonesCount > 0 ? 'var(--status-critical)' : 'inherit' }}
              >
                {criticalZonesCount} Crit / {warningZonesCount} Warn
              </div>
              <div className="kpi-caption">Surge Risk Zones</div>
            </div>
          </div>

          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
            SELECT MONITORED ZONE:
          </div>

          {/* Zone Selector Buttons */}
          <div className="zone-list" role="list">
            {venue.zones.map((zone) => {
              const isSelected = selectedZone?.id === zone.id;

              return (
                <button
                  key={zone.id}
                  type="button"
                  className={`zone-item-button ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectZone(zone)}
                  aria-pressed={isSelected}
                >
                  <div className="zone-item-header">
                    <span className="zone-item-name">
                      {zone.code}: {zone.name}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-badge)',
                        backgroundColor:
                          zone.status === 'CRITICAL'
                            ? 'var(--status-critical-bg)'
                            : zone.status === 'WARNING'
                            ? 'var(--status-warning-bg)'
                            : 'var(--status-positive-bg)',
                        color:
                          zone.status === 'CRITICAL'
                            ? 'var(--status-critical)'
                            : zone.status === 'WARNING'
                            ? 'var(--status-warning)'
                            : 'var(--status-positive)'
                      }}
                    >
                      LoS {zone.fruinLoS}
                    </span>
                  </div>

                  <div className="zone-item-stats">
                    <span>Simulated: {zone.simulatedCount} pax</span>
                    <span className="zone-item-density">
                      {zone.densityPerSqm} p/m²
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Operational Policy Reminder */}
          <div
            style={{
              marginTop: 'auto',
              backgroundColor: 'var(--surface-secondary)',
              borderRadius: 'var(--radius-control)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
              border: '1px solid var(--border-subtle)'
            }}
          >
            <strong>Note:</strong> All values are simulated calibration fixtures. Real camera detections will be integrated in Milestone 2.
          </div>
        </div>

        <div className="panel-footer">
          Precinct: {venue.name}
        </div>
      </div>

      {/* Center Canvas: Interactive Map with Leaflet & Schematic Fallback */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <CommandMap
          venue={venue}
          selectedZone={selectedZone}
          onSelectZone={onSelectZone}
        />
      </div>

      {/* Right Rail: Selected Zone Telemetry Details */}
      <ZoneDetailPanel
        zone={selectedZone}
        onClearSelection={onClearZone}
      />
    </div>
  );
};
