import React from 'react';

interface StatusPillProps {
  status: 'critical' | 'warning' | 'info' | 'positive' | 'neutral';
  label: string;
  icon?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ status, label, icon }) => {
  const getDefaultIcon = () => {
    switch (status) {
      case 'critical':
        return '▲';
      case 'warning':
        return '◆';
      case 'info':
        return 'ℹ';
      case 'positive':
        return '✓';
      case 'neutral':
      default:
        return '●';
    }
  };

  return (
    <span className={`status-pill ${status}`} role="status">
      <span aria-hidden="true" style={{ fontSize: '10px' }}>
        {icon || getDefaultIcon()}
      </span>
      <span>{label}</span>
    </span>
  );
};
