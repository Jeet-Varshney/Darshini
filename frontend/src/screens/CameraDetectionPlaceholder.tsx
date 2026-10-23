import React from 'react';

export const CameraDetectionPlaceholder: React.FC = () => {
  return (
    <div className="placeholder-view" role="tabpanel" id="panel-camera-detection" aria-labelledby="tab-camera-detection">
      <div className="placeholder-card">
        <div className="placeholder-header">
          <svg className="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h2 className="placeholder-title">Camera & Detection</h2>
              <span className="placeholder-scope-badge">MILESTONE 2 SCOPE</span>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              Video Surveillance, Bounding Box Overlays & Inflow Analytics
            </p>
          </div>
        </div>

        <div className="placeholder-notice">
          <strong>⚠️ COMPUTER VISION BOUNDARY:</strong> Model inference is <strong>NOT</strong> implemented in this milestone. In accordance with system audit findings, OpenCV and YOLO dependencies have not been scaffolded or fabricated. No fake inference data is shown.
        </div>

        <p className="placeholder-desc">
          When implemented in Milestone 2, this section will provide real-time visual inspection of venue surveillance cameras:
        </p>

        <ul className="placeholder-list">
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Multi-Feed Camera Grid:</strong> Direct switcher between Gate A North, Gate B East, Gate C South, and West Emergency lanes.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Synchronized Canvas Detection:</strong> Frame-accurate bounding boxes for detected pedestrians and vehicles.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Tripwire Counting:</strong> Real-time crossline velocity and bidirectional flow rate estimation.</span>
          </li>
          <li className="placeholder-item">
            <span className="placeholder-bullet">▸</span>
            <span><strong>Transparent Provenance:</strong> Clear attribution tags distinguishing observed camera counts from simulated models.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
