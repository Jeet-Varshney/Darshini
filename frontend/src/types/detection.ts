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
