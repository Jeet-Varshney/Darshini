export interface BoundingBox {
  box_normalized: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  box_pixels: [number, number, number, number]; // [xmin, ymin, xmax, ymax]
  confidence: number;
  class_id: number;
  class_name: string;
}

export interface FrameDetection {
  frame_index: number;
  timestamp_sec: number;
  person_count: number;
  bounding_boxes: BoundingBox[];
  annotated_image?: string | null;
}

export type DetectionStatus = 'completed' | 'zero_detections' | 'model_unavailable' | 'failed';

export interface DetectionResponse {
  status: DetectionStatus;
  timestamp: string;
  model_name: string;
  model_ready: boolean;
  device: string;
  filename: string;
  video_duration_sec: number;
  video_fps: number;
  video_resolution: string;
  total_frames_sampled: number;
  max_person_count: number;
  total_person_detections: number;
  frames: FrameDetection[];
  preview_frame_base64: string | null;
  preview_frame_index: number | null;
  message: string;
  inference_duration_sec: number;
}

export interface BackendHealthStatus {
  status: string;
  timestamp: string;
  model_ready: boolean;
  model_name: string;
  device: string;
  person_class_id: number | null;
  weights_present: boolean;
  message: string;
}

export interface CameraDevice {
  id: string;
  index: number;
  name: string;
  raw_name: string;
  device_path: string;
  device_type: 'PHYSICAL' | 'VIRTUAL' | 'UNKNOWN';
  is_readable: boolean;
  resolution: string;
  error_reason: string | null;
}

export interface CameraListResponse {
  cameras: CameraDevice[];
  count: number;
  readable_count: number;
  timestamp: string;
}

export interface CameraStatusResponse {
  is_streaming: boolean;
  active_device_index: number | null;
  active_camera_name: string | null;
  assigned_zone_id?: string | null;
  assigned_zone_name?: string | null;
  model_ready: boolean;
  inference_fps: number;
  capture_fps?: number;
  last_person_count: number;
  active_subscribers: number;
  error_message: string | null;
  timestamp: string;
}

export interface LiveStreamPacket {
  type: 'frame' | 'status' | 'error';
  timestamp: string;
  camera_name?: string;
  device_index?: number;
  assigned_zone_id?: string | null;
  assigned_zone_name?: string | null;
  assigned_zone_code?: string | null;
  person_count?: number;
  tracked_persons_count?: number;
  stationary_count?: number;
  bounding_boxes?: BoundingBox[];
  detections?: Array<
    BoundingBox & {
      track_id?: number | string;
      is_stationary?: boolean;
      assigned_zone_id?: string | null;
      ground_point_pixels?: [number, number];
      ground_contact_normalized?: [number, number];
    }
  >;
  capture_fps?: number;
  inference_fps?: number;
  inference_duration_ms?: number;
  frame_age_ms?: number;
  last_inference_time?: string | null;
  is_stale?: boolean;
  data_source?: string;
  image?: string;
  status?: string;
  message?: string;
  error?: string;
}

export interface ZoneLiveStatus {
  zone_id: string;
  zone_code: string;
  zone_name: string;
  area_sqm: number;
  safe_capacity: number;
  camera_assigned: boolean;
  device_index?: number | null;
  camera_name?: string | null;
  status: 'STREAMING' | 'STALE' | 'DISCONNECTED' | 'UNASSIGNED';
  instantaneous_count?: number | null;
  density_per_sqm?: number | null;
  last_inference_time?: string | null;
  is_stale: boolean;
  data_source: 'LIVE_CAMERA_INFERENCE' | 'SIMULATED_FIXTURE';
  notes: string;
}

export interface ZoneStatusListResponse {
  zones: ZoneLiveStatus[];
  active_camera_count: number;
  timestamp: string;
  multiple_camera_disclaimer: string;
}

export interface DetectionHistoryRecord {
  id: number;
  timestamp: string;
  camera_id: string;
  camera_name: string;
  zone_id?: string | null;
  zone_name?: string | null;
  person_count: number;
  stationary_count?: number | null;
  moving_count?: number | null;
  avg_confidence?: number | null;
  inference_duration_ms?: number | null;
  data_source: string;
}

export interface DetectionHistoryResponse {
  total: number;
  limit: number;
  records: DetectionHistoryRecord[];
  camera_id?: string | null;
  zone_id?: string | null;
  timestamp: string;
}

export interface DetectionHistoryFilterParams {
  camera_id?: string;
  zone_id?: string;
  start_time?: string;
  end_time?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

