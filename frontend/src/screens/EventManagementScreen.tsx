/**
 * Darshini - Event Registration, QR Check-in & Targeted SMS Operations Screen
 * Command Center screen honoring the steel-blue light theme and safety boundaries.
 */

import React, { useState, useEffect } from 'react';
import type {
  AlertDeliveriesData,
  AlertPreviewData,
  AlertRecord,
  EventRecord,
  UserProfile,
} from '../types/events';
import {
  approveAlert,
  clearStoredToken,
  composeAlert,
  createEvent,
  dispatchAlert,
  fetchAlertDeliveries,
  fetchCurrentUser,
  fetchEventAlerts,
  fetchEventCheckins,
  fetchEvents,
  getStoredToken,
  getStoredUser,
  login,
  performCheckin,
  previewAlertRecipients,
  regenerateEventQr,
  reverseCheckin,
  setupAdmin,
  updateEventStatus,
} from '../services/eventApi';

type SubTab = 'events' | 'checkin' | 'alerts';

export const EventManagementScreen: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(getStoredUser());
  const [activeTab, setActiveTab] = useState<SubTab>('events');

  // Auth modal states
  const [showAuthModal, setShowAuthModal] = useState<boolean>(!getStoredToken());
  const [authMode, setAuthMode] = useState<'login' | 'setup'>('login');
  const [authUsername, setAuthUsername] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authFullName, setAuthFullName] = useState<string>('System Administrator');
  const [authBootstrapToken, setAuthBootstrapToken] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Events state
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);

  // Create Event Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newEventName, setNewEventName] = useState<string>('');
  const [newEventVenue, setNewEventVenue] = useState<string>('Darshini Main Arena');
  const [newEventStart, setNewEventStart] = useState<string>(new Date().toISOString().slice(0, 16));
  const [newEventEnd, setNewEventEnd] = useState<string>(
    new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16)
  );
  const [newEventCapacity, setNewEventCapacity] = useState<number>(0);

  // QR Modal
  const [qrModalEvent, setQrModalEvent] = useState<EventRecord | null>(null);

  // Check-in State
  const [checkinInput, setCheckinInput] = useState<string>('');
  const [checkinFeedback, setCheckinFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [checkinsList, setCheckinsList] = useState<any[]>([]);

  // Reverse Modal
  const [reversingCheckinId, setReversingCheckinId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState<string>('');

  // Alerts State
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [alertTitle, setAlertTitle] = useState<string>('');
  const [alertBody, setAlertBody] = useState<string>('');
  const [alertSeverity, setAlertSeverity] = useState<'INFO' | 'WARNING' | 'CRITICAL'>('WARNING');
  const [alertPreview, setAlertPreview] = useState<AlertPreviewData | null>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [composing, setComposing] = useState<boolean>(false);

  // Delivery breakdown modal
  const [activeDeliveries, setActiveDeliveries] = useState<AlertDeliveriesData | null>(null);
  const [confirmDispatchAlertId, setConfirmDispatchAlertId] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    if (getStoredToken()) {
      fetchCurrentUser()
        .then((user) => setCurrentUser(user))
        .catch(() => {
          clearStoredToken();
          setCurrentUser(null);
          setShowAuthModal(true);
        });
    }
  }, []);

  const loadEvents = async () => {
    setLoadingEvents(true);
    try {
      const data = await fetchEvents();
      setEvents(data);
      if (data.length > 0 && !selectedEventId) {
        setSelectedEventId(data[0].id);
      }
    } catch {
      // Offline fallback
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      loadEvents();
    }
  }, [currentUser]);

  // Load check-ins and alerts when selectedEventId changes
  useEffect(() => {
    if (selectedEventId && currentUser) {
      fetchEventCheckins(selectedEventId).then((data) => setCheckinsList(data)).catch(() => {});
      fetchEventAlerts(selectedEventId).then((data) => setAlerts(data)).catch(() => {});
    }
  }, [selectedEventId, currentUser]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (authMode === 'login') {
        const res = await login(authUsername, authPassword);
        setCurrentUser(res.user);
        setShowAuthModal(false);
        loadEvents();
      } else {
        const res = await setupAdmin(authBootstrapToken, authUsername, authPassword, authFullName);
        setCurrentUser(res.user);
        setShowAuthModal(false);
        loadEvents();
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed.');
    }
  };

  const handleCreateEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createEvent({
        name: newEventName,
        venue_name: newEventVenue,
        start_time: new Date(newEventStart).toISOString(),
        end_time: new Date(newEventEnd).toISOString(),
        max_capacity: newEventCapacity,
      });
      setShowCreateModal(false);
      setNewEventName('');
      loadEvents();
      setSelectedEventId(created.id);
    } catch (err: any) {
      alert(`Failed to create event: ${err.message}`);
    }
  };

  const handleToggleEventStatus = async (event: EventRecord) => {
    const nextStatus = event.status === 'PUBLISHED' ? 'CLOSED' : 'PUBLISHED';
    try {
      await updateEventStatus(event.id, nextStatus);
      loadEvents();
    } catch (err: any) {
      alert(`Error updating status: ${err.message}`);
    }
  };

  const handleRegenerateQr = async (eventId: string) => {
    if (!window.confirm('Regenerating this QR code will invalidate all previously printed registration QR codes. Continue?')) {
      return;
    }
    try {
      const updated = await regenerateEventQr(eventId);
      setQrModalEvent(updated);
      loadEvents();
    } catch (err: any) {
      alert(`Error regenerating QR: ${err.message}`);
    }
  };

  const handleCheckinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkinInput.trim() || !selectedEventId) return;

    try {
      const res = await performCheckin(selectedEventId, {
        registration_code: checkinInput.trim(),
        gate_terminal: 'GATE_NORTH_TURNSTILE_1',
      });

      if (res.status === 'CHECKED_IN') {
        setCheckinFeedback({
          type: 'success',
          message: `✓ ADMITTED: ${res.attendee_name} (${res.operator_name}) at ${new Date(res.checked_in_at).toLocaleTimeString()}`,
        });
      } else {
        setCheckinFeedback({
          type: 'warning',
          message: `⚠️ ALREADY ADMITTED: ${res.attendee_name} was previously admitted.`,
        });
      }
      setCheckinInput('');
      fetchEventCheckins(selectedEventId).then((data) => setCheckinsList(data));
      loadEvents();
    } catch (err: any) {
      setCheckinFeedback({
        type: 'error',
        message: `❌ CHECK-IN REJECTED: ${err.message}`,
      });
    }
  };

  const handleReverseCheckinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingCheckinId || !selectedEventId || !reversalReason.trim()) return;

    try {
      await reverseCheckin(selectedEventId, reversingCheckinId, reversalReason.trim());
      setReversingCheckinId(null);
      setReversalReason('');
      fetchEventCheckins(selectedEventId).then((data) => setCheckinsList(data));
      loadEvents();
      alert('Check-in admission reversed. Attendee removed from emergency SMS pool.');
    } catch (err: any) {
      alert(`Failed to reverse check-in: ${err.message}`);
    }
  };

  const handlePreviewRecipients = async () => {
    if (!selectedEventId || !alertBody.trim()) {
      alert('Please enter an alert message body first.');
      return;
    }
    setPreviewing(true);
    try {
      const preview = await previewAlertRecipients(selectedEventId, alertBody, alertSeverity);
      setAlertPreview(preview);
    } catch (err: any) {
      alert(`Recipient preview failed: ${err.message}`);
    } finally {
      setPreviewing(false);
    }
  };

  const handleComposeAlertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !alertTitle.trim() || !alertBody.trim()) return;

    setComposing(true);
    try {
      await composeAlert(selectedEventId, {
        title: alertTitle.trim(),
        message_body: alertBody.trim(),
        severity: alertSeverity,
      });
      setAlertTitle('');
      setAlertBody('');
      setAlertPreview(null);
      fetchEventAlerts(selectedEventId).then((data) => setAlerts(data));
    } catch (err: any) {
      alert(`Failed to compose alert: ${err.message}`);
    } finally {
      setComposing(false);
    }
  };

  const handleApproveAlert = async (alertId: string) => {
    try {
      await approveAlert(alertId);
      fetchEventAlerts(selectedEventId).then((data) => setAlerts(data));
      alert('Critical alert approved under two-person rule.');
    } catch (err: any) {
      alert(`Approval rejected: ${err.message}`);
    }
  };

  const handleDispatchAlertConfirmed = async (alertId: string) => {
    try {
      await dispatchAlert(alertId);
      setConfirmDispatchAlertId(null);
      fetchEventAlerts(selectedEventId).then((data) => setAlerts(data));
      // Load delivery outcomes immediately
      const del = await fetchAlertDeliveries(alertId);
      setActiveDeliveries(del);
    } catch (err: any) {
      alert(`Dispatch failed: ${err.message}`);
    }
  };

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="events-workspace">
      {/* Header Bar */}
      <div className="events-header-bar">
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Event Registration, Gate Check-in & Targeted SMS
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Event-Scoped Emergency Broadcast Dispatcher • Zero Cross-Event Leakage Invariant
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div className="simulated-sms-badge" title="Local Development & Sandbox Mode: No live carrier airtime consumed.">
            <span>🛡️ SIMULATED — NO REAL SMS SENT</span>
          </div>

          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="chip" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-default)' }}>
                👤 {currentUser.username} ({currentUser.role})
              </span>
              <button
                type="button"
                className="events-subnav-btn"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => {
                  clearStoredToken();
                  setCurrentUser(null);
                  setShowAuthModal(true);
                }}
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: '13px' }}
              onClick={() => setShowAuthModal(true)}
            >
              Staff Login
            </button>
          )}
        </div>
      </div>

      {/* Subnav Tabs */}
      <div className="events-subnav">
        <button
          type="button"
          className={`events-subnav-btn ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          📅 Event Management & QR Codes
        </button>
        <button
          type="button"
          className={`events-subnav-btn ${activeTab === 'checkin' ? 'active' : ''}`}
          onClick={() => setActiveTab('checkin')}
        >
          🎟️ Gate Check-in Station ({selectedEvent ? selectedEvent.checked_in_count : 0} Admitted)
        </button>
        <button
          type="button"
          className={`events-subnav-btn ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setActiveTab('alerts')}
        >
          🚨 Targeted Emergency SMS Broadcast
        </button>
      </div>

      {/* Target Event Selector (used across Check-in & Alerts) */}
      {events.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface-primary)', padding: '10px 16px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border-default)' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            ACTIVE EVENT:
          </span>
          <select
            className="form-input"
            style={{ width: 'auto', minWidth: '280px', padding: '6px 10px', fontSize: '14px' }}
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({ev.status}) — {ev.checked_in_count} checked-in / {ev.registered_count} registered
              </option>
            ))}
          </select>
          {selectedEvent && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Venue: <strong>{selectedEvent.venue_name}</strong>
            </span>
          )}
        </div>
      )}

      {/* -----------------------------------------------------------
          TAB 1: Events Overview & QR Codes
         ----------------------------------------------------------- */}
      {activeTab === 'events' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Configured Venue Events ({events.length})
            </h2>
            <button
              type="button"
              className="btn-primary"
              style={{ width: 'auto', padding: '8px 16px', fontSize: '13px' }}
              onClick={() => setShowCreateModal(true)}
            >
              + Create New Event
            </button>
          </div>

          <table className="darshini-table">
            <thead>
              <tr>
                <th>Event Name</th>
                <th>Venue Location</th>
                <th>Lifecycle Status</th>
                <th>Registrations</th>
                <th>Checked-in Pax</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    {loadingEvents ? 'Loading events...' : 'No events created yet. Click "+ Create New Event" above.'}
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{ev.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        /{ev.slug}
                      </div>
                    </td>
                    <td>{ev.venue_name}</td>
                    <td>
                      <span className={`chip chip-${ev.status.toLowerCase()}`}>
                        {ev.status}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{ev.registered_count} {ev.max_capacity > 0 ? `/ ${ev.max_capacity}` : ''}</td>
                    <td style={{ fontWeight: 700, color: 'var(--status-positive)' }}>{ev.checked_in_count}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="events-subnav-btn"
                          style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid var(--border-default)' }}
                          onClick={() => setQrModalEvent(ev)}
                        >
                          📱 View QR Pass
                        </button>
                        <button
                          type="button"
                          className="events-subnav-btn"
                          style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid var(--border-default)' }}
                          onClick={() => handleToggleEventStatus(ev)}
                        >
                          {ev.status === 'PUBLISHED' ? 'Close Event' : 'Publish'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* -----------------------------------------------------------
          TAB 2: Gate Check-in Station (Turnstile Scanner)
         ----------------------------------------------------------- */}
      {activeTab === 'checkin' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 480px) 1fr', gap: '20px' }}>
          {/* Left: Scanner Card */}
          <div className="checkin-station-card">
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
              Turnstile Admission Scanner
            </h2>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Scan attendee QR pass or enter registration code (e.g. <code>REG-XXXX</code>).
            </div>

            <form onSubmit={handleCheckinSubmit}>
              <div className="scanner-input-row">
                <input
                  type="text"
                  className="form-input"
                  style={{ textTransform: 'uppercase', fontFamily: 'var(--font-mono)', fontSize: '16px' }}
                  placeholder="Scan or enter REG-XXXX..."
                  value={checkinInput}
                  onChange={(e) => setCheckinInput(e.target.value.toUpperCase())}
                  autoFocus
                />
                <button type="submit" className="btn-primary" style={{ width: 'auto', whiteSpace: 'nowrap' }}>
                  Admit Pass
                </button>
              </div>
            </form>

            {checkinFeedback && (
              <div className={`scanner-feedback-box scanner-feedback-${checkinFeedback.type}`}>
                {checkinFeedback.message}
              </div>
            )}

            <div style={{ background: 'var(--surface-subtle)', padding: '12px', borderRadius: 'var(--radius-control)', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <strong>Operational Check-in Rule:</strong>
              <p style={{ margin: '4px 0 0 0' }}>
                Only attendees successfully verified and admitted at this gate become eligible for emergency SMS advisories.
              </p>
            </div>
          </div>

          {/* Right: Active Admissions Table */}
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
              Admitted Attendees ({checkinsList.length})
            </h2>

            <table className="darshini-table">
              <thead>
                <tr>
                  <th>Attendee</th>
                  <th>Masked Phone</th>
                  <th>Pass Code</th>
                  <th>Admission Time</th>
                  <th>Operator</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {checkinsList.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No attendees admitted to this event yet.
                    </td>
                  </tr>
                ) : (
                  checkinsList.map((c) => (
                    <tr key={c.checkin_id}>
                      <td style={{ fontWeight: 600 }}>{c.attendee_name}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{c.phone_masked}</td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {c.registration_code}
                        </span>
                      </td>
                      <td style={{ fontSize: '12px' }}>{new Date(c.checked_in_at).toLocaleTimeString()}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{c.operator_name}</td>
                      <td>
                        <button
                          type="button"
                          className="events-subnav-btn"
                          style={{ padding: '2px 8px', fontSize: '11px', color: 'var(--status-critical)' }}
                          onClick={() => setReversingCheckinId(c.checkin_id)}
                        >
                          Reverse
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------
          TAB 3: Targeted Emergency SMS Alerts Composer
         ----------------------------------------------------------- */}
      {activeTab === 'alerts' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Left: Compose Form */}
          <div className="checkin-station-card">
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
              Compose Event-Scoped Emergency Broadcast
            </h2>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Broadcast safety instructions to checked-in attendees of <strong>{selectedEvent?.name}</strong>.
            </div>

            <form onSubmit={handleComposeAlertSubmit}>
              <div className="form-group">
                <label className="form-label">Alert Severity Level</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['INFO', 'WARNING', 'CRITICAL'] as const).map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      className={`events-subnav-btn ${alertSeverity === sev ? 'active' : ''}`}
                      style={{
                        flex: 1,
                        border: '1px solid var(--border-default)',
                        color: sev === 'CRITICAL' ? 'var(--status-critical)' : sev === 'WARNING' ? 'var(--status-warning)' : 'inherit',
                      }}
                      onClick={() => setAlertSeverity(sev)}
                    >
                      {sev === 'CRITICAL' ? '🚨 CRITICAL (Evac)' : sev === 'WARNING' ? '⚠️ WARNING' : 'ℹ️ INFO'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Alert Headline / Title *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Weather Alert: High Wind Advisory"
                  value={alertTitle}
                  onChange={(e) => setAlertTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">SMS Message Body *</label>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder="e.g. Please proceed toward covered Pavilion Gate 2. Stay away from temporary scaffolding."
                  value={alertBody}
                  onChange={(e) => setAlertBody(e.target.value)}
                  required
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>{alertBody.length} characters • {Math.ceil(alertBody.length / 160) || 1} SMS segment(s)</span>
                  <span>Max 1000 characters</span>
                </div>
              </div>

              {/* Recipient preview box */}
              {alertPreview && (
                <div style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-default)', padding: '12px', borderRadius: 'var(--radius-control)', marginBottom: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Recipient Preview Snapshot
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '8px', textAlign: 'center' }}>
                    <div style={{ background: 'var(--surface-primary)', padding: '6px', borderRadius: '4px' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>CHECKED-IN</div>
                      <div style={{ fontSize: '16px', fontWeight: 700 }}>{alertPreview.currently_checked_in}</div>
                    </div>
                    <div style={{ background: 'var(--status-positive-bg)', padding: '6px', borderRadius: '4px' }}>
                      <div style={{ fontSize: '11px', color: 'var(--status-positive)' }}>ELIGIBLE</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--status-positive)' }}>{alertPreview.eligible_recipients}</div>
                    </div>
                    <div style={{ background: 'var(--surface-primary)', padding: '6px', borderRadius: '4px' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>OPTED OUT</div>
                      <div style={{ fontSize: '16px', fontWeight: 700 }}>{alertPreview.opted_out_count}</div>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="events-subnav-btn"
                  style={{ flex: 1, border: '1px solid var(--border-default)' }}
                  onClick={handlePreviewRecipients}
                  disabled={previewing}
                >
                  {previewing ? 'Calculating...' : 'Preview Recipient Pool'}
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 1 }}
                  disabled={composing}
                >
                  {composing ? 'Saving...' : 'Create Draft Alert'}
                </button>
              </div>
            </form>
          </div>

          {/* Right: Existing Alerts Table */}
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
              Broadcast History & Approvals
            </h2>

            <table className="darshini-table">
              <thead>
                <tr>
                  <th>Title & Severity</th>
                  <th>Lifecycle Status</th>
                  <th>Recipients</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No alerts created for this event.
                    </td>
                  </tr>
                ) : (
                  alerts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{a.title}</div>
                        <div style={{ fontSize: '11px', color: a.severity === 'CRITICAL' ? 'var(--status-critical)' : 'var(--text-secondary)' }}>
                          {a.severity} • {a.alert_category}
                        </div>
                      </td>
                      <td>
                        <span className="chip" style={{
                          background: a.lifecycle_status === 'COMPLETED' ? 'var(--status-positive-bg)' : a.lifecycle_status === 'PENDING_APPROVAL' ? 'var(--status-critical-bg)' : 'var(--surface-secondary)',
                          color: a.lifecycle_status === 'COMPLETED' ? 'var(--status-positive)' : a.lifecycle_status === 'PENDING_APPROVAL' ? 'var(--status-critical)' : 'inherit',
                        }}>
                          {a.lifecycle_status}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{a.eligible_recipient_count} pax</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {a.lifecycle_status === 'PENDING_APPROVAL' && (
                            <button
                              type="button"
                              className="events-subnav-btn"
                              style={{ padding: '2px 8px', fontSize: '11px', background: 'var(--status-critical-bg)', color: 'var(--status-critical)' }}
                              onClick={() => handleApproveAlert(a.id)}
                            >
                              Approve (2-Person)
                            </button>
                          )}

                          {(a.lifecycle_status === 'DRAFT' || a.lifecycle_status === 'APPROVED') && (
                            <button
                              type="button"
                              className="btn-primary"
                              style={{ padding: '3px 8px', fontSize: '11px', width: 'auto' }}
                              onClick={() => setConfirmDispatchAlertId(a.id)}
                            >
                              Dispatch SMS
                            </button>
                          )}

                          {a.lifecycle_status === 'COMPLETED' && (
                            <button
                              type="button"
                              className="events-subnav-btn"
                              style={{ padding: '2px 8px', fontSize: '11px', border: '1px solid var(--border-default)' }}
                              onClick={async () => {
                                const del = await fetchAlertDeliveries(a.id);
                                setActiveDeliveries(del);
                              }}
                            >
                              View Delivery Audit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------
          MODAL 1: Create Event Modal
         ----------------------------------------------------------- */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Create New Event</h2>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setShowCreateModal(false)}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleCreateEventSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Event Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. National Robotics & Safety Expo 2026"
                    value={newEventName}
                    onChange={(e) => setNewEventName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Venue Location *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newEventVenue}
                    onChange={(e) => setNewEventVenue(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">Start Time</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={newEventStart}
                      onChange={(e) => setNewEventStart(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Time</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={newEventEnd}
                      onChange={(e) => setNewEventEnd(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Registration Capacity (0 = Unlimited)</label>
                  <input
                    type="number"
                    className="form-input"
                    min="0"
                    value={newEventCapacity}
                    onChange={(e) => setNewEventCapacity(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="events-subnav-btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ width: 'auto' }}>
                  Create Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------
          MODAL 2: View / Regenerate Registration QR Code
         ----------------------------------------------------------- */}
      {qrModalEvent && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign: 'center' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                Registration QR Code: {qrModalEvent.name}
              </h2>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setQrModalEvent(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div
                className="pass-qr-wrapper"
                dangerouslySetInnerHTML={{ __html: qrModalEvent.qr_svg || '' }}
              />
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px' }}>
                Public Registration URL:
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--surface-secondary)', padding: '8px', borderRadius: '4px', wordBreak: 'break-all', margin: '8px 0' }}>
                {qrModalEvent.registration_url}
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: 'auto', padding: '6px 14px', fontSize: '12px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(qrModalEvent.registration_url);
                    alert('Registration link copied to clipboard!');
                  }}
                >
                  Copy Registration Link
                </button>
                <button
                  type="button"
                  className="events-subnav-btn"
                  style={{ border: '1px solid var(--border-default)', fontSize: '12px' }}
                  onClick={() => handleRegenerateQr(qrModalEvent.id)}
                >
                  Regenerate QR (Revoke Old)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------
          MODAL 3: Reverse Check-in Confirmation
         ----------------------------------------------------------- */}
      {reversingCheckinId && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Reverse Gate Admission</h2>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setReversingCheckinId(null)}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleReverseCheckinSubmit}>
              <div className="modal-body">
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Reversing this check-in will immediately remove the attendee from future emergency SMS alert recipient snapshots.
                </p>
                <div className="form-group">
                  <label className="form-label">Reason for Reversal *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Attendee departed venue precinct"
                    value={reversalReason}
                    onChange={(e) => setReversalReason(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="events-subnav-btn" onClick={() => setReversingCheckinId(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ width: 'auto', background: 'var(--status-critical)' }}>
                  Confirm Reversal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------
          MODAL 4: Dispatch Confirmation Modal
         ----------------------------------------------------------- */}
      {confirmDispatchAlertId && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--status-critical)', margin: 0 }}>
                Confirm Emergency Broadcast Dispatch
              </h2>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setConfirmDispatchAlertId(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '14px', lineHeight: 1.5 }}>
                You are about to dispatch an emergency SMS broadcast to <strong>checked-in attendees only</strong>.
              </p>
              <div style={{ background: 'var(--status-warning-bg)', border: '1px solid var(--status-warning-border)', padding: '10px', borderRadius: '4px', fontSize: '12px', color: 'var(--status-warning)' }}>
                🛡️ <strong>Invariant Enforcement:</strong> Zero cross-event delivery. Unchecked-in attendees will NOT be alerted.
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="events-subnav-btn" onClick={() => setConfirmDispatchAlertId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto', background: 'var(--status-critical)' }}
                onClick={() => handleDispatchAlertConfirmed(confirmDispatchAlertId)}
              >
                Confirm & Dispatch SMS Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------
          MODAL 5: Delivery Audit Breakdown Modal
         ----------------------------------------------------------- */}
      {activeDeliveries && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '720px' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                SMS Delivery Audit Register
              </h2>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setActiveDeliveries(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px', textAlign: 'center' }}>
                <div style={{ background: 'var(--surface-secondary)', padding: '8px', borderRadius: '6px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>QUEUED</div>
                  <div style={{ fontSize: '18px', fontWeight: 700 }}>{activeDeliveries.summary.queued}</div>
                </div>
                <div style={{ background: 'var(--status-positive-bg)', padding: '8px', borderRadius: '6px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--status-positive)' }}>ACCEPTED</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--status-positive)' }}>{activeDeliveries.summary.accepted}</div>
                </div>
                <div style={{ background: 'var(--status-positive-bg)', padding: '8px', borderRadius: '6px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--status-positive)' }}>DELIVERED</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--status-positive)' }}>{activeDeliveries.summary.delivered}</div>
                </div>
                <div style={{ background: 'var(--status-critical-bg)', padding: '8px', borderRadius: '6px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--status-critical)' }}>FAILED</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--status-critical)' }}>{activeDeliveries.summary.failed}</div>
                </div>
              </div>

              {/* Individual Recipient Logs */}
              <table className="darshini-table" style={{ fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th>Recipient (Masked)</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Message ID</th>
                    <th>Sent Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDeliveries.deliveries.map((d) => (
                    <tr key={d.id}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{d.recipient_phone_masked}</td>
                      <td>
                        <span className="chip" style={{
                          background: d.status === 'PROVIDER_ACCEPTED' || d.status === 'DELIVERED' ? 'var(--status-positive-bg)' : 'var(--status-critical-bg)',
                          color: d.status === 'PROVIDER_ACCEPTED' || d.status === 'DELIVERED' ? 'var(--status-positive)' : 'var(--status-critical)',
                        }}>
                          {d.status}
                        </span>
                      </td>
                      <td>{d.provider_name}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{d.provider_message_id || '—'}</td>
                      <td style={{ fontSize: '11px' }}>{d.sent_at ? new Date(d.sent_at).toLocaleTimeString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => setActiveDeliveries(null)}>
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------
          MODAL 6: Authentication & Admin Setup
         ----------------------------------------------------------- */}
      {showAuthModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                {authMode === 'login' ? 'Staff Authentication Required' : 'One-Time Administrator Setup'}
              </h2>
            </div>
            <form onSubmit={handleLoginSubmit}>
              <div className="modal-body">
                {authError && (
                  <div className="scanner-feedback-box scanner-feedback-error" style={{ marginBottom: '14px', fontSize: '12px' }}>
                    ⚠️ {authError}
                  </div>
                )}

                {authMode === 'setup' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">One-Time Bootstrap Token *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Copy from backend/app/data/.bootstrap_token"
                        value={authBootstrapToken}
                        onChange={(e) => setAuthBootstrapToken(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Full Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={authFullName}
                        onChange={(e) => setAuthFullName(e.target.value)}
                      />
                    </div>
                  </>
                )}

                <div className="form-group">
                  <label className="form-label">Username *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. admin or gate_operator"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Password *</label>
                  <input
                    type="password"
                    className="form-input"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    required
                  />
                </div>

                <div style={{ textAlign: 'right', marginTop: '8px' }}>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => {
                      setAuthMode(authMode === 'login' ? 'setup' : 'login');
                      setAuthError(null);
                    }}
                  >
                    {authMode === 'login' ? 'First time setup? Use Bootstrap Token' : 'Back to Standard Login'}
                  </button>
                </div>
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn-primary">
                  {authMode === 'login' ? 'Authenticate & Enter' : 'Complete Administrator Setup'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
