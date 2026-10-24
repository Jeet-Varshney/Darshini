/**
 * Darshini - Safety Incident & Reports Type Definitions
 */

export type IncidentSeverity = 'CRITICAL' | 'WARNING' | 'ADVISORY' | 'INFO';
export type IncidentCategory =
  | 'CROWD_DENSITY'
  | 'PERIMETER_BREACH'
  | 'MEDICAL'
  | 'FIRE_HAZARD'
  | 'INFRASTRUCTURE'
  | 'LOST_PERSON'
  | 'OPERATIONAL';
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface IncidentHistoryRecord {
  id: string;
  incident_id: string;
  action: 'CREATED' | 'STATUS_CHANGE' | 'ASSIGNED' | 'NOTE_ADDED' | 'SEVERITY_CHANGE';
  previous_status?: string | null;
  new_status?: string | null;
  operator_id?: string | null;
  operator_username?: string | null;
  note?: string | null;
  timestamp: string;
}

export interface IncidentCreateRequest {
  title: string;
  description: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  zone_id?: string;
  zone_name?: string;
  camera_id?: string;
  event_id?: string;
  related_edge_id?: string;
  source?: string;
}

export interface IncidentAssignRequest {
  assigned_to: string;
  assigned_to_name?: string | null;
  note?: string | null;
}

export interface IncidentRecord {
  id: string;
  incident_number: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  status: IncidentStatus;
  zone_id?: string | null;
  zone_name?: string | null;
  camera_id?: string | null;
  event_id?: string | null;
  related_edge_id?: string | null;
  source: string;
  reported_by: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  closed_at?: string | null;
  history?: IncidentHistoryRecord[];
}

export interface IncidentSummaryMetrics {
  total_incidents: number;
  active_incidents: number;
  resolved_incidents: number;
  severity_breakdown: Record<string, number>;
  category_breakdown: Record<string, number>;
  status_breakdown: Record<string, number>;
  avg_resolution_time_minutes?: number | null;
  disclaimer: string;
}
