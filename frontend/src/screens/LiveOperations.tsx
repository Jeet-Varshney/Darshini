import React from 'react';
import type { VenueConfiguration, VenueZone } from '../types/venue';
import type { ZoneLiveStatus } from '../types/detection';
import { CommandMap } from '../components/map/CommandMap';
import { ZoneDetailPanel } from '../components/map/ZoneDetailPanel';

interface LiveOperationsProps {
  venue: VenueConfiguration;
  selectedZone: VenueZone | null;
  onSelectZone: (zone: VenueZone) => void;
  onClearZone: () => void;
  liveZoneStatuses?: Record<string, ZoneLiveStatus>;
  onNavigateToCamera?: (zoneId: string) => void;
}

export const LiveOperations: React.FC<LiveOperationsProps> = ({
  venue,
  selectedZone,
  onSelectZone,
  onClearZone,
  liveZoneStatuses,
  onNavigateToCamera,
}) => {
  const totalSimulatedCount = venue.zones.reduce((sum, z) => sum + z.simulatedCount, 0);
  const criticalZonesCount = venue.zones.filter((z) => z.status === 'CRITICAL').length;
  const warningZonesCount = venue.zones.filter((z) => z.status === 'WARNING').length;

  const activeStreamingZones = Object.values(liveZoneStatuses || {}).filter(
    (z) => z.camera_assigned && z.status === 'STREAMING'
  );
  const totalLiveInstantaneous = activeStreamingZones.reduce(
    (sum, z) => sum + z.instantaneous_count,
    0
  );

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
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))' }}>
            <div className="kpi-block">
              <div className="kpi-label">Simulated Total</div>
              <div className="kpi-value">{totalSimulatedCount.toLocaleString()}</div>
              <div className="kpi-caption">Fixture Baseline</div>
            </div>
            <div className="kpi-block">
              <div className="kpi-label">Live Camera Detections</div>
              <div
                className="kpi-value font-mono"
                style={{
                  color: activeStreamingZones.length > 0 ? 'var(--status-positive)' : 'var(--text-muted)'
                }}
              >
                {activeStreamingZones.length > 0 ? `${totalLiveInstantaneous} pax` : '0 (Standby)'}
              </div>
              <div className="kpi-caption">
                {activeStreamingZones.length > 0
                  ? `${activeStreamingZones.length} live camera(s) *`
                  : 'No active camera'}
              </div>
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

          {activeStreamingZones.length > 0 && (
            <div
              style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                lineHeight: 1.3,
                padding: '4px 8px',
                backgroundColor: 'var(--surface-secondary)',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border-subtle)',
                marginBottom: 'var(--space-2)'
              }}
            >
              * <strong>Multi-Camera Disclaimer:</strong> Live detections reflect instantaneous FOV counts. If multiple cameras cover the same zone, counts are displayed independently and not summed to avoid duplicates.
            </div>
          )}

          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
            SELECT MONITORED ZONE:
          </div>

          {/* Zone Selector Buttons */}
          <div className="zone-list" role="list">
            {venue.zones.map((zone) => {
              const isSelected = selectedZone?.id === zone.id;
              const liveStatus = liveZoneStatuses?.[zone.id];
              const isLive = liveStatus?.camera_assigned && liveStatus.status === 'STREAMING';
              const isStale = liveStatus?.camera_assigned && liveStatus.status !== 'STREAMING';

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
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {isLive ? (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 'var(--radius-badge)',
                            backgroundColor: 'var(--status-positive-bg)',
                            color: 'var(--status-positive)',
                            border: '1px solid var(--status-positive-border)',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          ● LIVE: {liveStatus.instantaneous_count} pax
                        </span>
                      ) : isStale ? (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 'var(--radius-badge)',
                            backgroundColor: 'var(--status-warning-bg)',
                            color: 'var(--status-warning)',
                            border: '1px solid var(--status-warning-border)',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          ○ {liveStatus.status}
                        </span>
                      ) : null}
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
                  </div>

                  <div className="zone-item-stats">
                    <span>
                      {isLive ? (
                        <strong style={{ color: 'var(--status-positive)' }}>
                          Live FOV: {liveStatus.instantaneous_count} pax
                        </strong>
                      ) : (
                        <span>Simulated: {zone.simulatedCount} pax</span>
                      )}
                    </span>
                    <span className="zone-item-density">
                      {isLive
                        ? `${(liveStatus.density_per_sqm || 0).toFixed(3)} p/m²`
                        : `${zone.densityPerSqm} p/m²`}
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
            <strong>Provenance Architecture:</strong> Configured baseline counts are simulated fixtures. Zones mapped to active cameras display genuine instantaneous detections and observed densities.
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
          liveZoneStatuses={liveZoneStatuses}
          onNavigateToCamera={onNavigateToCamera}
        />
      </div>

      {/* Right Rail: Selected Zone Telemetry Details */}
      <ZoneDetailPanel
        zone={selectedZone}
        liveZoneStatus={selectedZone ? liveZoneStatuses?.[selectedZone.id] || null : null}
        onClearSelection={onClearZone}
        onAssignCamera={onNavigateToCamera}
      />
    </div>
  );
};
