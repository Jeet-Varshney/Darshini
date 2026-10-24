/**
 * Darshini - Event Registration, Check-in & SMS Types
 */

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  venue_name: string;
  venue_zone_id?: string | null;
  start_time: string;
  end_time: string;
  max_capacity: number;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
  qr_token: string;
  registration_url: string;
  qr_scan_url?: string;
  qr_svg?: string;
  created_by: string;
  created_at: string;
  registered_count: number;
  checked_in_count: number;
}

export interface PublicEventInfo {
  event_id: string;
  slug: string;
  name: string;
  description: string;
  venue_name: string;
  start_time: string;
  end_time: string;
  status: string;
  is_full: boolean;
}

export interface PublicRegistrationResponse {
  registration_code: string;
  attendee_name: string;
  phone_masked: string;
  event_name: string;
  venue_name: string;
  registered_at: string;
  pass_qr_svg: string;
  pass_url: string;
  is_existing?: boolean;
}

export interface PassDetails {
  id: string;
  event_id: string;
  attendee_name: string;
  phone_masked: string;
  registration_code: string;
  status: 'REGISTERED' | 'CHECKED_IN' | 'CANCELLED';
  opt_out_sms: number;
  registered_at: string;
  event_name: string;
  venue_name: string;
  event_status: string;
  checkin_id?: string | null;
  checked_in_at?: string | null;
  checkin_active?: number | null;
  pass_qr_svg: string;
  pass_url: string;
}

export interface CheckinResult {
  checkin_id: string;
  registration_id: string;
  attendee_name: string;
  event_id: string;
  event_name: string;
  status: 'CHECKED_IN' | 'ALREADY_CHECKED_IN';
  checked_in_at: string;
  operator_name: string;
  gate_terminal: string;
  message?: string;
}

export interface AlertRecord {
  id: string;
  event_id: string;
  title: string;
  message_body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  alert_category: string;
  lifecycle_status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'QUEUED' | 'SENDING' | 'COMPLETED' | 'FAILED';
  created_by: string;
  approved_by?: string | null;
  created_at: string;
  dispatched_at?: string | null;
  completed_at?: string | null;
  eligible_recipient_count: number;
}

export interface AlertPreviewData {
  event_id: string;
  event_name: string;
  currently_checked_in: number;
  eligible_recipients: number;
  opted_out_count: number;
  already_alerted_count: number;
  estimated_sms_segments: number;
}

export interface DeliverySummary {
  queued: number;
  accepted: number;
  delivered: number;
  failed: number;
  unknown: number;
}

export interface DeliveryRecord {
  id: string;
  recipient_phone_masked: string;
  status: 'QUEUED' | 'PROVIDER_ACCEPTED' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';
  provider_name: string;
  provider_message_id?: string | null;
  attempt_count: number;
  last_error?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
}

export interface AlertDeliveriesData {
  alert_id: string;
  summary: DeliverySummary;
  deliveries: DeliveryRecord[];
}

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  role: 'ADMIN' | 'EVENT_MANAGER' | 'CHECKIN_OPERATOR';
}
