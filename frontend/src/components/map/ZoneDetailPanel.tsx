import React from 'react';
import type { VenueZone } from '../../types/venue';
import type { ZoneLiveStatus } from '../../types/detection';
import { StatusPill } from '../layout/StatusPill';

interface ZoneDetailPanelProps {
  zone: VenueZone | null;
  liveZoneStatus?: ZoneLiveStatus | null;
  onClearSelection: () => void;
  onAssignCamera?: (zoneId: string) => void;
}

export const ZoneDetailPanel: React.FC<ZoneDetailPanelProps> = ({
  zone,
  liveZoneStatus,
  onClearSelection,
  onAssignCamera,
}) => {
  if (!zone) {
    return (
      <div className="panel-card panel-right">
        <div className="panel-header">
          <div className="panel-title">
            <span aria-hidden="true">📍</span>
            <span>Zone Inspection</span>
          </div>
        </div>
        <div className="panel-body" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '32px', marginBottom: 'var(--space-2)' }}>🗺️</div>
          <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            No Zone Selected
          </p>
          <p style={{ fontSize: 'var(--text-xs)', maxWidth: '240px', lineHeight: 1.5 }}>
            Click any zone polygon on the map or select a zone from the left list to inspect capacity and metrics.
          </p>
        </div>
        <div className="panel-footer">
          Click map polygon or list item to view details
        </div>
      </div>
    );
  }

  const utilizationPct = Math.min(
    Math.round((zone.simulatedCount / zone.safeCapacity) * 100),
    200
  );

  const getStatusType = () => {
    switch (zone.status) {
      case 'CRITICAL':
        return 'critical' as const;
      case 'WARNING':
        return 'warning' as const;
      case 'NORMAL':
      default:
        return 'positive' as const;
    }
  };

  const isLiveActive = liveZoneStatus?.camera_assigned && liveZoneStatus.status === 'STREAMING';
  const isLiveStale = liveZoneStatus?.camera_assigned && liveZoneStatus.status !== 'STREAMING';

  return (
    <div className="panel-card panel-right">
      <div className="panel-header">
        <div className="panel-title">
          <span aria-hidden="true">📍</span>
          <span>{zone.code}: {zone.name}</span>
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--accent-primary)',
            padding: '2px 6px',
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border-default)',
            cursor: 'pointer',
          }}
          title="Clear active selection"
        >
          ✕ Close
        </button>
      </div>

      <div className="panel-body zone-detail-view">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <StatusPill
            status={getStatusType()}
            label={`STATUS: ${zone.status}`}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              fontWeight: 700,
              padding: '2px 6px',
              backgroundColor: 'var(--surface-secondary)',
              borderRadius: 'var(--radius-badge)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            Fruin LoS: {zone.fruinLoS}
          </span>
        </div>

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
          {zone.description}
        </p>

        {/* Milestone 3: Genuine Live Camera Observation Card */}
        {isLiveActive ? (
          <div className="live-observation-card" role="region" aria-label="Live Camera Feed Observation">
            <div className="live-observation-header">
              <span className="live-observation-title">
                <span aria-hidden="true">📷</span>
                <span>LIVE CAMERA OBSERVATION</span>
              </span>
              <span className="live-cam-badge">
                ● STREAMING
              </span>
            </div>

            <div className="live-observation-metric">
              <span className="live-obs-val">{liveZoneStatus?.instantaneous_count ?? 0}</span>
              <span className="live-obs-sub">persons detected in camera field of view</span>
            </div>

            <div className="live-observation-specs">
              <div>
                <strong>Assigned Camera:</strong> {liveZoneStatus?.camera_name || `Camera #${liveZoneStatus?.device_index}`}
              </div>
              <div>
                <strong>Observed Density:</strong> {(liveZoneStatus?.density_per_sqm || 0).toFixed(4)} pax/m²
                (Area: {zone.areaSqm.toLocaleString()} m²)
              </div>
              <div>
                <strong>Last Inference:</strong> {liveZoneStatus?.last_inference_time ? liveZoneStatus.last_inference_time.substring(11, 19) + ' UTC' : 'Live'}
              </div>
            </div>

            <div className="live-obs-provenance">
              * Instantaneous field-of-view count. Never accumulated across frames. No GPS coordinates inferred.
            </div>
          </div>
        ) : isLiveStale ? (
          <div className="live-observation-card" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
            <div className="live-observation-header">
              <span className="live-observation-title" style={{ color: '#B45309' }}>
                <span aria-hidden="true">⚠️</span>
                <span>CAMERA FEED STALE / OFFLINE</span>
              </span>
              <span className="stale-cam-badge">
                ○ {liveZoneStatus?.status || 'DISCONNECTED'}
              </span>
            </div>
            <p style={{ fontSize: '11px', color: '#92400E', margin: 0, lineHeight: 1.4 }}>
              Assigned camera ({liveZoneStatus?.camera_name || 'Camera'}) is currently stopped or delayed. Preserving last known observation.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              type="button"
              className="btn-assign-camera"
              onClick={() => onAssignCamera && onAssignCamera(zone.id)}
              title={`Switch to Camera Detection screen and map an active camera to ${zone.name}`}
            >
              <span>📷</span>
              <span>Assign Live Camera to {zone.code}</span>
            </button>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
              No active camera feed mapped. Displaying configured simulation baseline below.
            </span>
          </div>
        )}

        {/* Capacity Utilization Bar (Simulation Baseline) */}
        <div className="zone-capacity-bar-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Capacity Saturation (Simulation)</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
              {utilizationPct}% ({zone.simulatedCount} / {zone.safeCapacity})
            </span>
          </div>

          <div className="capacity-track" role="progressbar" aria-valuenow={utilizationPct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`capacity-fill ${
                zone.status === 'CRITICAL'
                  ? 'critical'
                  : zone.status === 'WARNING'
                  ? 'warning'
                  : 'positive'
              }`}
              style={{ width: `${Math.min(utilizationPct, 100)}%` }}
            />
          </div>
        </div>

        {/* Detailed Metrics Table */}
        <div
          style={{
            backgroundColor: 'var(--surface-secondary)',
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border-subtle)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Physical Surface Area</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{zone.areaSqm} m²</span>
          </div>
          <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Simulated Pedestrian Count</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{zone.simulatedCount}</span>
          </div>
          <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Simulated Density</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: zone.status === 'CRITICAL' ? 'var(--status-critical)' : 'inherit' }}>
              {zone.densityPerSqm} persons/m²
            </span>
          </div>
          <div style={{ padding: 'var(--space-2) var(--space-3)', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Safe Threshold Limit</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>2.00 persons/m²</span>
          </div>
        </div>

        {/* Data Integrity / Simulation Disclaimer */}
        <div className="data-integrity-notice">
          <strong>OPERATIONAL RULE:</strong> Live camera feeds reflect genuine model inferences inside that camera's FOV. Unassigned zones display configured demo baselines and never substitute live inference without a camera.
        </div>
      </div>

      <div className="panel-footer">
        Zone ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{zone.id}</code>
      </div>
    </div>
  );
};
