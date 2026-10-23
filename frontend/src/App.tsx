import { useState, useEffect, useCallback } from 'react';
import type { SectionId } from './types/navigation';
import type { VenueZone } from './types/venue';
import { FICTIONAL_VENUE } from './data/fictionalVenue';
import { Header } from './components/layout/Header';
import { Navigation } from './components/layout/Navigation';
import { LiveOperations } from './screens/LiveOperations';
import { CameraDetectionScreen } from './screens/CameraDetectionScreen';
import { ScenarioLabPlaceholder } from './screens/ScenarioLabPlaceholder';
import { EmergencyRoutingPlaceholder } from './screens/EmergencyRoutingPlaceholder';
import { IncidentsReportsPlaceholder } from './screens/IncidentsReportsPlaceholder';

export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('live-operations');
  const [selectedZone, setSelectedZone] = useState<VenueZone | null>(
    FICTIONAL_VENUE.zones[0] // Start with North Gate Plaza focused for immediate situational context
  );

  // Keyboard shortcut handler for 1-5 navigation
  // Strictly checks that input/textarea/select are not focused and no modifier keys are pressed
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if modifier keys are active
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
        return;
      }

      // Ignore if user is currently interacting with an input or editable field
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case '1':
          e.preventDefault();
          setActiveSection('live-operations');
          break;
        case '2':
          e.preventDefault();
          setActiveSection('camera-detection');
          break;
        case '3':
          e.preventDefault();
          setActiveSection('scenario-lab');
          break;
        case '4':
          e.preventDefault();
          setActiveSection('emergency-routing');
          break;
        case '5':
          e.preventDefault();
          setActiveSection('incidents-reports');
          break;
        default:
          break;
      }
    },
    []
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSelectZone = (zone: VenueZone) => {
    setSelectedZone(zone);
  };

  const handleClearZone = () => {
    setSelectedZone(null);
  };

  return (
    <div className="app-shell">
      {/* Top Application Header */}
      <Header systemStatus="warning" />

      {/* Main 5-Section Navigation */}
      <Navigation
        activeSection={activeSection}
        onSelectSection={setActiveSection}
      />

      {/* Operational Context Sub-Bar */}
      <aside className="context-bar" aria-label="Operational Area Context">
        <div className="context-meta-group">
          <span className="context-chip">
            <span style={{ color: 'var(--text-muted)' }}>VENUE:</span>
            <span className="context-label">{FICTIONAL_VENUE.name}</span>
          </span>
          <span className="context-divider">|</span>
          <span className="context-chip">
            <span style={{ color: 'var(--text-muted)' }}>SECTOR:</span>
            <span style={{ fontWeight: 600 }}>Simulated North & East Precinct</span>
          </span>
          <span className="context-divider">|</span>
          <span className="context-chip">
            <span style={{ color: 'var(--text-muted)' }}>MONITORED ZONES:</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>5 Zones (4 Gates)</span>
          </span>
        </div>

        <div className="context-alert-group">
          <span className="context-surge-badge">
            ACTIVE SURGE: GATE A PLAZA (3,120 pax)
          </span>
        </div>
      </aside>

      {/* Main Operational Workspace */}
      <main className="main-workspace">
        {activeSection === 'live-operations' && (
          <LiveOperations
            venue={FICTIONAL_VENUE}
            selectedZone={selectedZone}
            onSelectZone={handleSelectZone}
            onClearZone={handleClearZone}
          />
        )}

        {activeSection === 'camera-detection' && <CameraDetectionScreen />}
        {activeSection === 'scenario-lab' && <ScenarioLabPlaceholder />}
        {activeSection === 'emergency-routing' && <EmergencyRoutingPlaceholder />}
        {activeSection === 'incidents-reports' && <IncidentsReportsPlaceholder />}
      </main>

      {/* Operational Footer */}
      <footer className="app-footer" role="contentinfo">
        <div className="footer-left">
          <span className="footer-tag">
            DATA: FICTIONAL CONFIGURATION (SIMULATED FIXTURE)
          </span>
          <span>
            CrowdFlow Sentinel v0.1.0 • Milestone 1 Foundation
          </span>
        </div>
        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
          Operational prototype decision support only. Automated advisories require human verification.
        </div>
      </footer>
    </div>
  );
}

export default App;
