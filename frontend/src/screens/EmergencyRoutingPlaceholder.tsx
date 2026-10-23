import React from 'react';

export const EmergencyRoutingPlaceholder: React.FC = () => {
  return (
    <div className="placeholder-view" role="tabpanel" id="panel-emergency-routing" aria-labelledby="tab-emergency-routing">
      <div className="placeholder-card">
        <div className="placeholder-header">
          <svg className="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <div>
            <div className="placeholder-title-group">
              <h2 className="placeholder-title">Emergency Routing</h2>
              <span className="placeholder-scope-badge">MILESTONE 4 SCOPE</span>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              Fastest Cleared Path Solver, Obstacle Avoidance & Blocked-Road Handling
            </p>
          </div>
        </div>

        <div className="placeholder-notice">
          <strong>ℹ️ ROUTING SCOPE:</strong> The impedance-weighted Dijkstra routing engine and blocked-edge management service are scheduled for Milestone 4.
        </div>

        <p className="placeholder-desc">
          Planned capabilities for Emergency Routing include:
        </p>

        <ul className="placeholder-list">
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Origin/Destination Selector:</strong> Route planning between emergency dispatch bases, fire posts, and incident zones.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Interactive Blocked Edges:</strong> Click-to-block road segments compromised by crowd overflow, fallen obstacles, or stalled vehicles.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Multi-Route Comparison:</strong> Primary Cleared Corridor vs. Perimeter Bypass vs. Direct Compromised Path.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Turn-by-Turn Clearance Directions:</strong> Printable and exportable route orders for emergency drivers.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
