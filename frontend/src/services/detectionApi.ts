import type {
  BackendHealthStatus,
  DetectionResponse,
  CameraListResponse,
  CameraStatusResponse,
  LiveStreamPacket,
  ZoneStatusListResponse,
  DetectionHistoryResponse,
  DetectionHistoryFilterParams,
} from '../types/detection';

const isBrowser = typeof window !== 'undefined';
const isHttps = isBrowser && window.location.protocol === 'https:';
const defaultHost = isBrowser && window.location.hostname ? window.location.hostname : 'localhost';

export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ||
  (isBrowser && window.location.port === '5173'
    ? `http://${defaultHost}:8000`
    : isBrowser && window.location.origin
    ? window.location.origin
    : `http://${defaultHost}:8000`);

export const WS_BASE_URL: string =
  import.meta.env.VITE_WS_URL ||
  (API_BASE_URL.startsWith('https://')
    ? API_BASE_URL.replace(/^https:\/\//, 'wss://')
    : API_BASE_URL.startsWith('http://')
    ? API_BASE_URL.replace(/^http:\/\//, 'ws://')
    : `${isHttps ? 'wss:' : 'ws:'}//${defaultHost}:8000`);

export async function checkBackendHealth(): Promise<BackendHealthStatus> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Health check failed with HTTP ${res.status}`);
    }

    const data: BackendHealthStatus = await res.json();
    return data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Connection timed out contacting backend at ${API_BASE_URL}`);
    }
    throw new Error(err.message || 'Cannot reach FastAPI backend server');
  }
}

export async function fetchAvailableCameras(): Promise<CameraListResponse> {
  const res = await fetch(`${API_BASE_URL}/api/cameras`);
  if (!res.ok) {
    throw new Error(`Failed to discover cameras (HTTP ${res.status})`);
  }
  return res.json();
}

export async function fetchCameraStatus(): Promise<CameraStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/camera/status`);
  if (!res.ok) {
    throw new Error(`Failed to fetch camera status (HTTP ${res.status})`);
  }
  return res.json();
}

export async function startLiveCamera(
  deviceIndex: number,
  confThreshold: number = 0.25,
  assignedZoneId?: string | null
): Promise<CameraStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/camera/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_index: deviceIndex,
      conf_threshold: confThreshold,
      assigned_zone_id: assignedZoneId || null,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail || `Failed to start camera on device index ${deviceIndex}`);
  }
  return data;
}

export async function assignCameraZone(
  deviceIndex: number,
  zoneId: string | null
): Promise<CameraStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/camera/assign-zone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_index: deviceIndex,
      zone_id: zoneId || null,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail || `Failed to assign zone '${zoneId}'`);
  }
  return data;
}

export async function fetchLiveZoneStatuses(): Promise<ZoneStatusListResponse> {
  const res = await fetch(`${API_BASE_URL}/api/zones/live-status`);
  if (!res.ok) {
    throw new Error(`Failed to fetch live zone statuses (HTTP ${res.status})`);
  }
  return res.json();
}

export async function stopLiveCamera(): Promise<CameraStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/camera/stop`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to stop camera (HTTP ${res.status})`);
  }
  return res.json();
}

export function createCameraWebSocket(
  onPacket: (pkt: LiveStreamPacket) => void,
  onError?: (err: Event) => void,
  onClose?: () => void
): WebSocket {
  const ws = new WebSocket(`${WS_BASE_URL}/ws/camera/stream`);

  ws.onmessage = (event) => {
    try {
      const packet: LiveStreamPacket = JSON.parse(event.data);
      onPacket(packet);
    } catch (e) {
      console.warn('Failed to parse WebSocket packet:', e);
    }
  };

  if (onError) {
    ws.onerror = onError;
  }

  if (onClose) {
    ws.onclose = onClose;
  }

  return ws;
}

export async function inferClientFrame(
  frameBase64: string,
  zoneId?: string | null,
  cameraName?: string,
  confThreshold: number = 0.25,
  clientId?: string
): Promise<LiveStreamPacket> {
  const res = await fetch(`${API_BASE_URL}/api/camera/infer-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: frameBase64,
      zone_id: zoneId || null,
      camera_name: cameraName || 'Browser Camera',
      conf_threshold: confThreshold,
      client_id: clientId || 'browser-client',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail || `Inference failed with HTTP ${res.status}`);
  }
  return data as LiveStreamPacket;
}

export async function runVideoDetection(
  file: File,
  confThreshold: number = 0.25,
  sampleFps: number = 1.0
): Promise<DetectionResponse> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('conf_threshold', confThreshold.toString());
  formData.append('sample_fps', sampleFps.toString());

  const controller = new AbortController();
  // Allow up to 60 seconds for video inference on CPU
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${API_BASE_URL}/api/detect/video`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data?.detail || `Inference request failed with HTTP ${res.status}`;
      throw new Error(errorMsg);
    }

    return data as DetectionResponse;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Video inference request timed out. Try a shorter video or higher sampling interval.');
    }
    throw new Error(err.message || 'Failed to communicate with detection backend.');
  }
}

export async function fetchSampleVideoFile(samplePath: string, filename: string): Promise<File> {
  const res = await fetch(samplePath);
  if (!res.ok) {
    throw new Error(`Failed to load sample clip from ${samplePath} (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  return new File([blob], filename, { type: 'video/mp4' });
}

export async function fetchDetectionHistory(
  params?: DetectionHistoryFilterParams
): Promise<DetectionHistoryResponse> {
  const query = new URLSearchParams();
  if (params?.camera_id) query.append('camera_id', params.camera_id);
  if (params?.zone_id) query.append('zone_id', params.zone_id);
  if (params?.start_time) query.append('start_time', params.start_time);
  if (params?.end_time) query.append('end_time', params.end_time);
  if (params?.limit !== undefined) query.append('limit', params.limit.toString());
  if (params?.order) query.append('order', params.order);

  const qs = query.toString();
  const url = `${API_BASE_URL}/api/detections/history${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch detection history (HTTP ${res.status})`);
  }
  return res.json();
}

