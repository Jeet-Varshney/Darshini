import React, { useState, useEffect } from 'react';
import { StatusPill } from './StatusPill';

interface HeaderProps {
  systemStatus?: 'normal' | 'warning' | 'critical';
}

export const Header: React.FC<HeaderProps> = ({ systemStatus = 'warning' }) => {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const getSystemStatusProps = () => {
    switch (systemStatus) {
      case 'critical':
        return { status: 'critical' as const, label: 'GLOBAL POSTURE: CRITICAL' };
      case 'warning':
        return { status: 'warning' as const, label: 'ELEVATED SURGE ALERT' };
      case 'normal':
      default:
        return { status: 'positive' as const, label: 'NORMAL OPERATIONS' };
    }
  };

  const statusConfig = getSystemStatusProps();

  return (
    <header className="app-header" role="banner">
      <div className="header-left">
        <div className="brand-lockup">
          <svg
            className="brand-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v18" />
            <path d="M3 12h18" />
            <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.2" />
          </svg>
          <span className="brand-title">Darshini</span>
        </div>

        {/* Persistent mode indicator identifying the experience as prototype/demo */}
        <StatusPill
          status="info"
          label="DEMO MODE"
          icon="◆"
        />
      </div>

      <div className="header-right">
        <StatusPill
          status={statusConfig.status}
          label={statusConfig.label}
        />

        <div className="header-clock" aria-label="System Time">
          <span style={{ color: 'var(--text-muted)' }} aria-hidden="true">⏱</span>
          <span>{currentTime || '00:00:00'}</span>
          <span className="header-clock-tz">LOCAL</span>
        </div>

        <div
          className="operator-chip"
          title="Active Operator Session"
        >
          OPR: #01
        </div>
      </div>
    </header>
  );
};
