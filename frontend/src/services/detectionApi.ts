import type {
  BackendHealthStatus,
  DetectionResponse,
  CameraListResponse,
  CameraStatusResponse,
  LiveStreamPacket,
} from '../types/detection';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

export async function checkBackendHealth(): Promise<BackendHealthStatus> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

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
      throw new Error('Connection timed out contacting backend at localhost:8000');
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
  confThreshold: number = 0.25
): Promise<CameraStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/camera/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_index: deviceIndex,
      conf_threshold: confThreshold,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail || `Failed to start camera on device index ${deviceIndex}`);
  }
  return data;
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
