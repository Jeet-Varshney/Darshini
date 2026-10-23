import React from 'react';

export const IncidentsReportsPlaceholder: React.FC = () => {
  return (
    <div className="placeholder-view" role="tabpanel" id="panel-incidents-reports" aria-labelledby="tab-incidents-reports">
      <div className="placeholder-card">
        <div className="placeholder-header">
          <svg className="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <div>
            <div className="placeholder-title-group">
              <h2 className="placeholder-title">Incidents & Reports</h2>
              <span className="placeholder-scope-badge">MILESTONE 5 SCOPE</span>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              Audit Register, Evidence Verification, Operator Actions & PDF Export
            </p>
          </div>
        </div>

        <div className="placeholder-notice">
          <strong>ℹ️ AUDIT & REPORT SCOPE:</strong> The historical incident register, evidence snapshot inspection drawer, and post-event reporting generator are scheduled for Milestone 5.
        </div>

        <p className="placeholder-desc">
          Planned capabilities for Incidents & Reports include:
        </p>

        <ul className="placeholder-list">
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Filterable Incident Register:</strong> Chronological table filterable by severity (Critical, Warning, Resolved) and zone location.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Evidence Drawer:</strong> Video snapshot captured at the exact moment of anomaly trigger, paired with detection boxes.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Operator Audit Trail:</strong> Documented timestamps of operator acknowledgments and mitigation decisions.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>PDF / CSV Report Exporter:</strong> Standardized event safety audit summaries for post-incident municipal debriefs.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
