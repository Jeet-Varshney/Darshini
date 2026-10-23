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
  startLiveCamera,
  stopLiveCamera,
  createCameraWebSocket,
} from '../services/detectionApi';

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

export const CameraDetectionScreen: React.FC = () => {
  // Mode selection: Live Camera vs Uploaded Sample Video
  const [activeMode, setActiveMode] = useState<OperationMode>('live-camera');

  // Backend health & model state
  const [health, setHealth] = useState<BackendHealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Live Camera state
  const [availableCameras, setAvailableCameras] = useState<CameraDevice[]>([]);
  const [camerasLoading, setCamerasLoading] = useState<boolean>(false);
  const [camerasError, setCamerasError] = useState<string | null>(null);
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<number>(0);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isCameraStarting, setIsCameraStarting] = useState<boolean>(false);
  const [cameraStreamError, setCameraStreamError] = useState<string | null>(null);

  // Live streaming frame & telemetry
  const [liveFramePacket, setLiveFramePacket] = useState<LiveStreamPacket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // File analysis state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string | null>('gate1');
  const [confThreshold, setConfThreshold] = useState<number>(0.25);
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
      setHealthError(err.message || 'Cannot reach FastAPI backend at http://localhost:8000');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // 2. Discover available cameras on host
  const loadCameras = useCallback(async () => {
    setCamerasLoading(true);
    setCamerasError(null);
    try {
      const res = await fetchAvailableCameras();
      setAvailableCameras(res.cameras);
      // Select the first readable camera by default
      const firstReadable = res.cameras.find((c) => c.is_readable);
      if (firstReadable) {
        setSelectedCameraIndex(firstReadable.index);
      }
    } catch (err: any) {
      setCamerasError(err.message || 'Failed to discover camera devices on host.');
    } finally {
      setCamerasLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    loadCameras();
  }, [refreshHealth, loadCameras]);

  // Clean up live stream on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      stopLiveCamera().catch(() => {});
    };
  }, []);

  // 3. Start Live Camera Stream
  const handleStartCamera = async () => {
    setIsCameraStarting(true);
    setCameraStreamError(null);

    try {
      // Step A: Call backend REST to start capture
      await startLiveCamera(selectedCameraIndex, confThreshold);
      setIsCameraActive(true);

      // Step B: Connect WebSocket for live frame & metadata reception
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = createCameraWebSocket(
        (packet) => {
          if (packet.type === 'frame') {
            setLiveFramePacket(packet);
          } else if (packet.type === 'status' && packet.status === 'stopped') {
            setIsCameraActive(false);
          }
        },
        () => {
          setCameraStreamError('Live WebSocket streaming connection encountered an error.');
        },
        () => {
          setIsCameraActive(false);
        }
      );

      wsRef.current = ws;
    } catch (err: any) {
      setIsCameraActive(false);
      setCameraStreamError(err.message || 'Failed to start camera device.');
    } finally {
      setIsCameraStarting(false);
    }
  };

  // 4. Stop Live Camera Stream
  const handleStopCamera = async () => {
    try {
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({ action: 'stop' }));
        wsRef.current.close();
        wsRef.current = null;
      }
      await stopLiveCamera();
    } catch (err) {
      console.warn('Error stopping camera:', err);
    } finally {
      setIsCameraActive(false);
      setLiveFramePacket(null);
    }
  };

  // 5. File Analysis Handlers
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
      setProcessingError(err.message || 'Detection failed. Please check the backend connection.');
    } finally {
      setIsProcessing(false);
    }
  };

  const activeCameraObj = availableCameras.find((c) => c.index === selectedCameraIndex);

  return (
    <div className="detection-screen" role="tabpanel" id="panel-camera-detection" aria-labelledby="tab-camera-detection">
      {/* Top Protocol & Backend Status Banner */}
      <div className="detection-header-card">
        <div className="detection-header-left">
          <div className="detection-title-group">
            <h2 className="detection-screen-title">Universal Live Camera & Person Detection Pipeline</h2>
            <span className="detection-tag">GENUINE CV INFERENCE</span>
            <span className="detection-version-tag">YOLOv8n CPU</span>
          </div>
          <p className="detection-screen-subtitle">
            Universal camera capture supporting built-in webcams, USB devices, virtual cameras (Iriun/DroidCam), and sample video verification.
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
                title="Retry connecting to localhost:8000"
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
          <strong>OPERATIONAL TRANSPARENCY:</strong> Camera capture and inference run locally on this host using actual V4L2 device nodes and the pretrained YOLOv8 model running on CPU. Bounding boxes, confidence scores, and frame counts reflect genuine model predictions. No synthetic detections are ever substituted.
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

            {/* Camera Source Selector */}
            <div className="camera-picker-group">
              <div className="picker-header-row">
                <label htmlFor="camera-select" className="control-section-label">
                  Select Video Capture Device:
                </label>
                <button
                  type="button"
                  className="btn-refresh-cameras"
                  onClick={loadCameras}
                  disabled={camerasLoading || isCameraActive}
                  title="Rescan /sys/class/video4linux for newly connected USB or virtual devices"
                >
                  {camerasLoading ? 'Scanning...' : '↻ Rescan Devices'}
                </button>
              </div>

              {camerasError ? (
                <div className="device-scan-error">
                  <span>Warning: {camerasError}</span>
                </div>
              ) : availableCameras.length === 0 ? (
                <div className="device-scan-empty">
                  <span>No video devices detected on this host. Connect a USB webcam or virtual device.</span>
                </div>
              ) : (
                <select
                  id="camera-select"
                  className="camera-dropdown-select"
                  value={selectedCameraIndex}
                  onChange={(e) => setSelectedCameraIndex(parseInt(e.target.value, 10))}
                  disabled={isCameraActive || isCameraStarting}
                >
                  {availableCameras.map((cam) => (
                    <option
                      key={cam.id}
                      value={cam.index}
                      disabled={!cam.is_readable}
                    >
                      {cam.is_readable ? '● ' : '○ '}
                      {cam.name} [{cam.device_path}] — {cam.is_readable ? `Ready (${cam.resolution})` : `Unavailable (${cam.error_reason || 'Cannot read'})`}
                    </option>
                  ))}
                </select>
              )}

              {/* Selected Camera Specs Pill */}
              {activeCameraObj && (
                <div className="camera-spec-card">
                  <div className="spec-row">
                    <span className="spec-label">Device Node:</span>
                    <span className="spec-value font-mono">{activeCameraObj.device_path}</span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Hardware Type:</span>
                    <span className="spec-value">
                      <span className={`type-tag ${activeCameraObj.device_type === 'VIRTUAL' ? 'type-tag-virtual' : 'type-tag-physical'}`}>
                        {activeCameraObj.device_type}
                      </span>
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Capture Readiness:</span>
                    <span className={`spec-value ${activeCameraObj.is_readable ? 'spec-ready' : 'spec-unreadable'}`}>
                      {activeCameraObj.is_readable ? `Confirmed (${activeCameraObj.resolution})` : 'Unreadable / In Use'}
                    </span>
                  </div>
                </div>
              )}
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
                  disabled={isCameraActive}
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
                  disabled={
                    isCameraStarting ||
                    !health?.model_ready ||
                    !activeCameraObj ||
                    !activeCameraObj.is_readable
                  }
                >
                  {isCameraStarting ? (
                    <>
                      <span className="action-spinner" />
                      <span>Opening Device & Initiating Model Stream...</span>
                    </>
                  ) : (
                    <>
                      <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="10 8 16 12 10 16 10 8" />
                      </svg>
                      <span>Start Camera Stream</span>
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

            {/* Error Notification Banner */}
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
                  <strong>Camera Error:</strong> {cameraStreamError}
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
              <span className={`panel-card-badge ${isCameraActive ? 'badge-status-completed' : 'badge-status-other'}`}>
                {isCameraActive ? 'LIVE ACTIVE' : 'STREAM STANDBY'}
              </span>
            </div>

            {/* Live Metrics Row */}
            <div className="metrics-summary-row">
              <div className="metric-box">
                <span className="metric-box-label">CURRENT PERSON COUNT</span>
                <span className={`metric-box-val ${liveFramePacket && (liveFramePacket.person_count || 0) > 0 ? 'metric-val-highlight' : 'metric-val-zero'}`}>
                  {isCameraActive && liveFramePacket ? liveFramePacket.person_count ?? 0 : '—'}
                </span>
                <span className="metric-box-sub">in live frame</span>
              </div>

              <div className="metric-box">
                <span className="metric-box-label">MEASURED INFERENCE FPS</span>
                <span className="metric-box-val font-mono">
                  {isCameraActive && liveFramePacket && liveFramePacket.inference_fps !== undefined
                    ? `${liveFramePacket.inference_fps.toFixed(1)} FPS`
                    : '—'}
                </span>
                <span className="metric-box-sub">genuine CPU throughput</span>
              </div>

              <div className="metric-box">
                <span className="metric-box-label">INFERENCE LATENCY</span>
                <span className="metric-box-val font-mono">
                  {isCameraActive && liveFramePacket && liveFramePacket.inference_duration_ms !== undefined
                    ? `${liveFramePacket.inference_duration_ms.toFixed(0)} ms`
                    : '—'}
                </span>
                <span className="metric-box-sub">YOLOv8 CPU compute</span>
              </div>

              <div className="metric-box">
                <span className="metric-box-label">ACTIVE DEVICE</span>
                <span className="metric-box-val" style={{ fontSize: 'var(--text-base)', paddingTop: '6px' }}>
                  {isCameraActive ? `DEV #${selectedCameraIndex}` : 'NONE'}
                </span>
                <span className="metric-box-sub">
                  {isCameraActive && activeCameraObj ? activeCameraObj.name.substring(0, 20) : 'Standby'}
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
                  <span className="provenance-chip">LIVE INFERENCE OVERLAY</span>
                </div>

                <div className="preview-image-wrapper">
                  <img
                    src={liveFramePacket.image}
                    alt="Live camera stream with genuine bounding box detections"
                    className="preview-image"
                  />
                </div>

                {/* Live Detected Bounding Box Inspector */}
                {liveFramePacket.bounding_boxes && liveFramePacket.bounding_boxes.length > 0 && (
                  <div className="live-boxes-list">
                    <span className="live-boxes-title">
                      Detected Persons ({liveFramePacket.bounding_boxes.length}):
                    </span>
                    <div className="live-boxes-chips">
                      {liveFramePacket.bounding_boxes.map((b, idx) => (
                        <span key={idx} className="live-box-pill">
                          Person #{idx + 1}: {(b.confidence * 100).toFixed(0)}% conf • Box: [{b.box_pixels.join(', ')}]
                        </span>
                      ))}
                    </div>
                  </div>
                )}
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
                    Select a camera device from the list on the left and click <strong>Start Camera Stream</strong>. Live frames will be captured via V4L2 and processed in real time by the pretrained YOLOv8 model.
                  </p>
                  <div className="empty-state-pills">
                    <span className="empty-pill">✓ Built-in Webcams</span>
                    <span className="empty-pill">✓ USB Webcams</span>
                    <span className="empty-pill">✓ Iriun Virtual Webcam</span>
                    <span className="empty-pill">✓ DroidCam & V4L2</span>
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
                  max="0.85"
                  step="0.05"
                  value={confThreshold}
                  onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                  className="param-slider"
                  disabled={isProcessing}
                />
              </div>

              <div className="param-row" style={{ marginTop: 'var(--space-3)' }}>
                <div className="param-label-group">
                  <label htmlFor="file-fps-slider" className="param-label">
                    Sampling Rate:
                  </label>
                  <span className="param-value">{sampleFps.toFixed(1)} FPS</span>
                </div>
                <input
                  id="file-fps-slider"
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.5"
                  value={sampleFps}
                  onChange={(e) => setSampleFps(parseFloat(e.target.value))}
                  className="param-slider"
                  disabled={isProcessing}
                />
              </div>
            </div>

            <div className="action-row">
              <button
                type="button"
                className={`btn-run-inference ${isProcessing ? 'btn-run-inference-loading' : ''}`}
                onClick={handleRunFileInference}
                disabled={isProcessing || (!selectedFile && !activeSampleId) || (!health?.model_ready && !healthLoading)}
              >
                {isProcessing ? (
                  <>
                    <span className="action-spinner" />
                    <span>Processing Frames & Running YOLOv8n Inference...</span>
                  </>
                ) : (
                  <>
                    <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>Run Model Inference on Video</span>
                  </>
                )}
              </button>
            </div>

            {processingError && (
              <div className="processing-error-banner" role="alert">
                <div className="error-text-col">
                  <strong>Analysis Error:</strong> {processingError}
                </div>
                <button
                  type="button"
                  className="btn-retry-error"
                  onClick={handleRunFileInference}
                  disabled={isProcessing}
                >
                  Retry
                </button>
              </div>
            )}

            {videoPreviewUrl && (
              <div className="video-player-container">
                <div className="video-player-header">
                  <span className="video-player-title">Input Video Stream Preview</span>
                  <span className="video-player-tag">HTML5 PLAYER</span>
                </div>
                <video
                  src={videoPreviewUrl}
                  controls
                  className="video-element"
                  preload="metadata"
                />
              </div>
            )}
          </section>

          {/* RIGHT: File Inference Results */}
          <section className="detection-panel-card" aria-label="Inference Results & Evidence">
            <div className="panel-card-header">
              <h3 className="panel-card-title">2. Inference Results & Evidence</h3>
              {detectionResult && (
                <span
                  className={`panel-card-badge ${
                    detectionResult.status === 'completed'
                      ? 'badge-status-completed'
                      : detectionResult.status === 'zero_detections'
                      ? 'badge-status-zero'
                      : 'badge-status-other'
                  }`}
                >
                  {detectionResult.status.toUpperCase()}
                </span>
              )}
            </div>

            {isProcessing && (
              <div className="processing-loading-state">
                <div className="loading-card">
                  <div className="loading-orbit">
                    <div className="orbit-spinner" />
                  </div>
                  <h4 className="loading-title">Executing Computer Vision Pipeline</h4>
                  <p className="loading-desc">
                    Decoding video via OpenCV, sampling frames, and executing real YOLOv8n inference on CPU.
                  </p>
                  <div className="loading-progress-bar">
                    <div className="loading-progress-fill" />
                  </div>
                </div>
              </div>
            )}

            {!isProcessing && !detectionResult && (
              <div className="detection-empty-state">
                <div className="empty-state-card">
                  <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M15 10l5 5-5 5" />
                    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
                  </svg>
                  <h4 className="empty-state-title">Awaiting Sample Video Submission</h4>
                  <p className="empty-state-desc">
                    Select a calibration sample or upload a video file on the left panel, then click <strong>Run Model Inference on Video</strong>.
                  </p>
                </div>
              </div>
            )}

            {!isProcessing && detectionResult && (
              <div className="detection-results-view">
                <div className="metrics-summary-row">
                  <div className="metric-box">
                    <span className="metric-box-label">PEAK PERSON COUNT</span>
                    <span className={`metric-box-val ${detectionResult.max_person_count > 0 ? 'metric-val-highlight' : 'metric-val-zero'}`}>
                      {detectionResult.max_person_count}
                    </span>
                    <span className="metric-box-sub">in single frame</span>
                  </div>

                  <div className="metric-box">
                    <span className="metric-box-label">TOTAL DETECTIONS</span>
                    <span className="metric-box-val">{detectionResult.total_person_detections}</span>
                    <span className="metric-box-sub">across sampled frames</span>
                  </div>

                  <div className="metric-box">
                    <span className="metric-box-label">FRAMES SAMPLED</span>
                    <span className="metric-box-val">{detectionResult.total_frames_sampled}</span>
                    <span className="metric-box-sub">{detectionResult.video_duration_sec}s duration</span>
                  </div>

                  <div className="metric-box">
                    <span className="metric-box-label">INFERENCE TIME</span>
                    <span className="metric-box-val">{detectionResult.inference_duration_sec}s</span>
                    <span className="metric-box-sub">on {detectionResult.device.toUpperCase()}</span>
                  </div>
                </div>

                <div
                  className={`result-status-callout ${
                    detectionResult.status === 'completed'
                      ? 'status-callout-completed'
                      : 'status-callout-zero'
                  }`}
                >
                  <div className="callout-icon">
                    {detectionResult.status === 'completed' ? '✓' : 'ℹ'}
                  </div>
                  <div className="callout-body">
                    <strong>
                      {detectionResult.status === 'completed' ? 'MODEL INFERENCE VERIFIED:' : 'ZERO DETECTIONS RESULT:'}
                    </strong>{' '}
                    {detectionResult.message}
                  </div>
                </div>

                {detectionResult.preview_frame_base64 && (
                  <div className="annotated-preview-card">
                    <div className="annotated-preview-header">
                      <div>
                        <span className="annotated-preview-title">Annotated Keyframe Inspection</span>
                        <span className="annotated-preview-sub">
                          Frame #{detectionResult.preview_frame_index ?? 0} • Peak Detection Snapshot
                        </span>
                      </div>
                      <span className="provenance-chip">AUTHENTIC MODEL OUTPUT</span>
                    </div>

                    <div className="preview-image-wrapper">
                      <img
                        src={detectionResult.preview_frame_base64}
                        alt="Annotated detection preview frame from video"
                        className="preview-image"
                      />
                    </div>
                  </div>
                )}

                {/* Frame-by-Frame Inspector */}
                <div className="frame-inspector-card">
                  <div className="frame-inspector-header">
                    <span className="frame-inspector-title">Frame-by-Frame Inference Audit Log</span>
                    <span className="frame-inspector-count">{detectionResult.frames.length} Sampled Frames</span>
                  </div>

                  <div className="table-responsive-container">
                    <table className="detection-audit-table">
                      <thead>
                        <tr>
                          <th>Frame #</th>
                          <th>Timestamp</th>
                          <th>Person Count</th>
                          <th>Top Confidence</th>
                          <th>Inspect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detectionResult.frames.map((frame) => {
                          const topConf = frame.bounding_boxes.length > 0
                            ? Math.max(...frame.bounding_boxes.map((b) => b.confidence))
                            : null;
                          const isSelected = selectedFrame?.frame_index === frame.frame_index;

                          return (
                            <tr
                              key={frame.frame_index}
                              className={isSelected ? 'table-row-selected' : ''}
                              onClick={() => setSelectedFrame(frame)}
                            >
                              <td className="font-mono">#{frame.frame_index}</td>
                              <td className="font-mono">{frame.timestamp_sec.toFixed(2)}s</td>
                              <td>
                                <span className={`count-pill ${frame.person_count > 0 ? 'count-pill-active' : 'count-pill-zero'}`}>
                                  {frame.person_count} {frame.person_count === 1 ? 'person' : 'persons'}
                                </span>
                              </td>
                              <td className="font-mono">
                                {topConf !== null ? `${(topConf * 100).toFixed(1)}%` : '—'}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-table-inspect"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedFrame(frame);
                                  }}
                                >
                                  {isSelected ? 'Viewing' : 'Inspect'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {selectedFrame && (
                    <div className="selected-frame-detail">
                      <div className="selected-frame-title">
                        <span>Selected Frame #{selectedFrame.frame_index} ({selectedFrame.timestamp_sec.toFixed(2)}s)</span>
                        <span className="detail-tag">{selectedFrame.bounding_boxes.length} Detections</span>
                      </div>

                      {selectedFrame.bounding_boxes.length === 0 ? (
                        <p className="no-boxes-text">No person bounding boxes were detected in this frame.</p>
                      ) : (
                        <div className="boxes-grid">
                          {selectedFrame.bounding_boxes.map((box, idx) => (
                            <div key={idx} className="box-detail-chip">
                              <div className="box-chip-header">
                                <span className="box-chip-id">Person #{idx + 1}</span>
                                <span className="box-chip-conf">{(box.confidence * 100).toFixed(1)}% Conf</span>
                              </div>
                              <div className="box-chip-coords">
                                <span>Pixels: [{box.box_pixels.join(', ')}]</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
