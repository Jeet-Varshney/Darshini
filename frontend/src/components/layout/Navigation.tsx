import React from 'react';
import type { SectionId, NavItem } from '../../types/navigation';

interface NavigationProps {
  activeSection: SectionId;
  onSelectSection: (id: SectionId) => void;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'live-operations',
    label: 'Live Operations',
    shortcutKey: '1',
    badge: '1 CRITICAL',
    badgeType: 'critical',
    isImplementedInMilestone1: true
  },
  {
    id: 'camera-detection',
    label: 'Camera & Detection',
    shortcutKey: '2',
    isImplementedInMilestone1: false
  },
  {
    id: 'scenario-lab',
    label: 'Scenario Lab',
    shortcutKey: '3',
    isImplementedInMilestone1: false
  },
  {
    id: 'emergency-routing',
    label: 'Emergency Routing',
    shortcutKey: '4',
    isImplementedInMilestone1: false
  },
  {
    id: 'incidents-reports',
    label: 'Incidents & Reports',
    shortcutKey: '5',
    isImplementedInMilestone1: false
  },
  {
    id: 'events-management',
    label: 'Events & SMS',
    shortcutKey: '6',
    badge: 'LIVE',
    badgeType: 'info',
    isImplementedInMilestone1: true
  }
];

export const Navigation: React.FC<NavigationProps> = ({
  activeSection,
  onSelectSection
}) => {
  return (
    <nav className="app-nav" aria-label="Command Center Main Navigation">
      <ul className="nav-tab-list" role="tablist">
        {NAV_ITEMS.map((item) => {
          const isActive = activeSection === item.id;

          return (
            <li key={item.id} role="presentation">
              <button
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${item.id}`}
                className={`nav-tab-button ${isActive ? 'active' : ''}`}
                onClick={() => onSelectSection(item.id)}
              >
                <span>{item.label}</span>
                <span className="nav-key-hint" title={`Shortcut: Press ${item.shortcutKey}`}>
                  [{item.shortcutKey}]
                </span>

                {item.badge && item.badge !== 'PLANNED' && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: 'var(--radius-badge)',
                      backgroundColor:
                        item.badgeType === 'critical'
                          ? 'var(--status-critical-bg)'
                          : 'var(--surface-tertiary)',
                      color:
                        item.badgeType === 'critical'
                          ? 'var(--status-critical)'
                          : 'var(--text-secondary)',
                      border:
                        item.badgeType === 'critical'
                          ? '1px solid var(--status-critical-border)'
                          : '1px solid var(--border-subtle)',
                      marginLeft: '2px'
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
