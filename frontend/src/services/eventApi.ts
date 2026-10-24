/**
 * Darshini - Event, Check-in, and SMS API Client
 * Manages JWT tokens, handles public attendee workflows, and communicates with backend services.
 */

import type {
  AlertDeliveriesData,
  AlertPreviewData,
  AlertRecord,
  CheckinResult,
  EventRecord,
  PassDetails,
  PublicEventInfo,
  PublicRegistrationResponse,
  UserProfile,
} from '../types/events';

const TOKEN_KEY = 'darshini_auth_token';
const USER_KEY = 'darshini_auth_user';

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string, user: UserProfile): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): UserProfile | null {
  const data = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.detail) {
        errorDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
      }
    } catch {
      // Use fallback error message
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------

export async function login(username: string, password: string): Promise<{ access_token: string; user: UserProfile }> {
  const data = await request<{ access_token: string; user: UserProfile }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setStoredToken(data.access_token, data.user);
  return data;
}

export async function setupAdmin(
  bootstrapToken: string,
  username: string,
  password: string,
  fullName: string
): Promise<{ access_token: string; user: UserProfile }> {
  const data = await request<{ access_token: string; user: UserProfile }>('/api/v1/auth/setup-admin', {
    method: 'POST',
    body: JSON.stringify({
      bootstrap_token: bootstrapToken,
      username,
      password,
      full_name: fullName,
    }),
  });
  setStoredToken(data.access_token, data.user);
  return data;
}

export async function fetchCurrentUser(): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/auth/me');
}

// -------------------------------------------------------------
// Public Attendee Endpoints
// -------------------------------------------------------------

export async function fetchPublicEvent(slugOrToken: string): Promise<PublicEventInfo> {
  return request<PublicEventInfo>(`/api/v1/public/events/${encodeURIComponent(slugOrToken)}`);
}

export async function registerPublicAttendee(
  slug: string,
  payload: { attendee_name: string; phone_number: string; opt_out_sms?: boolean; website_url?: string }
): Promise<PublicRegistrationResponse> {
  return request<PublicRegistrationResponse>(`/api/v1/public/events/${encodeURIComponent(slug)}/register`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPass(registrationCode: string): Promise<PassDetails> {
  return request<PassDetails>(`/api/v1/public/pass/${encodeURIComponent(registrationCode)}`);
}

// -------------------------------------------------------------
// Management Events Endpoints
// -------------------------------------------------------------

export async function fetchEvents(status?: string): Promise<EventRecord[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<EventRecord[]>(`/api/v1/management/events${query}`);
}

export async function fetchEventById(eventId: string): Promise<EventRecord> {
  return request<EventRecord>(`/api/v1/management/events/${encodeURIComponent(eventId)}`);
}

export async function createEvent(payload: {
  name: string;
  slug?: string;
  description?: string;
  venue_name: string;
  venue_zone_id?: string;
  start_time: string;
  end_time: string;
  max_capacity?: number;
}): Promise<EventRecord> {
  return request<EventRecord>('/api/v1/management/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateEventStatus(eventId: string, status: string): Promise<EventRecord> {
  return request<EventRecord>(`/api/v1/management/events/${encodeURIComponent(eventId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function regenerateEventQr(eventId: string): Promise<EventRecord> {
  return request<EventRecord>(`/api/v1/management/events/${encodeURIComponent(eventId)}/regenerate-qr`, {
    method: 'POST',
  });
}

// -------------------------------------------------------------
// Gate Check-in Endpoints
// -------------------------------------------------------------

export async function performCheckin(
  eventId: string,
  payload: { registration_code?: string; registration_id?: string; gate_terminal?: string }
): Promise<CheckinResult> {
  return request<CheckinResult>(`/api/v1/management/events/${encodeURIComponent(eventId)}/checkin`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function reverseCheckin(
  eventId: string,
  checkinId: string,
  reversalReason: string
): Promise<{ checkin_id: string; status: string; reversal_reason: string; reversed_at: string }> {
  return request<{ checkin_id: string; status: string; reversal_reason: string; reversed_at: string }>(
    `/api/v1/management/events/${encodeURIComponent(eventId)}/checkin/${encodeURIComponent(checkinId)}/reverse`,
    {
      method: 'POST',
      body: JSON.stringify({ reversal_reason: reversalReason }),
    }
  );
}

export async function fetchEventCheckins(eventId: string): Promise<any[]> {
  return request<any[]>(`/api/v1/management/events/${encodeURIComponent(eventId)}/checkins`);
}

// -------------------------------------------------------------
// Alert & SMS Endpoints
// -------------------------------------------------------------

export async function previewAlertRecipients(
  eventId: string,
  messageBody: string,
  severity: string
): Promise<AlertPreviewData> {
  return request<AlertPreviewData>(`/api/v1/management/events/${encodeURIComponent(eventId)}/alerts/preview`, {
    method: 'POST',
    body: JSON.stringify({ message_body: messageBody, severity }),
  });
}

export async function composeAlert(
  eventId: string,
  payload: { title: string; message_body: string; severity: string; alert_category?: string }
): Promise<AlertRecord> {
  return request<AlertRecord>(`/api/v1/management/events/${encodeURIComponent(eventId)}/alerts/compose`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchEventAlerts(eventId: string): Promise<AlertRecord[]> {
  return request<AlertRecord[]>(`/api/v1/management/events/${encodeURIComponent(eventId)}/alerts`);
}

export async function approveAlert(alertId: string): Promise<AlertRecord> {
  return request<AlertRecord>(`/api/v1/management/alerts/${encodeURIComponent(alertId)}/approve`, {
    method: 'POST',
  });
}

export async function dispatchAlert(alertId: string): Promise<{
  alert_id: string;
  event_id: string;
  lifecycle_status: string;
  eligible_recipients_queued: number;
  provider: string;
  is_simulated: boolean;
  dispatched_at: string;
}> {
  return request<any>(`/api/v1/management/alerts/${encodeURIComponent(alertId)}/dispatch`, {
    method: 'POST',
  });
}

export async function fetchAlertDeliveries(alertId: string): Promise<AlertDeliveriesData> {
  return request<AlertDeliveriesData>(`/api/v1/management/alerts/${encodeURIComponent(alertId)}/deliveries`);
}
