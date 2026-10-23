import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  BackendHealthStatus,
  DetectionResponse,
  FrameDetection,
  CameraDevice,
  LiveStreamPacket,
} from '../types/detection';
import {
  checkBackendHealth,
  runVideoDetection,
  fetchSampleVideoFile,
  fetchAvailableCameras,
  fetchCameraStatus,
  startLiveCamera,
  stopLiveCamera,
  createCameraWebSocket,
  assignCameraZone,
} from '../services/detectionApi';
import { FICTIONAL_VENUE } from '../data/fictionalVenue';

interface SampleOption {
  id: string;
  name: string;
  description: string;
  path: string;
  expectedPeople: string;
}

const SAMPLE_OPTIONS: SampleOption[] = [
  {
    id: 'gate1',
    name: 'Gate 1 Concourse (Active Pedestrians)',
    description: 'COCO calibration scene with moving pedestrians and street objects.',
    path: '/samples/gate1_sample.mp4',
    expectedPeople: 'Multiple persons detected (~4 peak)',
  },
  {
    id: 'empty_zone',
    name: 'Sector 4 Concourse (Empty Precinct)',
    description: 'Clear structural sector with gates/walls and zero pedestrian presence.',
    path: '/samples/empty_zone_sample.mp4',
    expectedPeople: 'Zero persons detected (Valid baseline)',
  },
];

type OperationMode = 'live-camera' | 'sample-file';
type CameraSourceMode = 'browser' | 'server';

interface CameraDetectionScreenProps {
  initialZoneId?: string | null;
  onNavigateToZone?: (zoneId: string) => void;
}

export const CameraDetectionScreen: React.FC<CameraDetectionScreenProps> = ({
  initialZoneId,
  onNavigateToZone,
}) => {
  // Mode selection: Live Camera vs Uploaded Sample Video
  const [activeMode, setActiveMode] = useState<OperationMode>('live-camera');

  // Milestone 4: Camera Source Engine (Browser Webcam vs Server Local V4L2 Device)
  const [cameraSourceMode, setCameraSourceMode] = useState<CameraSourceMode>('browser');

  // Milestone 3: Camera-to-Zone Mapping state
  const [assignedZoneId, setAssignedZoneId] = useState<string | null>(initialZoneId || 'zone-north-plaza');

  useEffect(() => {
    if (initialZoneId) {
      setAssignedZoneId(initialZoneId);
    }
  }, [initialZoneId]);

  // Backend health & model state
  const [health, setHealth] = useState<BackendHealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Common Live Camera State
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isCameraStarting, setIsCameraStarting] = useState<boolean>(false);
  const [cameraStreamError, setCameraStreamError] = useState<string | null>(null);

  // Browser Camera Discovery & Capture State (Milestone 4 Preferred Engine)
  const [browserDevices, setBrowserDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedBrowserDeviceId, setSelectedBrowserDeviceId] = useState<string>('');
  const [browserDevicesLoading, setBrowserDevicesLoading] = useState<boolean>(false);
  const [browserDevicesError, setBrowserDevicesError] = useState<string | null>(null);

  // Server Local V4L2 State (Host Edge Appliance Mode)
  const [availableServerCameras, setAvailableServerCameras] = useState<CameraDevice[]>([]);
  const [serverCamerasLoading, setServerCamerasLoading] = useState<boolean>(false);
  const [serverCamerasError, setServerCamerasError] = useState<string | null>(null);
  const [selectedServerCameraIndex, setSelectedServerCameraIndex] = useState<number>(0);

  // Live streaming frame & telemetry
  const [liveFramePacket, setLiveFramePacket] = useState<LiveStreamPacket | null>(null);
  const [clientCaptureFps, setClientCaptureFps] = useState<number>(0.0);
  const [confThreshold, setConfThreshold] = useState<number>(0.25);

  // Refs for client frame capture loop
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureTimerRef = useRef<number | null>(null);
  const isInferringRef = useRef<boolean>(false);
  const captureTimestampsRef = useRef<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(`client-${Math.random().toString(36).substring(2, 10)}`);
  const lastInferStartTimeRef = useRef<number>(0);

  // File analysis state (Mode 2)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string | null>('gate1');
  const [sampleFps, setSampleFps] = useState<number>(1.0);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>('/samples/gate1_sample.mp4');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [detectionResult, setDetectionResult] = useState<DetectionResponse | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<FrameDetection | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Fetch backend health
  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await checkBackendHealth();
      setHealth(data);
    } catch (err: any) {
      setHealth(null);
      setHealthError(err.message || 'Cannot reach FastAPI backend server');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // 2. Discover Browser Cameras via MediaDevices API (Universal Client Devices)
  const refreshBrowserCameras = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      setBrowserDevicesError(
        'navigator.mediaDevices is not available in this browser or context. Note: HTTPS or localhost is required for browser camera access.'
      );
      return;
    }
    setBrowserDevicesLoading(true);
    setBrowserDevicesError(null);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setBrowserDevices(videoInputs);
      if (videoInputs.length > 0) {
        setSelectedBrowserDeviceId((prev) => (prev ? prev : videoInputs[0].deviceId));
      }
    } catch (err: any) {
      setBrowserDevicesError(err.message || 'Failed to enumerate browser camera devices.');
    } finally {
      setBrowserDevicesLoading(false);
    }
  }, []);

  // 3. Discover Server V4L2 Cameras (Host Hardware Mode)
  const loadServerCameras = useCallback(async () => {
    setServerCamerasLoading(true);
    setServerCamerasError(null);
    try {
      const res = await fetchAvailableCameras();
      setAvailableServerCameras(res.cameras);
      const firstReadable = res.cameras.find((c) => c.is_readable);
      if (firstReadable) {
        setSelectedServerCameraIndex(firstReadable.index);
      }
    } catch (err: any) {
      setServerCamerasError(err.message || 'Failed to discover camera devices on host.');
    } finally {
      setServerCamerasLoading(false);
    }
  }, []);

  // Helper to establish WebSocket connection with safe packet handling
  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }

    const ws = createCameraWebSocket(
      (packet) => {
        if (packet.type === 'frame') {
          isInferringRef.current = false;
          setLiveFramePacket(packet);
          setCameraStreamError(null);
        } else if (packet.type === 'error') {
          isInferringRef.current = false;
          setCameraStreamError(packet.error || 'Live camera stream encountered an error.');
        } else if (packet.type === 'status' && packet.status === 'stopped') {
          isInferringRef.current = false;
          setIsCameraActive(false);
        }
      },
      () => {
        isInferringRef.current = false;
        setCameraStreamError('Live WebSocket connection encountered a network error. Reconnecting...');
      },
      () => {
        isInferringRef.current = false;
      }
    );

    wsRef.current = ws;
    return ws;
  }, []);

  // Initial mount: load health, browser cameras, and server cameras
  useEffect(() => {
    refreshHealth();
    refreshBrowserCameras();
    loadServerCameras();

    // Check if server camera is already streaming in background
    fetchCameraStatus()
      .then((status) => {
        if (status.is_streaming) {
          setCameraSourceMode('server');
          setIsCameraActive(true);
          if (status.active_device_index !== null && status.active_device_index !== undefined) {
            setSelectedServerCameraIndex(status.active_device_index);
          }
          if (status.assigned_zone_id) {
            setAssignedZoneId(status.assigned_zone_id);
          }
          connectWebSocket();
        }
      })
      .catch(() => {});
  }, [refreshHealth, refreshBrowserCameras, loadServerCameras, connectWebSocket]);

  // Clean unmount: stop all media tracks, interval, and WebSocket
  useEffect(() => {
    return () => {
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
        captureTimerRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ action: 'client_stop', client_id: clientIdRef.current }));
        } catch (e) {}
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Handle Dynamic Zone Assignment
  const handleZoneChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newZoneId = e.target.value === 'none' ? null : e.target.value;
    setAssignedZoneId(newZoneId);

    if (isCameraActive) {
      if (cameraSourceMode === 'server') {
        try {
          await assignCameraZone(selectedServerCameraIndex, newZoneId);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'assign_zone', zone_id: newZoneId }));
          }
        } catch (err: any) {
          console.warn('Failed to assign camera zone dynamically:', err);
        }
      }
      // For browser mode, next frame sent over WebSocket automatically includes updated assignedZoneId!
    }
  };

  // Switch Browser Camera Device on the fly without stopping application
  const handleSwitchBrowserCamera = async (newDeviceId: string) => {
    setSelectedBrowserDeviceId(newDeviceId);
    if (isCameraActive && cameraSourceMode === 'browser') {
      try {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: newDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        mediaStreamRef.current = stream;
        if (hiddenVideoRef.current) {
          hiddenVideoRef.current.srcObject = stream;
          await hiddenVideoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        setCameraStreamError(`Failed to switch camera: ${err.message}`);
      }
    }
  };

  // =========================================================================
  // Browser Camera Capture Engine (Milestone 4 - Universal Webcams)
  // =========================================================================
  const handleStartBrowserCamera = async () => {
    setIsCameraStarting(true);
    setCameraStreamError(null);

    try {
      // 1. Release any previously active tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }

      // 2. Request user media with device constraint if selected
      const constraints: MediaStreamConstraints = {
        video: selectedBrowserDeviceId
          ? { deviceId: { exact: selectedBrowserDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      // Re-enumerate devices so browser populates device labels now that permission was granted
      await refreshBrowserCameras();

      // 3. Attach stream to video element and track lifecycle listeners
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.warn('Video track ended (USB device unplugged or stopped).');
          setCameraStreamError('Mobile USB camera was disconnected or stopped.');
          handleStopBrowserCamera();
        };
        videoTrack.onmute = () => {
          console.warn('Video track muted.');
          setCameraStreamError('Camera stream paused: mobile phone screen may be locked or app backgrounded.');
        };
        videoTrack.onunmute = () => {
          console.info('Video track unmuted.');
          setCameraStreamError(null);
        };
      }

      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.srcObject = stream;
        await hiddenVideoRef.current.play().catch(() => {});
      }

      // 4. Connect WebSocket
      connectWebSocket();

      // 5. Initialize Frame Dispatch Loop (bounded capacity-1 with watchdog timer, target ~12-15 FPS = 80ms)
      isInferringRef.current = false;
      lastInferStartTimeRef.current = 0;
      captureTimestampsRef.current = [];

      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
      }

      const activeDev = browserDevices.find((d) => d.deviceId === selectedBrowserDeviceId);
      const camLabel = activeDev?.label || 'Browser Camera (This Device)';

      captureTimerRef.current = window.setInterval(() => {
        if (!hiddenVideoRef.current || !offscreenCanvasRef.current) return;

        const now = Date.now();

        // Watchdog: If in-flight inference has been pending for over 2.0 seconds, force-reset the flag
        if (isInferringRef.current && now - lastInferStartTimeRef.current > 2000) {
          console.warn('Inference watchdog: pending frame timed out after 2000ms. Resetting in-flight flag.');
          isInferringRef.current = false;
        }

        // Bounded capacity-1: Skip frame if previous frame is still undergoing inference
        if (isInferringRef.current) {
          return;
        }

        const video = hiddenVideoRef.current;
        if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;

        const canvas = offscreenCanvasRef.current;
        canvas.width = Math.min(video.videoWidth, 640);
        canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const b64Data = canvas.toDataURL('image/jpeg', 0.75);

        // Record timestamp for local capture FPS calculation
        captureTimestampsRef.current.push(now);
        if (captureTimestampsRef.current.length > 20) {
          captureTimestampsRef.current.shift();
        }
        if (captureTimestampsRef.current.length >= 2) {
          const dt = (captureTimestampsRef.current[captureTimestampsRef.current.length - 1] - captureTimestampsRef.current[0]) / 1000;
          if (dt > 0) {
            setClientCaptureFps(Math.round(((captureTimestampsRef.current.length - 1) / dt) * 10) / 10);
          }
        }

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          isInferringRef.current = true;
          lastInferStartTimeRef.current = now;
          wsRef.current.send(
            JSON.stringify({
              action: 'infer_frame',
              client_id: clientIdRef.current,
              image: b64Data,
              zone_id: assignedZoneId,
              camera_name: camLabel,
              conf_threshold: confThreshold,
            })
          );
        }
      }, 80);

      setIsCameraActive(true);
    } catch (err: any) {
      setIsCameraActive(false);
      let errorMsg = err.message || 'Failed to access browser camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = 'Camera permission was denied in your browser. Allow camera permission in your browser address bar to use live detection.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg = 'No video capture device was found on this system.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMsg = 'Camera is currently busy or in use by another tab or application.';
      }
      setCameraStreamError(errorMsg);
    } finally {
      setIsCameraStarting(false);
    }
  };

  const handleStopBrowserCamera = () => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.srcObject = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ action: 'client_stop', client_id: clientIdRef.current }));
      } catch (e) {}
      wsRef.current.close();
      wsRef.current = null;
    }
    isInferringRef.current = false;
    setIsCameraActive(false);
    setLiveFramePacket(null);
    setClientCaptureFps(0);
  };

  // =========================================================================
  // Server Hardware Camera Engine (Local Host Linux V4L2 Device)
  // =========================================================================
  const handleStartServerCamera = async () => {
    setIsCameraStarting(true);
    setCameraStreamError(null);

    try {
      await startLiveCamera(selectedServerCameraIndex, confThreshold, assignedZoneId);
      setIsCameraActive(true);
      connectWebSocket();
    } catch (err: any) {
      setIsCameraActive(false);
      setCameraStreamError(err.message || 'Failed to start camera device on server host.');
    } finally {
      setIsCameraStarting(false);
    }
  };

  const handleStopServerCamera = async () => {
    try {
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({ action: 'stop' }));
        wsRef.current.close();
        wsRef.current = null;
      }
      await stopLiveCamera();
    } catch (err) {
      console.warn('Error stopping server camera:', err);
    } finally {
      setIsCameraActive(false);
      setLiveFramePacket(null);
    }
  };

  // Dispatch Start / Stop based on active source mode
  const handleStartCamera = () => {
    if (cameraSourceMode === 'browser') {
      handleStartBrowserCamera();
    } else {
      handleStartServerCamera();
    }
  };

  const handleStopCamera = () => {
    if (cameraSourceMode === 'browser') {
      handleStopBrowserCamera();
    } else {
      handleStopServerCamera();
    }
  };

  // =========================================================================
  // Mode 2: File Analysis Handlers
  // =========================================================================
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      setProcessingError('File exceeds maximum upload limit of 50 MB.');
      return;
    }

    const validExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
    const hasValidExt = validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!hasValidExt) {
      setProcessingError(`Unsupported format. Supported: ${validExtensions.join(', ')}`);
      return;
    }

    setProcessingError(null);
    setSelectedFile(file);
    setActiveSampleId(null);
    setDetectionResult(null);
    setSelectedFrame(null);

    if (videoPreviewUrl && videoPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    const url = URL.createObjectURL(file);
    setVideoPreviewUrl(url);
  };

  const handleSelectSample = (sample: SampleOption) => {
    if (videoPreviewUrl && videoPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    setSelectedFile(null);
    setActiveSampleId(sample.id);
    setVideoPreviewUrl(sample.path);
    setProcessingError(null);
    setDetectionResult(null);
    setSelectedFrame(null);
  };

  const handleRunFileInference = async () => {
    setIsProcessing(true);
    setProcessingError(null);
    setDetectionResult(null);
    setSelectedFrame(null);

    try {
      let fileToProcess: File;

      if (selectedFile) {
        fileToProcess = selectedFile;
      } else if (activeSampleId) {
        const sample = SAMPLE_OPTIONS.find((s) => s.id === activeSampleId);
        if (!sample) {
          throw new Error('Selected sample video is not configured.');
        }
        fileToProcess = await fetchSampleVideoFile(sample.path, `${sample.id}_sample.mp4`);
      } else {
        throw new Error('Please select or upload a video file first.');
      }

      const result = await runVideoDetection(fileToProcess, confThreshold, sampleFps);
      setDetectionResult(result);
      if (result.frames && result.frames.length > 0) {
        const peakIdx = result.preview_frame_index ?? 0;
        const matching = result.frames.find((f) => f.frame_index === peakIdx) || result.frames[0];
        setSelectedFrame(matching);
      }
    } catch (err: any) {
      setProcessingError(err.message || 'Detection failed. Please check backend connection.');
    } finally {
      setIsProcessing(false);
    }
  };

  const activeServerCameraObj = availableServerCameras.find((c) => c.index === selectedServerCameraIndex);
  const activeBrowserCameraObj = browserDevices.find((d) => d.deviceId === selectedBrowserDeviceId);
  const assignedZoneObj = FICTIONAL_VENUE.zones.find((z) => z.id === assignedZoneId);

  // Compute stream connection status badge
  let streamStatusText = 'STREAM STANDBY';
  let streamStatusClass = 'badge-status-other';

  if (!health?.model_ready) {
    streamStatusText = 'MODEL UNAVAILABLE';
    streamStatusClass = 'badge-status-error';
  } else if (isCameraStarting) {
    streamStatusText = 'CONNECTING...';
    streamStatusClass = 'badge-status-starting';
  } else if (isCameraActive && liveFramePacket) {
    streamStatusText = 'INFERENCE RUNNING';
    streamStatusClass = 'badge-status-completed';
  } else if (isCameraActive && !liveFramePacket) {
    streamStatusText = 'AWAITING FRAMES...';
    streamStatusClass = 'badge-status-starting';
  }

  return (
    <div className="detection-screen" role="tabpanel" id="panel-camera-detection" aria-labelledby="tab-camera-detection">
      {/* Off-screen video element with layout presence to ensure continuous hardware frame decoding */}
      <video
        ref={hiddenVideoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: '320px',
          height: '240px',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <canvas ref={offscreenCanvasRef} style={{ display: 'none' }} />

      {/* Top Protocol & Backend Status Banner */}
      <div className="detection-header-card">
        <div className="detection-header-left">
          <div className="detection-title-group">
            <h2 className="detection-screen-title">Universal Live Camera & Person Detection Pipeline</h2>
            <span className="detection-tag">GENUINE CV INFERENCE</span>
            <span className="detection-version-tag">YOLOv8n CPU</span>
          </div>
          <p className="detection-screen-subtitle">
            Universal camera capture supporting local client webcams (MacBook, USB, phone/virtual cams), server devices, and hosted model inference.
          </p>
        </div>

        <div className="detection-header-right">
          {healthLoading ? (
            <div className="health-badge health-badge-loading">
              <span className="spinner-dot" /> Checking Backend...
            </div>
          ) : health?.model_ready ? (
            <div className="health-badge health-badge-online" title={health.message}>
              <span className="status-dot-green" />
              <span>BACKEND ONLINE: {health.model_name} ({health.device.toUpperCase()})</span>
            </div>
          ) : (
            <div className="health-badge health-badge-offline" title={healthError || health?.message}>
              <span className="status-dot-red" />
              <span>MODEL UNAVAILABLE: {healthError ? 'Backend Unreachable' : health?.message}</span>
              <button
                type="button"
                className="btn-retry-health"
                onClick={refreshHealth}
                title="Retry connecting to backend"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="detection-mode-tabs" role="tablist" aria-label="Detection Pipeline Mode">
        <button
          type="button"
          role="tab"
          aria-selected={activeMode === 'live-camera'}
          className={`mode-tab-btn ${activeMode === 'live-camera' ? 'mode-tab-btn-active' : ''}`}
          onClick={() => setActiveMode('live-camera')}
        >
          <svg className="mode-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span>Universal Live Camera Feed</span>
          {isCameraActive && <span className="tab-live-pulse">LIVE</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeMode === 'sample-file'}
          className={`mode-tab-btn ${activeMode === 'sample-file' ? 'mode-tab-btn-active' : ''}`}
          onClick={() => setActiveMode('sample-file')}
        >
          <svg className="mode-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
            <line x1="7" y1="2" x2="7" y2="22" />
            <line x1="17" y1="2" x2="17" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
          </svg>
          <span>Sample & Custom Video File</span>
        </button>
      </div>

      {/* Honest Boundary & Protocol Disclaimer Banner */}
      <div className="detection-disclaimer-banner">
        <div className="disclaimer-icon-col">
          <svg className="disclaimer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div className="disclaimer-text-col">
          <strong>OPERATIONAL TRANSPARENCY:</strong> Frames are captured from the user&apos;s browser or host hardware and streamed securely to the central Darshini CV backend. Bounding boxes, confidence scores, and person IDs reflect genuine model predictions. No synthetic detections are ever substituted.
        </div>
      </div>

      {/* ==================================================================== */}
      {/* MODE 1: Universal Live Camera Feed                                    */}
      {/* ==================================================================== */}
      {activeMode === 'live-camera' && (
        <div className="detection-workspace-grid">
          {/* LEFT: Live Camera Selector & Controls */}
          <section className="detection-panel-card" aria-label="Camera Hardware Controls">
            <div className="panel-card-header">
              <h3 className="panel-card-title">1. Camera Source & Controls</h3>
              <span className={`panel-card-badge ${isCameraActive ? 'badge-status-completed' : ''}`}>
                {isCameraActive ? 'LIVE ACTIVE' : 'STANDBY'}
              </span>
            </div>

            {/* Milestone 4: Camera Engine Architecture Switcher */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label className="control-section-label">Camera Capture Engine:</label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  backgroundColor: 'var(--surface-secondary)',
                  padding: '4px',
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <button
                  type="button"
                  style={{
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-control)',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: cameraSourceMode === 'browser' ? 700 : 500,
                    backgroundColor: cameraSourceMode === 'browser' ? 'var(--accent-primary)' : 'transparent',
                    color: cameraSourceMode === 'browser' ? '#FFFFFF' : 'var(--text-secondary)',
                    cursor: isCameraActive ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => !isCameraActive && setCameraSourceMode('browser')}
                  disabled={isCameraActive}
                  title="Capture webcam directly from your browser (MacBook, USB, mobile, or virtual camera)"
                >
                  🌐 Browser Camera (Client)
                </button>

                <button
                  type="button"
                  style={{
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-control)',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: cameraSourceMode === 'server' ? 700 : 500,
                    backgroundColor: cameraSourceMode === 'server' ? 'var(--accent-primary)' : 'transparent',
                    color: cameraSourceMode === 'server' ? '#FFFFFF' : 'var(--text-secondary)',
                    cursor: isCameraActive ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => !isCameraActive && setCameraSourceMode('server')}
                  disabled={isCameraActive}
                  title="Capture from video device on the backend host system (/dev/video*)"
                >
                  🖥️ Server Hardware (V4L2)
                </button>
              </div>
            </div>

            {/* ENGINE A: BROWSER MEDIA DEVICES (Preferred Architecture) */}
            {cameraSourceMode === 'browser' ? (
              <div className="camera-picker-group">
                <div className="picker-header-row">
                  <label htmlFor="browser-camera-select" className="control-section-label">
                    Browser Video Input Device:
                  </label>
                  <button
                    type="button"
                    className="btn-refresh-cameras"
                    onClick={refreshBrowserCameras}
                    disabled={browserDevicesLoading}
                    title="Enumerate media devices connected to your browser"
                  >
                    {browserDevicesLoading ? 'Scanning...' : '↻ Rescan Inputs'}
                  </button>
                </div>

                {browserDevicesError ? (
                  <div className="device-scan-error">
                    <span>{browserDevicesError}</span>
                  </div>
                ) : browserDevices.length === 0 ? (
                  <div className="device-scan-empty">
                    <span>
                      Click <strong>Start Camera Stream</strong> to request browser camera permission, or connect a webcam.
                    </span>
                  </div>
                ) : (
                  <select
                    id="browser-camera-select"
                    className="camera-dropdown-select"
                    value={selectedBrowserDeviceId}
                    onChange={(e) => handleSwitchBrowserCamera(e.target.value)}
                  >
                    {browserDevices.map((dev, idx) => (
                      <option key={dev.deviceId || idx} value={dev.deviceId}>
                        ● {dev.label || `Camera ${idx + 1} (${dev.deviceId ? dev.deviceId.substring(0, 8) + '...' : 'Default'})`}
                      </option>
                    ))}
                  </select>
                )}

                {/* Browser Camera Specs Card */}
                <div className="camera-spec-card">
                  <div className="spec-row">
                    <span className="spec-label">Input Source:</span>
                    <span className="spec-value font-mono">
                      {activeBrowserCameraObj?.label || 'Browser Default Webcam'}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Architecture:</span>
                    <span className="spec-value">
                      <span className="type-tag type-tag-physical">
                        CLIENT BROWSER CAPTURE → CLOUD INFERENCE
                      </span>
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Device Discovery:</span>
                    <span className="spec-value spec-ready">
                      Dynamic navigator.mediaDevices ({browserDevices.length} available)
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /* ENGINE B: SERVER V4L2 DEVICES (Local Host Hardware Mode) */
              <div className="camera-picker-group">
                <div className="picker-header-row">
                  <label htmlFor="camera-select" className="control-section-label">
                    Host Video Device Node (/dev/video*):
                  </label>
                  <button
                    type="button"
                    className="btn-refresh-cameras"
                    onClick={loadServerCameras}
                    disabled={serverCamerasLoading || isCameraActive}
                    title="Rescan /sys/class/video4linux on server host"
                  >
                    {serverCamerasLoading ? 'Scanning...' : '↻ Rescan Host'}
                  </button>
                </div>

                {serverCamerasError ? (
                  <div className="device-scan-error">
                    <span>Warning: {serverCamerasError}</span>
                  </div>
                ) : availableServerCameras.length === 0 ? (
                  <div className="device-scan-empty">
                    <span>No video devices detected on server host.</span>
                  </div>
                ) : (
                  <select
                    id="camera-select"
                    className="camera-dropdown-select"
                    value={selectedServerCameraIndex}
                    onChange={(e) => setSelectedServerCameraIndex(parseInt(e.target.value, 10))}
                    disabled={isCameraActive || isCameraStarting}
                  >
                    {availableServerCameras.map((cam) => (
                      <option key={cam.id} value={cam.index} disabled={!cam.is_readable}>
                        {cam.is_readable ? '● ' : '○ '}
                        {cam.name} [{cam.device_path}] — {cam.is_readable ? `Ready (${cam.resolution})` : `Unavailable (${cam.error_reason || 'Cannot read'})`}
                      </option>
                    ))}
                  </select>
                )}

                {activeServerCameraObj && (
                  <div className="camera-spec-card">
                    <div className="spec-row">
                      <span className="spec-label">Device Node:</span>
                      <span className="spec-value font-mono">{activeServerCameraObj.device_path}</span>
                    </div>
                    <div className="spec-row">
                      <span className="spec-label">Hardware Type:</span>
                      <span className="spec-value">
                        <span className={`type-tag ${activeServerCameraObj.device_type === 'VIRTUAL' ? 'type-tag-virtual' : 'type-tag-physical'}`}>
                          {activeServerCameraObj.device_type}
                        </span>
                      </span>
                    </div>
                    <div className="spec-row">
                      <span className="spec-label">Capture Readiness:</span>
                      <span className={`spec-value ${activeServerCameraObj.is_readable ? 'spec-ready' : 'spec-unreadable'}`}>
                        {activeServerCameraObj.is_readable ? `Confirmed (${activeServerCameraObj.resolution})` : 'Unreadable / In Use'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Venue Zone Assignment */}
            <div className="zone-mapping-group">
              <div className="zone-mapping-header">
                <label htmlFor="zone-select" className="control-section-label" style={{ margin: 0 }}>
                  Assign Camera to Venue Zone:
                </label>
                {assignedZoneObj && (
                  <button
                    type="button"
                    className="btn-view-zone-map"
                    onClick={() => onNavigateToZone?.(assignedZoneId!)}
                    title="View mapped zone in Live Operations Command Map"
                  >
                    <span>📍</span>
                    <span>View in Map →</span>
                  </button>
                )}
              </div>

              <select
                id="zone-select"
                className="camera-dropdown-select"
                value={assignedZoneId || 'none'}
                onChange={handleZoneChange}
              >
                <option value="none">— Standalone / Unassigned CV Feed —</option>
                {FICTIONAL_VENUE.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.code}: {z.name} ({z.areaSqm.toLocaleString()} m² • Cap: {z.safeCapacity.toLocaleString()})
                  </option>
                ))}
              </select>

              <div className="zone-mapping-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Assignment Status:</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-badge)',
                      backgroundColor: assignedZoneObj ? 'var(--status-positive-bg)' : 'var(--surface-secondary)',
                      color: assignedZoneObj ? 'var(--status-positive)' : 'var(--text-secondary)',
                      border: '1px solid ' + (assignedZoneObj ? 'var(--status-positive-border)' : 'var(--border-default)'),
                    }}
                  >
                    {assignedZoneObj ? `MAPPED: ${assignedZoneObj.code}` : 'STANDALONE CV'}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {assignedZoneObj ? (
                    <>
                      Inference updates <strong>{assignedZoneObj.name}</strong> ({assignedZoneObj.code}). Unassigned zones preserve their baseline.
                    </>
                  ) : (
                    <>
                      Camera is not mapped to any venue zone. Detections remain in standalone CV monitor.
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Inference Confidence Parameter */}
            <div className="parameters-card">
              <div className="param-row">
                <div className="param-label-group">
                  <label htmlFor="live-conf-slider" className="param-label">
                    Confidence Filter Threshold:
                  </label>
                  <span className="param-value">{(confThreshold * 100).toFixed(0)}%</span>
                </div>
                <input
                  id="live-conf-slider"
                  type="range"
                  min="0.10"
                  max="0.85"
                  step="0.05"
                  value={confThreshold}
                  onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                  className="param-slider"
                />
                <span className="param-hint">Strictly filters live detections to person class with confidence &ge; {confThreshold}</span>
              </div>
            </div>

            {/* Live Camera Action Controls: Start / Stop */}
            <div className="camera-action-group">
              {!isCameraActive ? (
                <button
                  type="button"
                  className="btn-start-camera"
                  onClick={handleStartCamera}
                  disabled={isCameraStarting || !health?.model_ready}
                >
                  {isCameraStarting ? (
                    <>
                      <span className="action-spinner" />
                      <span>Requesting Device & Initiating Pipeline...</span>
                    </>
                  ) : (
                    <>
                      <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="10 8 16 12 10 16 10 8" />
                      </svg>
                      <span>
                        {cameraSourceMode === 'browser'
                          ? 'Start Browser Camera Stream'
                          : 'Start Server Camera Stream'}
                      </span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-stop-camera"
                  onClick={handleStopCamera}
                >
                  <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="6" y="6" width="12" height="12" />
                  </svg>
                  <span>Stop Camera Stream & Release Hardware</span>
                </button>
              )}
            </div>

            {/* Actionable Error Notification Banner */}
            {cameraStreamError && (
              <div className="processing-error-banner" role="alert">
                <div className="error-icon-col">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <div className="error-text-col">
                  <strong>Camera Notice:</strong> {cameraStreamError}
                </div>
                <button
                  type="button"
                  className="btn-retry-error"
                  onClick={handleStartCamera}
                  disabled={isCameraStarting}
                >
                  Retry
                </button>
              </div>
            )}
          </section>

          {/* RIGHT: Live Stream Canvas & Telemetry */}
          <section className="detection-panel-card" aria-label="Live Stream Telemetry">
            <div className="panel-card-header">
              <h3 className="panel-card-title">2. Live Stream & Computer Vision Telemetry</h3>
              <span className={`panel-card-badge ${streamStatusClass}`}>
                {streamStatusText}
              </span>
            </div>

            {/* Live Metrics Row */}
            <div className="metrics-summary-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
              <div className="metric-box">
                <span className="metric-box-label">CURRENT PERSON COUNT</span>
                <span className={`metric-box-val ${liveFramePacket && (liveFramePacket.person_count || 0) > 0 ? 'metric-val-highlight' : 'metric-val-zero'}`}>
                  {isCameraActive && liveFramePacket ? liveFramePacket.person_count ?? 0 : '—'}
                </span>
                <span className="metric-box-sub">instantaneous FOV</span>
              </div>

              <div className="metric-box">
                <span className="metric-box-label">SCENE TRACKING</span>
                <span className="metric-box-val font-mono">
                  {isCameraActive && liveFramePacket
                    ? `${liveFramePacket.tracked_persons_count ?? liveFramePacket.person_count ?? 0}`
                    : '—'}
                </span>
                <span className="metric-box-sub">
                  {isCameraActive && liveFramePacket
                    ? `${liveFramePacket.stationary_count ?? 0} stationary`
                    : 'stationary hysteresis'}
                </span>
              </div>

              <div className="metric-box">
                <span className="metric-box-label">CAPTURE RATE</span>
                <span className="metric-box-val font-mono">
                  {isCameraActive
                    ? cameraSourceMode === 'browser'
                      ? `${clientCaptureFps.toFixed(1)} FPS`
                      : `${(liveFramePacket?.capture_fps || 0).toFixed(1)} FPS`
                    : '—'}
                </span>
                <span className="metric-box-sub">hardware delivery</span>
              </div>

              <div className="metric-box">
                <span className="metric-box-label">INFERENCE RATE</span>
                <span className="metric-box-val font-mono">
                  {isCameraActive && liveFramePacket && liveFramePacket.inference_fps !== undefined
                    ? `${liveFramePacket.inference_fps.toFixed(1)} FPS`
                    : '—'}
                </span>
                <span className="metric-box-sub">hosted YOLOv8</span>
              </div>

              <div className="metric-box">
                <span className="metric-box-label">MAPPED ZONE</span>
                <span
                  className="metric-box-val font-mono"
                  style={{ color: assignedZoneObj ? 'var(--status-positive)' : 'var(--text-muted)' }}
                >
                  {assignedZoneObj ? assignedZoneObj.code : 'None'}
                </span>
                <span className="metric-box-sub">
                  {assignedZoneObj ? assignedZoneObj.name : 'Standalone CV'}
                </span>
              </div>
            </div>

            {/* Live Frame Viewport or Standby View */}
            {isCameraActive && liveFramePacket?.image ? (
              <div className="annotated-preview-card">
                <div className="annotated-preview-header">
                  <div>
                    <span className="annotated-preview-title">Real-Time Annotated Camera Feed</span>
                    <span className="annotated-preview-sub">
                      {liveFramePacket.camera_name} • Stream Timestamp: {liveFramePacket.timestamp.substring(11, 19)} UTC
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {liveFramePacket.inference_duration_ms !== undefined && (
                      <span className="provenance-chip" style={{ background: '#E6F4EA', color: '#137333', border: '1px solid #CEEAD6' }}>
                        INFER: {liveFramePacket.inference_duration_ms.toFixed(0)}ms
                      </span>
                    )}
                    <span className="provenance-chip">LIVE INFERENCE OVERLAY</span>
                  </div>
                </div>

                <div className="preview-image-wrapper">
                  <img
                    src={liveFramePacket.image}
                    alt="Live camera stream with genuine bounding box detections"
                    className="preview-image"
                  />
                </div>

                {/* Live Detected Bounding Box Inspector */}
                {liveFramePacket.detections && liveFramePacket.detections.length > 0 && (
                  <div className="live-boxes-list">
                    <span className="live-boxes-title">
                      Detected Persons ({liveFramePacket.detections.length}):
                    </span>
                    <div className="live-boxes-chips">
                      {liveFramePacket.detections.map((d, idx) => (
                        <span key={idx} className="live-box-pill">
                          Person #{d.track_id || idx + 1}: {(d.confidence * 100).toFixed(0)}% conf
                          {d.is_stationary ? ' [STATIONARY]' : ''} • Box: [{d.box_pixels.join(', ')}]
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Milestone 4: Operational Guardrails Notice */}
                <div
                  style={{
                    marginTop: 'var(--space-3)',
                    backgroundColor: 'var(--surface-secondary)',
                    borderRadius: 'var(--radius-control)',
                    border: '1px solid var(--border-default)',
                    padding: 'var(--space-3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.4,
                  }}
                >
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>1. Non-Accumulation Rule:</strong> Count reflects instantaneous persons in view ({liveFramePacket.person_count ?? 0} pax). Consecutive frames are never summed or accumulated across time.
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>2. Zone Isolation:</strong> This camera strictly updates {assignedZoneObj ? `${assignedZoneObj.name} (${assignedZoneObj.code})` : 'its local monitor'}. Unassigned zones preserve their baseline data.
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>3. Universal Compatibility:</strong> Supports built-in laptop webcams, external USB cameras, mobile/virtual webcams (Iriun, DroidCam, OBS).
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>4. Central Cloud Inference:</strong> Camera access is handled safely in the user&apos;s browser while YOLOv8 execution is centralized on the backend.
                  </div>
                </div>
              </div>
            ) : isCameraStarting || isCameraActive ? (
              <div className="detection-empty-state">
                <div className="empty-state-card">
                  <div className="spinner-dot" style={{ width: '24px', height: '24px', margin: '0 auto' }} />
                  <h4 className="empty-state-title">Connecting to Camera & Hosted CV Model...</h4>
                  <p className="empty-state-desc">
                    {cameraSourceMode === 'browser'
                      ? 'Acquiring browser video stream and establishing WebSocket inference channel. Live preview will appear momentarily.'
                      : `Acquiring device /dev/video${selectedServerCameraIndex} on backend host and initializing YOLOv8 stream.`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="detection-empty-state">
                <div className="empty-state-card">
                  <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <h4 className="empty-state-title">Live Camera Capture is Inactive</h4>
                  <p className="empty-state-desc">
                    {cameraSourceMode === 'browser'
                      ? 'Select your browser webcam above and click Start Browser Camera Stream. Frames will be captured locally in your browser and processed by the central YOLOv8 service.'
                      : 'Select a server video device from the list and click Start Camera Stream to capture directly from host hardware.'}
                  </p>
                  <div className="empty-state-pills">
                    <span className="empty-pill">✓ Any Compatible Device (Mac/Linux/Windows)</span>
                    <span className="empty-pill">✓ Built-in & USB Webcams</span>
                    <span className="empty-pill">✓ Iriun & DroidCam Compatible</span>
                    <span className="empty-pill">✓ Zero Local Python / YOLO Required</span>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODE 2: Sample & Custom Video File                                   */}
      {/* ==================================================================== */}
      {activeMode === 'sample-file' && (
        <div className="detection-workspace-grid">
          {/* LEFT: Sample Selection & Upload */}
          <section className="detection-panel-card" aria-label="Video Input & Controls">
            <div className="panel-card-header">
              <h3 className="panel-card-title">1. Select Sample Video</h3>
              <span className="panel-card-badge">INPUT</span>
            </div>

            <div className="sample-selector-group">
              <label className="control-section-label">Pre-Packaged Calibration Samples (1-Click Evaluation):</label>
              <div className="sample-options-list">
                {SAMPLE_OPTIONS.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    className={`sample-option-btn ${activeSampleId === sample.id ? 'sample-option-btn-active' : ''}`}
                    onClick={() => handleSelectSample(sample)}
                    disabled={isProcessing}
                  >
                    <div className="sample-btn-header">
                      <span className="sample-btn-name">{sample.name}</span>
                      {activeSampleId === sample.id && <span className="sample-active-pill">SELECTED</span>}
                    </div>
                    <div className="sample-btn-desc">{sample.description}</div>
                    <div className="sample-btn-meta">Expectation: {sample.expectedPeople}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="selector-divider">
              <span>OR UPLOAD CUSTOM VIDEO</span>
            </div>

            <div
              className={`file-dropzone ${selectedFile ? 'file-dropzone-has-file' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  fileInputRef.current?.click();
                }
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".mp4,.avi,.mov,.mkv,.webm"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
              <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {selectedFile ? (
                <div className="dropzone-file-info">
                  <span className="file-name">{selectedFile.name}</span>
                  <span className="file-size">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedFile.type || 'video'}
                  </span>
                  <span className="file-change-hint">Click to replace file</span>
                </div>
              ) : (
                <div className="dropzone-prompt">
                  <span className="prompt-primary">Click or drop custom video file here</span>
                  <span className="prompt-secondary">Supported: MP4, MOV, AVI, MKV (Max 50 MB)</span>
                </div>
              )}
            </div>

            <div className="parameters-card">
              <div className="param-row">
                <div className="param-label-group">
                  <label htmlFor="file-conf-slider" className="param-label">
                    Confidence Threshold:
                  </label>
                  <span className="param-value">{(confThreshold * 100).toFixed(0)}%</span>
                </div>
                <input
                  id="file-conf-slider"
                  type="range"
                  min="0.10"
                  max="0.80"
                  step="0.05"
                  value={confThreshold}
                  onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                  className="param-slider"
                  disabled={isProcessing}
                />
                <span className="param-hint">Minimum detector confidence for human bounding box candidate</span>
              </div>

              <div className="param-row">
                <div className="param-label-group">
                  <label htmlFor="sample-fps-slider" className="param-label">
                    Sampling Rate:
                  </label>
                  <span className="param-value">{sampleFps.toFixed(1)} FPS</span>
                </div>
                <input
                  id="sample-fps-slider"
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.5"
                  value={sampleFps}
                  onChange={(e) => setSampleFps(parseFloat(e.target.value))}
                  className="param-slider"
                  disabled={isProcessing}
                />
                <span className="param-hint">Frames sampled per second to balance CPU throughput &amp; responsiveness</span>
              </div>
            </div>

            <div className="action-button-group">
              <button
                type="button"
                className="btn-run-inference"
                onClick={handleRunFileInference}
                disabled={isProcessing || !health?.model_ready || (!selectedFile && !activeSampleId)}
              >
                {isProcessing ? (
                  <>
                    <span className="action-spinner" />
                    <span>Processing Frames on CPU...</span>
                  </>
                ) : (
                  <>
                    <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>Run Person Detection Pipeline</span>
                  </>
                )}
              </button>
            </div>

            {processingError && (
              <div className="processing-error-banner" role="alert">
                <div className="error-icon-col">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <div className="error-text-col">
                  <strong>Inference Error:</strong> {processingError}
                </div>
              </div>
            )}
          </section>

          {/* RIGHT: Video File Results Display */}
          <section className="detection-panel-card" aria-label="Video Output & Detection Results">
            <div className="panel-card-header">
              <h3 className="panel-card-title">2. Computer Vision Output &amp; Bounding Boxes</h3>
              <span className={`panel-card-badge ${detectionResult ? 'badge-status-completed' : 'badge-status-other'}`}>
                {detectionResult ? 'EVALUATION COMPLETE' : 'STANDBY'}
              </span>
            </div>

            {detectionResult ? (
              <div className="results-container">
                <div className="metrics-summary-row">
                  <div className="metric-box">
                    <span className="metric-box-label">PEAK PERSON COUNT</span>
                    <span className={`metric-box-val ${detectionResult.max_person_count > 0 ? 'metric-val-highlight' : 'metric-val-zero'}`}>
                      {detectionResult.max_person_count}
                    </span>
                    <span className="metric-box-sub">in single frame</span>
                  </div>

                  <div className="metric-box">
                    <span className="metric-box-label">PROCESSED FRAMES</span>
                    <span className="metric-box-val">{detectionResult.total_frames_sampled}</span>
                    <span className="metric-box-sub">sampled at {sampleFps} FPS</span>
                  </div>

                  <div className="metric-box">
                    <span className="metric-box-label">TOTAL INFERENCE TIME</span>
                    <span className="metric-box-val font-mono">{detectionResult.inference_duration_sec.toFixed(2)}s</span>
                    <span className="metric-box-sub">~{(detectionResult.inference_duration_sec / Math.max(1, detectionResult.total_frames_sampled)).toFixed(2)}s/frame CPU</span>
                  </div>

                  <div className="metric-box">
                    <span className="metric-box-label">DETECTION STATUS</span>
                    <span className="metric-box-val" style={{ fontSize: '13px', color: 'var(--status-positive)' }}>
                      {detectionResult.max_person_count > 0 ? 'Persons Identified' : 'Zero Persons (Baseline)'}
                    </span>
                    <span className="metric-box-sub">COCO Class: Person (0)</span>
                  </div>
                </div>

                {detectionResult.preview_frame_base64 && (
                  <div className="annotated-preview-card">
                    <div className="annotated-preview-header">
                      <div>
                        <span className="annotated-preview-title">Annotated Key Frame</span>
                        <span className="annotated-preview-sub">
                          Frame #{selectedFrame?.frame_index ?? detectionResult.preview_frame_index ?? 0} • Timestamp: {(selectedFrame?.timestamp_sec ?? 0).toFixed(2)}s • Persons: {selectedFrame?.person_count ?? detectionResult.max_person_count}
                        </span>
                      </div>
                      <span className="provenance-chip">GENUINE PREDICTION</span>
                    </div>

                    <div className="preview-image-wrapper">
                      <img
                        src={detectionResult.preview_frame_base64}
                        alt={`Annotated key frame ${detectionResult.preview_frame_index ?? 0}`}
                        className="preview-image"
                      />
                    </div>

                    {selectedFrame.bounding_boxes.length > 0 && (
                      <div className="live-boxes-list">
                        <span className="live-boxes-title">
                          Verified Bounding Boxes ({selectedFrame.bounding_boxes.length}):
                        </span>
                        <div className="live-boxes-chips">
                          {selectedFrame.bounding_boxes.map((b, idx) => (
                            <span key={idx} className="live-box-pill">
                              Person #{idx + 1}: {(b.confidence * 100).toFixed(0)}% conf • Box: [{b.box_pixels.join(', ')}]
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="detection-empty-state">
                <div className="empty-state-card">
                  <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                    <line x1="7" y1="2" x2="7" y2="22" />
                    <line x1="17" y1="2" x2="17" y2="22" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                  </svg>
                  <h4 className="empty-state-title">No Video Analysis Executed Yet</h4>
                  <p className="empty-state-desc">
                    Choose one of the sample scenes on the left or upload an MP4 clip and click <strong>Run Person Detection Pipeline</strong> to evaluate the model.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
