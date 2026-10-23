import React from 'react';
import type { VenueZone } from '../../types/venue';
import { StatusPill } from '../layout/StatusPill';

interface ZoneDetailPanelProps {
  zone: VenueZone | null;
  onClearSelection: () => void;
}

export const ZoneDetailPanel: React.FC<ZoneDetailPanelProps> = ({
  zone,
  onClearSelection
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
            Click any zone polygon on the map or select a zone from the left list to inspect capacity and simulated metrics.
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
            border: '1px solid var(--border-default)'
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
              color: 'var(--text-primary)'
            }}
          >
            Fruin LoS: {zone.fruinLoS}
          </span>
        </div>

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {zone.description}
        </p>

        {/* Capacity Utilization Bar */}
        <div className="zone-capacity-bar-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Capacity Saturation</span>
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
            overflow: 'hidden'
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
            <span style={{ color: 'var(--text-secondary)' }}>Calculated Density</span>
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
          <strong>⚠️ SIMULATED DEMO VALUE:</strong> Metrics shown are configured demonstration fixtures for testing situational awareness workflows. Not derived from live camera feeds.
        </div>
      </div>

      <div className="panel-footer">
        Zone ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{zone.id}</code>
      </div>
    </div>
  );
};
