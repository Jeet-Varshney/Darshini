import React from 'react';

export const ScenarioLabPlaceholder: React.FC = () => {
  return (
    <div className="placeholder-view" role="tabpanel" id="panel-scenario-lab" aria-labelledby="tab-scenario-lab">
      <div className="placeholder-card">
        <div className="placeholder-header">
          <svg className="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          <div>
            <div className="placeholder-title-group">
              <h2 className="placeholder-title">Digital Twin / Scenario Lab</h2>
              <span className="placeholder-scope-badge">MILESTONE 3 SCOPE</span>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              Topological Network What-If Simulation & Capacity Bottleneck Analysis
            </p>
          </div>
        </div>

        <div className="placeholder-notice">
          <strong>ℹ️ SIMULATION SCOPE:</strong> The Digital Twin simulation engine (powered by Python NetworkX on the backend) will be implemented in Milestone 3.
        </div>

        <p className="placeholder-desc">
          Planned capabilities for the Scenario Lab include:
        </p>

        <ul className="placeholder-list">
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Node-Link Topology Model:</strong> Interactive graph of gates, walkways, concourses, and turnstiles with physical capacity bounds.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>What-If Parameter Adjustments:</strong> Sliders for crowd influx multipliers (0.5x to 3.0x), auxiliary gate openings, and road closures.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Side-by-Side Comparison:</strong> Direct comparison between "Do Nothing Baseline" and "Proposed Mitigation Plan".</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Capacity Breach Warnings:</strong> Predictive alerts flagging corridors projected to exceed 85% capacity.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
