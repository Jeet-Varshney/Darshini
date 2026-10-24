/**
 * Darshini - Safety Incident & Reports API Client
 */

import type {
  IncidentCreateRequest,
  IncidentRecord,
  IncidentSummaryMetrics,
} from '../types/incidents';
import { getStoredToken } from './eventApi';

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let err = `Request failed: ${response.status}`;
    try {
      const data = await response.json();
      if (data.detail) err = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw new Error(err);
  }
  return response.json();
}

export async function fetchIncidents(params: {
  status?: string;
  severity?: string;
  category?: string;
  zone_id?: string;
  source?: string;
  start_time?: string;
  end_time?: string;
  search?: string;
} = {}): Promise<IncidentRecord[]> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.severity) query.set('severity', params.severity);
  if (params.category) query.set('category', params.category);
  if (params.zone_id) query.set('zone_id', params.zone_id);
  if (params.source) query.set('source', params.source);
  if (params.start_time) query.set('start_time', params.start_time);
  if (params.end_time) query.set('end_time', params.end_time);
  if (params.search) query.set('search', params.search);

  const qs = query.toString() ? `?${query.toString()}` : '';
  return req<IncidentRecord[]>(`/api/v1/incidents${qs}`);
}

export async function fetchIncidentById(id: string): Promise<IncidentRecord> {
  return req<IncidentRecord>(`/api/v1/incidents/${encodeURIComponent(id)}`);
}

export async function createIncident(payload: IncidentCreateRequest): Promise<IncidentRecord> {
  return req<IncidentRecord>('/api/v1/incidents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function transitionIncidentStatus(
  id: string,
  status: string,
  note?: string
): Promise<IncidentRecord> {
  return req<IncidentRecord>(`/api/v1/incidents/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  });
}

export async function assignIncident(
  id: string,
  assignedTo: string,
  assignedToName?: string,
  note?: string
): Promise<IncidentRecord> {
  return req<IncidentRecord>(`/api/v1/incidents/${encodeURIComponent(id)}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({
      assigned_to: assignedTo,
      assigned_to_name: assignedToName,
      note,
    }),
  });
}

export async function addIncidentNote(id: string, note: string): Promise<IncidentRecord> {
  return req<IncidentRecord>(`/api/v1/incidents/${encodeURIComponent(id)}/notes`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function fetchIncidentMetrics(params: {
  start_time?: string;
  end_time?: string;
} = {}): Promise<IncidentSummaryMetrics> {
  const query = new URLSearchParams();
  if (params.start_time) query.set('start_time', params.start_time);
  if (params.end_time) query.set('end_time', params.end_time);
  const qs = query.toString() ? `?${query.toString()}` : '';
  return req<IncidentSummaryMetrics>(`/api/v1/incidents/analytics/summary${qs}`);
}

export function getIncidentCsvDownloadUrl(params: {
  status?: string;
  severity?: string;
  category?: string;
  source?: string;
  start_time?: string;
  end_time?: string;
  search?: string;
} = {}): string {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.severity) query.set('severity', params.severity);
  if (params.category) query.set('category', params.category);
  if (params.source) query.set('source', params.source);
  if (params.start_time) query.set('start_time', params.start_time);
  if (params.end_time) query.set('end_time', params.end_time);
  if (params.search) query.set('search', params.search);

  const qs = query.toString() ? `?${query.toString()}` : '';
  return `/api/v1/incidents/export/csv${qs}`;
}
