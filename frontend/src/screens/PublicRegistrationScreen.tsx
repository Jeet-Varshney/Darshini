/**
 * Darshini - Public Attendee Registration & Admission Pass Screen
 * Clean, mobile-first view rendered when ?event=slug, ?token=qr_token, or ?pass=code is present in URL.
 */

import React, { useState, useEffect } from 'react';
import type { PublicEventInfo, PublicRegistrationResponse, PassDetails } from '../types/events';
import { fetchPublicEvent, registerPublicAttendee, fetchPass } from '../services/eventApi';

interface PublicRegistrationScreenProps {
  eventSlug?: string | null;
  qrToken?: string | null;
  passCode?: string | null;
}

export const PublicRegistrationScreen: React.FC<PublicRegistrationScreenProps> = ({
  eventSlug,
  qrToken,
  passCode,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Event info for registration
  const [eventInfo, setEventInfo] = useState<PublicEventInfo | null>(null);

  // Form inputs
  const [attendeeName, setAttendeeName] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [optOutSms, setOptOutSms] = useState<boolean>(false);
  const [honeypot, setHoneypot] = useState<string>(''); // Hidden bot trap

  // Registration outcome / Pass view
  const [passData, setPassData] = useState<PublicRegistrationResponse | PassDetails | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        if (passCode) {
          // Direct pass lookup: ?pass=REG-XXXX
          const pass = await fetchPass(passCode);
          if (isMounted) setPassData(pass);
        } else if (eventSlug || qrToken) {
          // Event registration: ?event=slug or ?token=token
          const info = await fetchPublicEvent(eventSlug || qrToken!);
          if (isMounted) setEventInfo(info);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Unable to load event details.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [eventSlug, qrToken, passCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attendeeName.trim()) {
      setError('Please provide your full name.');
      return;
    }
    if (!phoneNumber.trim()) {
      setError('Please provide a valid 10-digit mobile number.');
      return;
    }

    const targetSlug = eventInfo?.slug || eventSlug || qrToken;
    if (!targetSlug) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await registerPublicAttendee(targetSlug, {
        attendee_name: attendeeName.trim(),
        phone_number: phoneNumber.trim(),
        opt_out_sms: optOutSms,
        website_url: honeypot || undefined,
      });
      setPassData(res);
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please check your inputs.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="public-attendee-shell">
        <div className="public-card" style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>Loading Event Registration...</div>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------
  // View 1: Digital Admission Pass Display
  // -----------------------------------------------------------
  if (passData) {
    const isCheckedIn = (passData as PassDetails).status === 'CHECKED_IN';

    return (
      <div className="public-attendee-shell">
        <div className="public-card">
          <div className="public-card-header">
            <span className="public-brand-badge">Darshini Verified Pass</span>
            <h1 className="public-event-title">{passData.event_name}</h1>
            <div className="public-venue-subtitle">📍 {passData.venue_name}</div>
          </div>

          <div className="public-card-body digital-pass-container">
            <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 700 }}>
              Official Entry Pass
            </div>
            <div className="pass-code-pill">{passData.registration_code}</div>

            <div style={{ margin: '12px 0' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {passData.attendee_name}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {passData.phone_masked}
              </div>
            </div>

            {/* Admission Status Badge */}
            <div style={{ margin: '14px 0' }}>
              {isCheckedIn ? (
                <span className="chip chip-published" style={{ fontSize: '12px', padding: '6px 12px' }}>
                  ✓ ADMITTED ON-SITE
                </span>
              ) : (
                <span className="chip" style={{ background: '#FEF0C7', color: '#A15C00', border: '1px solid #FEDF89', fontSize: '12px', padding: '6px 12px' }}>
                  ⏳ AWAITING GATE CHECK-IN
                </span>
              )}
            </div>

            {/* Render vector QR code */}
            <div
              className="pass-qr-wrapper"
              dangerouslySetInnerHTML={{ __html: passData.pass_qr_svg }}
              title={`Pass Code: ${passData.registration_code}`}
            />

            <div className="pass-instructions">
              <strong>Instructions for Arrival:</strong>
              <p style={{ marginTop: '4px', fontSize: '12px' }}>
                Present this QR code to authorized security staff at turnstiles for gate admission.
                Emergency SMS safety broadcasts activate only after successful physical check-in.
              </p>
            </div>

            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: '20px' }}
              onClick={() => window.print()}
            >
              Print / Save Admission Pass
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------
  // View 2: Registration Form Display
  // -----------------------------------------------------------
  return (
    <div className="public-attendee-shell">
      <div className="public-card">
        <div className="public-card-header">
          <span className="public-brand-badge">Event Registration</span>
          <h1 className="public-event-title">{eventInfo?.name || 'Event Registration'}</h1>
          <div className="public-venue-subtitle">📍 {eventInfo?.venue_name || 'Venue'}</div>
        </div>

        <div className="public-card-body">
          {eventInfo?.description && (
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
              {eventInfo.description}
            </p>
          )}

          {error && (
            <div className="scanner-feedback-box scanner-feedback-error" style={{ marginBottom: '16px', fontSize: '13px' }}>
              ⚠️ {error}
            </div>
          )}

          {eventInfo?.is_full ? (
            <div className="scanner-feedback-box scanner-feedback-warning">
              ⚠️ This event has reached its maximum registration capacity.
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Bot trap honeypot */}
              <input
                type="text"
                name="website_url"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                style={{ display: 'none' }}
                tabIndex={-1}
                autoComplete="off"
              />

              <div className="form-group">
                <label className="form-label" htmlFor="attendee_name">
                  Full Name *
                </label>
                <input
                  id="attendee_name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Priya Sharma"
                  value={attendeeName}
                  onChange={(e) => setAttendeeName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="phone_number">
                  Mobile Phone Number *
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span
                    style={{
                      background: 'var(--surface-secondary)',
                      border: '1px solid var(--border-default)',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-control)',
                      fontWeight: 600,
                      fontSize: '14px',
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    🇮🇳 +91
                  </span>
                  <input
                    id="phone_number"
                    type="tel"
                    className="form-input"
                    placeholder="9876543210"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    required
                  />
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Used solely for emergency safety broadcasts after on-site check-in. Never shared.
                </span>
              </div>

              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={!optOutSms}
                    onChange={(e) => setOptOutSms(!e.target.checked)}
                  />
                  <span>
                    I consent to receive vital emergency advisories and safety instructions via SMS if checked into this event.
                  </span>
                </label>
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Registering...' : 'Register & Get Admission Pass'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
