/**
 * Darshini - Safety Incident Management & Operational Reporting Screen
 * Handles real stored incident records, lifecycle status transitions (OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED),
 * immutable timeline auditing, staff responsibility assignment, real metric analytics, and formula-safe CSV export.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  IncidentRecord,
  IncidentSummaryMetrics,
  IncidentSeverity,
  IncidentCategory,
  IncidentStatus,
} from '../types/incidents';
import type { UserProfile } from '../types/events';
import {
  fetchIncidents,
  fetchIncidentById,
  createIncident,
  transitionIncidentStatus,
  addIncidentNote,
  assignIncident,
  fetchIncidentMetrics,
  getIncidentCsvDownloadUrl,
} from '../services/incidentApi';
import {
  getStoredUser,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  login,
} from '../services/eventApi';
import { FICTIONAL_VENUE } from '../data/fictionalVenue';

export interface IncidentPrefillContext {
  zone_id?: string;
  zone_name?: string;
  camera_id?: string;
  person_count?: number;
  timestamp?: string;
  edge_id?: string;
}

interface IncidentsReportsScreenProps {
  onNavigateToRouting?: (edgeId?: string) => void;
  onNavigateToCamera?: (zoneId?: string) => void;
  prefillData?: IncidentPrefillContext | null;
  onClearPrefill?: () => void;
}

export const IncidentsReportsScreen: React.FC<IncidentsReportsScreenProps> = ({
  onNavigateToRouting,
  onNavigateToCamera,
  prefillData,
  onClearPrefill,
}) => {
  const [activeTab, setActiveTab] = useState<'register' | 'analytics'>('register');
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [metrics, setMetrics] = useState<IncidentSummaryMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Incident Drawer
  const [selectedIncident, setSelectedIncident] = useState<IncidentRecord | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);
  const [transitionNote, setTransitionNote] = useState<string>('');
  const [newNoteText, setNewNoteText] = useState<string>('');

  // Assignment section state
  const [assigneeInput, setAssigneeInput] = useState<string>('');
  const [assigneeNameInput, setAssigneeNameInput] = useState<string>('');
  const [assignNoteInput, setAssignNoteInput] = useState<string>('');
  const [assignSubmitting, setAssignSubmitting] = useState<boolean>(false);

  // Operator Auth state
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(getStoredUser());
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authUsername, setAuthUsername] = useState<string>('operator');
  const [authPassword, setAuthPassword] = useState<string>('OperatorPass123');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  // Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [createForm, setCreateForm] = useState<{
    title: string;
    description: string;
    severity: IncidentSeverity;
    category: IncidentCategory;
    zone_id: string;
    zone_name: string;
    camera_id: string;
    related_edge_id: string;
    source: string;
  }>({
    title: '',
    description: '',
    severity: 'WARNING',
    category: 'CROWD_DENSITY',
    zone_id: '',
    zone_name: '',
    camera_id: '',
    related_edge_id: '',
    source: 'OPERATOR_REPORTED',
  });
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Refresh user
  useEffect(() => {
    setCurrentUser(getStoredUser());
  }, []);

  // Handle escalation prefill from Camera Detection
  useEffect(() => {
    if (prefillData) {
      setCreateForm({
        title: `Observation Alert: ${prefillData.zone_name || prefillData.camera_id || 'Venue Area'}`,
        description: `Operator report citing camera observation from ${prefillData.camera_id || 'camera'}${prefillData.zone_name ? ` in ${prefillData.zone_name}` : ''}${prefillData.person_count !== undefined ? ` (Count: ${prefillData.person_count} pax)` : ''} at ${prefillData.timestamp || new Date().toISOString()}. Verified by operator.`,
        severity: (prefillData.person_count ?? 0) >= 10 ? 'CRITICAL' : 'WARNING',
        category: 'CROWD_DENSITY',
        zone_id: prefillData.zone_id || '',
        zone_name: prefillData.zone_name || '',
        camera_id: prefillData.camera_id || '',
        related_edge_id: prefillData.edge_id || '',
        source: 'OPERATOR_REPORTED',
      });
      setIsCreateOpen(true);
      if (onClearPrefill) {
        onClearPrefill();
      }
    }
  }, [prefillData, onClearPrefill]);

  // Auth gate helper
  const requireOperatorAuth = (action: () => Promise<void>) => {
    if (!getStoredToken() || !currentUser) {
      setPendingAction(() => action);
      setShowAuthModal(true);
      return;
    }
    action();
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const res = await login(authUsername.trim(), authPassword);
      setStoredToken(res.access_token, res.user);
      setCurrentUser(res.user);
      setShowAuthModal(false);
      if (pendingAction) {
        const action = pendingAction;
        setPendingAction(null);
        await action();
      }
    } catch (err: any) {
      setAuthError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignOut = () => {
    clearStoredToken();
    setCurrentUser(null);
  };

  // Load Data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [incidentList, metricData] = await Promise.all([
        fetchIncidents({
          status: statusFilter || undefined,
          severity: severityFilter || undefined,
          category: categoryFilter || undefined,
          source: sourceFilter || undefined,
          start_time: startDateFilter ? new Date(startDateFilter).toISOString() : undefined,
          end_time: endDateFilter ? new Date(endDateFilter).toISOString() : undefined,
          search: searchQuery || undefined,
        }),
        fetchIncidentMetrics({
          start_time: startDateFilter ? new Date(startDateFilter).toISOString() : undefined,
          end_time: endDateFilter ? new Date(endDateFilter).toISOString() : undefined,
        }),
      ]);
      setIncidents(incidentList);
      setMetrics(metricData);
    } catch (err: any) {
      setError(err?.message || 'Failed to load safety incidents and analytics');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, categoryFilter, sourceFilter, startDateFilter, endDateFilter, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // View Incident Details
  const handleOpenIncident = async (incident: IncidentRecord) => {
    try {
      setDrawerLoading(true);
      const fullRecord = await fetchIncidentById(incident.id);
      setSelectedIncident(fullRecord);
      setAssigneeInput(fullRecord.assigned_to || '');
      setAssigneeNameInput(fullRecord.assigned_to_name || '');
    } catch {
      setSelectedIncident(incident);
      setAssigneeInput(incident.assigned_to || '');
      setAssigneeNameInput(incident.assigned_to_name || '');
    } finally {
      setDrawerLoading(false);
    }
  };

  // Status Transition
  const handleStatusTransition = (newStatus: IncidentStatus) => {
    if (!selectedIncident) return;
    requireOperatorAuth(async () => {
      try {
        setDrawerLoading(true);
        const updated = await transitionIncidentStatus(
          selectedIncident.id,
          newStatus,
          transitionNote || undefined
        );
        setSelectedIncident(updated);
        setTransitionNote('');
        await loadData();
      } catch (err: any) {
        alert(`Status transition failed: ${err?.message || 'Unknown error'}`);
      } finally {
        setDrawerLoading(false);
      }
    });
  };

  // Add Note
  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident || !newNoteText.trim()) return;
    requireOperatorAuth(async () => {
      try {
        setDrawerLoading(true);
        const updated = await addIncidentNote(selectedIncident.id, newNoteText.trim());
        setSelectedIncident(updated);
        setNewNoteText('');
        await loadData();
      } catch (err: any) {
        alert(`Failed to add note: ${err?.message || 'Unknown error'}`);
      } finally {
        setDrawerLoading(false);
      }
    });
  };

  // Assign Responsibility
  const handleAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident || !assigneeInput.trim()) return;
    requireOperatorAuth(async () => {
      try {
        setAssignSubmitting(true);
        const updated = await assignIncident(
          selectedIncident.id,
          assigneeInput.trim(),
          assigneeNameInput.trim() || undefined,
          assignNoteInput.trim() || undefined
        );
        setSelectedIncident(updated);
        setAssignNoteInput('');
        await loadData();
      } catch (err: any) {
        alert(`Failed to assign incident: ${err?.message || 'Unknown error'}`);
      } finally {
        setAssignSubmitting(false);
      }
    });
  };

  // Create Incident
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    requireOperatorAuth(async () => {
      try {
        setCreateSubmitting(true);
        setCreateError(null);
        await createIncident(createForm);
        setIsCreateOpen(false);
        setCreateForm({
          title: '',
          description: '',
          severity: 'WARNING',
          category: 'CROWD_DENSITY',
          zone_id: '',
          zone_name: '',
          camera_id: '',
          related_edge_id: '',
          source: 'OPERATOR_REPORTED',
        });
        await loadData();
      } catch (err: any) {
        setCreateError(err?.message || 'Failed to file incident report');
      } finally {
        setCreateSubmitting(false);
      }
    });
  };

  // Badges
  const getSeverityBadge = (sev: IncidentSeverity) => {
    switch (sev) {
      case 'CRITICAL':
        return <span className="severity-tag severity-critical">CRITICAL</span>;
      case 'WARNING':
        return <span className="severity-tag severity-warning">WARNING</span>;
      case 'ADVISORY':
        return <span className="severity-tag severity-advisory">ADVISORY</span>;
      default:
        return <span className="severity-tag severity-info">INFO</span>;
    }
  };

  const getStatusBadge = (st: IncidentStatus) => {
    switch (st) {
      case 'OPEN':
        return <span className="status-pill status-open">OPEN</span>;
      case 'ACKNOWLEDGED':
        return <span className="status-pill status-ack">ACKNOWLEDGED</span>;
      case 'IN_PROGRESS':
        return <span className="status-pill status-prog">IN PROGRESS</span>;
      case 'RESOLVED':
        return <span className="status-pill status-res">RESOLVED</span>;
      case 'CLOSED':
        return <span className="status-pill status-closed">CLOSED</span>;
      default:
        return <span className="status-pill">{st}</span>;
    }
  };

  return (
    <div className="incidents-workspace">
      {/* Operator Session Banner */}
      <div
        className={`operator-auth-banner ${
          currentUser ? 'authenticated' : 'unauthenticated'
        }`}
      >
        {currentUser ? (
          <>
            <div>
              <strong>🛡️ Authorized Operator:</strong> {currentUser.full_name} ({currentUser.role})
            </div>
            <button
              type="button"
              className="events-subnav-btn"
              style={{ fontSize: '11px', padding: '2px 8px' }}
              onClick={handleSignOut}
            >
              Sign Out
            </button>
          </>
        ) : (
          <>
            <div>
              <strong>⚠️ Operator Authentication Required</strong> to log incidents or transition safety states
            </div>
            <button
              type="button"
              className="events-subnav-btn"
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                background: 'var(--accent-primary)',
                color: '#FFFFFF',
                fontWeight: 600,
              }}
              onClick={() => setShowAuthModal(true)}
            >
              Sign In as Operator
            </button>
          </>
        )}
      </div>

      {/* KPI Cards Header */}
      <div className="kpi-metrics-row">
        <div className="kpi-card">
          <span className="kpi-title">Total Filed Incidents</span>
          <span className="kpi-value">{metrics ? metrics.total_incidents : '—'}</span>
          <span className="kpi-subtitle">Persistent SQLite registry</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-title">Active Response Queue</span>
          <span className="kpi-value" style={{ color: 'var(--status-critical)' }}>
            {metrics ? metrics.active_incidents : '—'}
          </span>
          <span className="kpi-subtitle">Open • Ack • In Progress</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-title">Resolved / Mitigated</span>
          <span className="kpi-value" style={{ color: 'var(--status-positive)' }}>
            {metrics ? metrics.resolved_incidents : '—'}
          </span>
          <span className="kpi-subtitle">Closed safety incidents</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-title">Avg Resolution Duration</span>
          <span className="kpi-value">
            {metrics && metrics.avg_resolution_time_minutes !== null && metrics.avg_resolution_time_minutes !== undefined
              ? `${metrics.avg_resolution_time_minutes}m`
              : '—'}
          </span>
          <span className="kpi-subtitle">
            {metrics && metrics.avg_resolution_time_minutes !== null ? 'Actual ticket durations' : 'No resolved records'}
          </span>
        </div>
      </div>

      {/* Navigation Sub-Tabs & Action Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)', paddingBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`routing-btn ${activeTab === 'register' ? 'routing-btn-primary' : ''}`}
            onClick={() => setActiveTab('register')}
          >
            📋 Incident Register ({incidents.length})
          </button>
          <button
            type="button"
            className={`routing-btn ${activeTab === 'analytics' ? 'routing-btn-primary' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            📊 Analytics & Audit Breakdown
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            href={getIncidentCsvDownloadUrl({
              status: statusFilter || undefined,
              severity: severityFilter || undefined,
              category: categoryFilter || undefined,
              source: sourceFilter || undefined,
              start_time: startDateFilter ? new Date(startDateFilter).toISOString() : undefined,
              end_time: endDateFilter ? new Date(endDateFilter).toISOString() : undefined,
              search: searchQuery || undefined,
            })}
            download="darshini_incidents_audit.csv"
            className="routing-btn"
            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Download CSV report matching active filters"
          >
            📥 Export CSV
          </a>

          <button
            type="button"
            className="routing-btn routing-btn-primary"
            onClick={() => setIsCreateOpen(true)}
          >
            + File Incident Report
          </button>
        </div>
      </div>

      {/* Tab: Incident Register Table */}
      {activeTab === 'register' && (
        <>
          {/* Filter Bar */}
          <div className="incidents-filter-bar">
            <div className="filter-inputs-group">
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="OPEN">OPEN</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="IN_PROGRESS">IN PROGRESS</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="CLOSED">CLOSED</option>
              </select>

              <select
                className="form-select"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
              >
                <option value="">All Severities</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="WARNING">WARNING</option>
                <option value="ADVISORY">ADVISORY</option>
                <option value="INFO">INFO</option>
              </select>

              <select
                className="form-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                <option value="CROWD_DENSITY">Crowd Density</option>
                <option value="PERIMETER_BREACH">Perimeter Breach</option>
                <option value="MEDICAL">Medical Emergency</option>
                <option value="FIRE_HAZARD">Fire Hazard</option>
                <option value="INFRASTRUCTURE">Infrastructure</option>
                <option value="LOST_PERSON">Lost Person</option>
                <option value="OPERATIONAL">Operational</option>
              </select>

              <select
                className="form-select"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <option value="">All Sources</option>
                <option value="OPERATOR_REPORTED">Operator Reported</option>
                <option value="CAMERA_ASSISTED">Camera Assisted</option>
                <option value="SIMULATION_TRIGGERED">Simulation Triggered</option>
              </select>

              <input
                type="date"
                className="form-input"
                title="Filter by start date"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
              />

              <input
                type="date"
                className="form-input"
                title="Filter by end date"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
              />

              <input
                type="text"
                className="form-input"
                placeholder="Search tickets, titles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '180px' }}
              />
            </div>

            {(statusFilter || severityFilter || categoryFilter || sourceFilter || startDateFilter || endDateFilter || searchQuery) && (
              <button
                type="button"
                className="events-subnav-btn"
                style={{ fontSize: '11px' }}
                onClick={() => {
                  setStatusFilter('');
                  setSeverityFilter('');
                  setCategoryFilter('');
                  setSourceFilter('');
                  setStartDateFilter('');
                  setEndDateFilter('');
                  setSearchQuery('');
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Table content */}
          {error && (
            <div className="scanner-feedback-box scanner-feedback-error">
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="incidents-table-container empty-state">
              <p>Loading persistent incident register...</p>
            </div>
          ) : incidents.length === 0 ? (
            <div className="incidents-table-container empty-state">
              <p style={{ fontWeight: 600, fontSize: '15px', marginBottom: '6px' }}>No incident records found</p>
              <p style={{ fontSize: '13px' }}>
                {statusFilter || severityFilter || categoryFilter || sourceFilter || startDateFilter || endDateFilter || searchQuery
                  ? 'No records match the active filter criteria.'
                  : 'The database currently contains no safety incidents. File a new incident report to begin tracking.'}
              </p>
            </div>
          ) : (
            <div className="incidents-table-container">
              <table className="incidents-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Severity</th>
                    <th>Category</th>
                    <th>Title & Zone</th>
                    <th>Source</th>
                    <th>Assigned</th>
                    <th>Status</th>
                    <th>Reported</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr
                      key={inc.id}
                      onClick={() => handleOpenIncident(inc)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="incident-number-cell">{inc.incident_number}</td>
                      <td>{getSeverityBadge(inc.severity)}</td>
                      <td style={{ fontWeight: 600, fontSize: '12px' }}>
                        {inc.category.replace('_', ' ')}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{inc.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {inc.zone_name ? `📍 ${inc.zone_name}` : 'Zone Unspecified'}
                          {inc.camera_id ? ` • 📷 ${inc.camera_id}` : ''}
                          {inc.related_edge_id ? ` • 🛣️ Corridor ${inc.related_edge_id}` : ''}
                        </div>
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {inc.source === 'CAMERA_ASSISTED'
                          ? '📷 Camera'
                          : inc.source === 'SIMULATION_TRIGGERED'
                          ? '🧪 Simulation'
                          : '👤 Operator'}
                      </td>
                      <td style={{ fontSize: '11px', fontWeight: 600 }}>
                        {inc.assigned_to_name || inc.assigned_to || (
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Unassigned</span>
                        )}
                      </td>
                      <td>{getStatusBadge(inc.status)}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        <div>{new Date(inc.created_at).toLocaleDateString()}</div>
                        <div>{new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="routing-btn"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenIncident(inc);
                          }}
                        >
                          Details ➔
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Tab: Analytics & Metrics */}
      {activeTab === 'analytics' && metrics && (
        <div className="analytics-grid">
          {/* Severity Breakdown */}
          <div className="analytics-card">
            <div className="analytics-card-title">
              <span>Severity Distribution</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Persisted records</span>
            </div>
            {Object.entries(metrics.severity_breakdown).length === 0 ? (
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No records available</p>
            ) : (
              Object.entries(metrics.severity_breakdown).map(([sev, count]) => {
                const total = metrics.total_incidents || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={sev} className="breakdown-row">
                    <span style={{ width: '90px' }}>{getSeverityBadge(sev as IncidentSeverity)}</span>
                    <div className="breakdown-bar-bg">
                      <div
                        className="breakdown-bar-fill"
                        style={{
                          width: `${pct}%`,
                          background:
                            sev === 'CRITICAL'
                              ? 'var(--status-critical)'
                              : sev === 'WARNING'
                              ? 'var(--status-warning)'
                              : 'var(--accent-primary)',
                        }}
                      />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, width: '45px', textAlign: 'right' }}>
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Category Breakdown */}
          <div className="analytics-card">
            <div className="analytics-card-title">
              <span>Category Breakdown</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Incidents by Hazard Type</span>
            </div>
            {Object.entries(metrics.category_breakdown).length === 0 ? (
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No records available</p>
            ) : (
              Object.entries(metrics.category_breakdown).map(([cat, count]) => {
                const total = metrics.total_incidents || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={cat} className="breakdown-row">
                    <span style={{ width: '130px', fontSize: '12px', fontWeight: 600 }}>
                      {cat.replace('_', ' ')}
                    </span>
                    <div className="breakdown-bar-bg">
                      <div className="breakdown-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, width: '45px', textAlign: 'right' }}>
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Lifecycle Status Distribution */}
          <div className="analytics-card">
            <div className="analytics-card-title">
              <span>Lifecycle Status Pipeline</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Current Resolution Workflow</span>
            </div>
            {Object.entries(metrics.status_breakdown).map(([st, count]) => {
              const total = metrics.total_incidents || 1;
              const pct = Math.round((count / total) * 100);
              return (
                <div key={st} className="breakdown-row">
                  <span style={{ width: '120px' }}>{getStatusBadge(st as IncidentStatus)}</span>
                  <div className="breakdown-bar-bg">
                    <div className="breakdown-bar-fill" style={{ width: `${pct}%`, background: '#245D9C' }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, width: '45px', textAlign: 'right' }}>
                    {count} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>

          {/* Audit Verification Card */}
          <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div className="analytics-card-title">
                <span>Compliance & Audit Guarantee</span>
                <span style={{ fontSize: '11px', color: '#237A57' }}>✓ Cryptographic Integrity</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Every status transition, operator assignment, and mitigation commentary is recorded in SQLite with an immutable timestamp.
                Resolving an incident does not alter road network edges automatically unless an operator explicitly updates routing controls.
              </p>
            </div>
            <div style={{ marginTop: '16px' }}>
              <a
                href={getIncidentCsvDownloadUrl({
                  status: statusFilter || undefined,
                  severity: severityFilter || undefined,
                  category: categoryFilter || undefined,
                  source: sourceFilter || undefined,
                  start_time: startDateFilter ? new Date(startDateFilter).toISOString() : undefined,
                  end_time: endDateFilter ? new Date(endDateFilter).toISOString() : undefined,
                  search: searchQuery || undefined,
                })}
                download="darshini_incidents_audit.csv"
                className="routing-btn routing-btn-primary"
                style={{ width: '100%', textAlign: 'center', textDecoration: 'none', display: 'block' }}
              >
                📥 Download Filtered Historical Audit CSV
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Incident Detail Drawer */}
      {selectedIncident && (
        <div className="drawer-overlay" onClick={() => setSelectedIncident(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* Drawer Header */}
            <div className="drawer-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span className="incident-number-cell" style={{ fontSize: '16px' }}>
                    {selectedIncident.incident_number}
                  </span>
                  {getSeverityBadge(selectedIncident.severity)}
                  {getStatusBadge(selectedIncident.status)}
                </div>
                <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>
                  {selectedIncident.title}
                </h3>
              </div>
              <button
                type="button"
                className="routing-btn"
                style={{ padding: '4px 10px' }}
                onClick={() => setSelectedIncident(null)}
              >
                ✕ Close
              </button>
            </div>

            {/* Drawer Content */}
            <div className="drawer-content">
              {drawerLoading && <div style={{ fontSize: '12px', color: 'var(--accent-primary)' }}>Syncing with backend...</div>}

              {/* Description */}
              <div>
                <label className="form-label">Description & Context</label>
                <div
                  style={{
                    background: 'var(--surface-secondary)',
                    padding: '12px',
                    borderRadius: 'var(--radius-control)',
                    fontSize: '13px',
                    lineHeight: 1.5,
                  }}
                >
                  {selectedIncident.description}
                </div>
              </div>

              {/* Incident Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                <div style={{ background: 'var(--surface-secondary)', padding: '10px', borderRadius: 'var(--radius-control)' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Category:</div>
                  <div style={{ fontWeight: 600 }}>{selectedIncident.category.replace('_', ' ')}</div>
                </div>
                <div style={{ background: 'var(--surface-secondary)', padding: '10px', borderRadius: 'var(--radius-control)' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Location / Zone:</div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{selectedIncident.zone_name || selectedIncident.zone_id || 'Unspecified'}</span>
                    {onNavigateToCamera && selectedIncident.zone_id && (
                      <button
                        type="button"
                        className="events-subnav-btn"
                        style={{ fontSize: '10px', padding: '1px 5px' }}
                        onClick={() => onNavigateToCamera(selectedIncident.zone_id || undefined)}
                        title="View zone feed in Camera Detection"
                      >
                        Camera ➔
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ background: 'var(--surface-secondary)', padding: '10px', borderRadius: 'var(--radius-control)' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Reported By / Source:</div>
                  <div style={{ fontWeight: 600 }}>{selectedIncident.reported_by} ({selectedIncident.source})</div>
                </div>
                <div style={{ background: 'var(--surface-secondary)', padding: '10px', borderRadius: 'var(--radius-control)' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Corridor / Edge ID:</div>
                  <div style={{ fontWeight: 600 }}>
                    {selectedIncident.related_edge_id ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{selectedIncident.related_edge_id}</span>
                        {onNavigateToRouting && (
                          <button
                            type="button"
                            className="events-subnav-btn"
                            style={{ fontSize: '10px', padding: '1px 5px' }}
                            onClick={() => onNavigateToRouting(selectedIncident.related_edge_id || undefined)}
                          >
                            Inspect ➔
                          </button>
                        )}
                      </span>
                    ) : (
                      'None'
                    )}
                  </div>
                </div>
              </div>

              {/* Assignment Section */}
              <div style={{ background: 'var(--surface-secondary)', padding: '14px', borderRadius: 'var(--radius-control)' }}>
                <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>
                  Assign Incident Responsibility
                </label>
                <form onSubmit={handleAssignSubmit}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Staff / Operator ID *"
                      value={assigneeInput}
                      onChange={(e) => setAssigneeInput(e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Display Name (e.g. Officer Smith)"
                      value={assigneeNameInput}
                      onChange={(e) => setAssigneeNameInput(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Optional dispatch or tasking instructions..."
                      value={assignNoteInput}
                      onChange={(e) => setAssignNoteInput(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="routing-btn routing-btn-primary"
                      disabled={assignSubmitting}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {assignSubmitting ? 'Assigning...' : 'Assign Staff'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Lifecycle Actions */}
              <div style={{ background: 'var(--surface-secondary)', padding: '14px', borderRadius: 'var(--radius-control)' }}>
                <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>
                  Lifecycle State Transition
                </label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {selectedIncident.status === 'OPEN' && (
                    <button
                      type="button"
                      className="routing-btn"
                      onClick={() => handleStatusTransition('ACKNOWLEDGED')}
                    >
                      Acknowledge ➔
                    </button>
                  )}
                  {(selectedIncident.status === 'OPEN' || selectedIncident.status === 'ACKNOWLEDGED') && (
                    <button
                      type="button"
                      className="routing-btn routing-btn-primary"
                      onClick={() => handleStatusTransition('IN_PROGRESS')}
                    >
                      Start Response (In Progress) ➔
                    </button>
                  )}
                  {selectedIncident.status === 'IN_PROGRESS' && (
                    <button
                      type="button"
                      className="routing-btn"
                      style={{ background: '#237A57', color: '#fff', borderColor: '#237A57' }}
                      onClick={() => handleStatusTransition('RESOLVED')}
                    >
                      Mark Resolved ✓
                    </button>
                  )}
                  {selectedIncident.status === 'RESOLVED' && (
                    <button
                      type="button"
                      className="routing-btn"
                      onClick={() => handleStatusTransition('CLOSED')}
                    >
                      Close Ticket 🔒
                    </button>
                  )}
                  {selectedIncident.status === 'CLOSED' && (
                    <button
                      type="button"
                      className="routing-btn"
                      onClick={() => handleStatusTransition('OPEN')}
                    >
                      Reopen Ticket ↺
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Optional note for status transition reason..."
                  value={transitionNote}
                  onChange={(e) => setTransitionNote(e.target.value)}
                  className="form-input"
                />
              </div>

              {/* Add Note Section */}
              <form onSubmit={handleAddNote}>
                <label className="form-label">Add Operator Log Note</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Document action, radio call, or on-ground dispatch..."
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    className="form-input"
                  />
                  <button type="submit" className="routing-btn routing-btn-primary">
                    Post Note
                  </button>
                </div>
              </form>

              {/* Chronological Timeline History */}
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '4px' }}>
                  Append-Only Audit Timeline ({selectedIncident.history?.length || 0})
                </label>
                <div className="timeline-list">
                  {selectedIncident.history?.map((h) => (
                    <div key={h.id} className="timeline-item">
                      <div className="timeline-bullet" />
                      <div className="timeline-content">
                        <div className="timeline-header">
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {h.action.replace('_', ' ')}
                            {h.previous_status && h.new_status
                              ? `: ${h.previous_status} ➔ ${h.new_status}`
                              : ''}
                          </span>
                          <span>{new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        {h.note && <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>"{h.note}"</div>}
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          By: {h.operator_username || 'Authorized Operator'} • {new Date(h.timestamp).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Incident Modal */}
      {isCreateOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>File Safety Incident / Anomaly</h3>
              <button
                type="button"
                className="routing-btn"
                style={{ padding: '4px 10px' }}
                onClick={() => setIsCreateOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {createError && (
                  <div style={{ color: 'var(--status-critical)', fontSize: '13px' }}>
                    {createError}
                  </div>
                )}

                <div>
                  <label className="form-label">Incident Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Inflow Surge near Gate A Turnstiles"
                    value={createForm.title}
                    onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                    className="form-input"
                  />
                </div>

                <div className="form-row-2">
                  <div>
                    <label className="form-label">Severity Level</label>
                    <select
                      value={createForm.severity}
                      onChange={(e) => setCreateForm({ ...createForm, severity: e.target.value as IncidentSeverity })}
                      className="form-select"
                    >
                      <option value="CRITICAL">CRITICAL (Immediate safety risk)</option>
                      <option value="WARNING">WARNING (Elevated density/queue)</option>
                      <option value="ADVISORY">ADVISORY (Operator awareness)</option>
                      <option value="INFO">INFO (General telemetry note)</option>
                    </select>
                  </div>

                  <div>
                    <label className="form-label">Category</label>
                    <select
                      value={createForm.category}
                      onChange={(e) => setCreateForm({ ...createForm, category: e.target.value as IncidentCategory })}
                      className="form-select"
                    >
                      <option value="CROWD_DENSITY">Crowd Density / Surge</option>
                      <option value="PERIMETER_BREACH">Perimeter Breach</option>
                      <option value="MEDICAL">Medical Emergency</option>
                      <option value="FIRE_HAZARD">Fire Hazard</option>
                      <option value="INFRASTRUCTURE">Infrastructure Failure</option>
                      <option value="LOST_PERSON">Lost Person / Child</option>
                      <option value="OPERATIONAL">Operational Disruption</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label">Associated Zone</label>
                  <select
                    value={createForm.zone_id}
                    onChange={(e) => {
                      const z = FICTIONAL_VENUE.zones.find((item) => item.id === e.target.value);
                      setCreateForm({
                        ...createForm,
                        zone_id: e.target.value,
                        zone_name: z ? z.name : '',
                      });
                    }}
                    className="form-select"
                  >
                    <option value="">Select Monitored Zone (Optional)...</option>
                    {FICTIONAL_VENUE.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.code} - {z.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row-2">
                  <div>
                    <label className="form-label">Camera ID (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. CAM-01-N"
                      value={createForm.camera_id}
                      onChange={(e) => setCreateForm({ ...createForm, camera_id: e.target.value })}
                      className="form-input"
                    />
                  </div>

                  <div>
                    <label className="form-label">Corridor / Edge ID (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. edge_north_spine"
                      value={createForm.related_edge_id}
                      onChange={(e) => setCreateForm({ ...createForm, related_edge_id: e.target.value })}
                      className="form-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label">Source Provenance</label>
                  <select
                    value={createForm.source}
                    onChange={(e) => setCreateForm({ ...createForm, source: e.target.value })}
                    className="form-select"
                  >
                    <option value="OPERATOR_REPORTED">OPERATOR_REPORTED (Direct command center entry)</option>
                    <option value="CAMERA_ASSISTED">CAMERA_ASSISTED (Observation from CCTV telemetry)</option>
                    <option value="SIMULATION_TRIGGERED">SIMULATION_TRIGGERED (Scenario Lab what-if exercise)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">Incident Description & Context *</label>
                  <textarea
                    required
                    placeholder="Describe observed hazard, crowd condition, or operator radio report..."
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    className="form-textarea"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="routing-btn"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="routing-btn routing-btn-primary"
                >
                  {createSubmitting ? 'Logging...' : 'File Incident Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Operator Authentication Modal */}
      {showAuthModal && (
        <div className="modal-overlay" onClick={() => setShowAuthModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Operator Sign-In</h3>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Authorizes safety incidents, transitions, and notes
                </div>
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setShowAuthModal(false)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleLoginSubmit}>
              <div className="modal-body">
                {authError && (
                  <div style={{ color: 'var(--status-critical)', fontSize: '12px', marginBottom: '10px' }}>
                    {authError}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Operator Username</label>
                  <input
                    type="text"
                    className="form-input"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    className="form-input"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    required
                  />
                </div>

                <div style={{ background: 'var(--surface-secondary)', padding: '8px 12px', borderRadius: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  💡 <strong>Demo Credentials:</strong> Username: <code>operator</code> • Password: <code>OperatorPass123</code>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="events-subnav-btn" onClick={() => setShowAuthModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={authSubmitting} style={{ width: 'auto' }}>
                  {authSubmitting ? 'Authenticating...' : 'Sign In as Operator'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
