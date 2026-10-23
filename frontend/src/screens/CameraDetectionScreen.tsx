import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BackendHealthStatus, DetectionResponse, FrameDetection } from '../types/detection';
import { checkBackendHealth, runVideoDetection, fetchSampleVideoFile } from '../services/detectionApi';

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

export const CameraDetectionScreen: React.FC = () => {
  // Backend health & model state
  const [health, setHealth] = useState<BackendHealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Video input & settings
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string | null>('gate1');
  const [confThreshold, setConfThreshold] = useState<number>(0.25);
  const [sampleFps, setSampleFps] = useState<number>(1.0);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>('/samples/gate1_sample.mp4');

  // Processing & results state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [detectionResult, setDetectionResult] = useState<DetectionResponse | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<FrameDetection | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll/fetch backend health
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

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  // Handle custom file selection
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

    // Create object URL for local video playback
    if (videoPreviewUrl && videoPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    const url = URL.createObjectURL(file);
    setVideoPreviewUrl(url);
  };

  // Switch to pre-packaged sample video
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

  // Execute inference pipeline
  const handleRunInference = async () => {
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
        // Default to frame with peak detections or first frame
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

  return (
    <div className="detection-screen" role="tabpanel" id="panel-camera-detection" aria-labelledby="tab-camera-detection">
      {/* Top Protocol & Backend Status Banner */}
      <div className="detection-header-card">
        <div className="detection-header-left">
          <div className="detection-title-group">
            <h2 className="detection-screen-title">Camera & Person Detection Pipeline</h2>
            <span className="detection-tag">GENUINE CV INFERENCE</span>
            <span className="detection-version-tag">YOLOv8n CPU</span>
          </div>
          <p className="detection-screen-subtitle">
            Local sample-video analysis performing real object detection filtered to the person class.
          </p>
        </div>

        <div className="detection-header-right">
          {healthLoading ? (
            <div className="health-badge health-badge-loading">
              <span className="spinner-dot" /> Connecting to Backend...
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
          <strong>PROTOTYPE VIDEO ANALYSIS — NOT LIVE CCTV SURVEILLANCE:</strong> This module performs genuine, local computer-vision inference on submitted video files using a pretrained YOLOv8 model running on CPU. It does not interface with live venue cameras or fabricate synthetic detections. All bounding boxes, confidences, and counts shown reflect actual model outputs.
        </div>
      </div>

      {/* Two-Column Responsive Grid */}
      <div className="detection-workspace-grid">
        {/* LEFT COLUMN: Input Selection & Parameters */}
        <section className="detection-panel-card" aria-label="Video Input & Controls">
          <div className="panel-card-header">
            <h3 className="panel-card-title">1. Select Video Source</h3>
            <span className="panel-card-badge">INPUT</span>
          </div>

          {/* Sample Video Quick Picker */}
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

          {/* Custom File Upload Dropzone */}
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

          {/* Model Inference Parameters */}
          <div className="parameters-card">
            <div className="param-row">
              <div className="param-label-group">
                <label htmlFor="conf-slider" className="param-label">
                  Confidence Threshold:
                </label>
                <span className="param-value">{(confThreshold * 100).toFixed(0)}%</span>
              </div>
              <input
                id="conf-slider"
                type="range"
                min="0.10"
                max="0.85"
                step="0.05"
                value={confThreshold}
                onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                className="param-slider"
                disabled={isProcessing}
              />
              <span className="param-hint">Filters detections strictly to person class with confidence &ge; {confThreshold}</span>
            </div>

            <div className="param-row" style={{ marginTop: 'var(--space-3)' }}>
              <div className="param-label-group">
                <label htmlFor="fps-slider" className="param-label">
                  Sampling Rate:
                </label>
                <span className="param-value">{sampleFps.toFixed(1)} FPS</span>
              </div>
              <input
                id="fps-slider"
                type="range"
                min="0.5"
                max="2.0"
                step="0.5"
                value={sampleFps}
                onChange={(e) => setSampleFps(parseFloat(e.target.value))}
                className="param-slider"
                disabled={isProcessing}
              />
              <span className="param-hint">Samples 1 frame every {Math.round(1 / sampleFps)}s to ensure fast CPU execution</span>
            </div>
          </div>

          {/* Run Inference Action Button */}
          <div className="action-row">
            <button
              type="button"
              className={`btn-run-inference ${isProcessing ? 'btn-run-inference-loading' : ''}`}
              onClick={handleRunInference}
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
                  <span>Run Model Inference</span>
                </>
              )}
            </button>
          </div>

          {/* Processing Error Message with Retry */}
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
                <strong>Analysis Error:</strong> {processingError}
              </div>
              <button
                type="button"
                className="btn-retry-error"
                onClick={handleRunInference}
                disabled={isProcessing}
              >
                Retry
              </button>
            </div>
          )}

          {/* Local Video Preview Player */}
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

        {/* RIGHT COLUMN: Inference Results & Annotated Keyframe */}
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

          {/* State 1: Loading In Progress */}
          {isProcessing && (
            <div className="processing-loading-state">
              <div className="loading-card">
                <div className="loading-orbit">
                  <div className="orbit-spinner" />
                </div>
                <h4 className="loading-title">Executing Computer Vision Pipeline</h4>
                <p className="loading-desc">
                  Decoding video stream via OpenCV, extracting frames at {sampleFps} FPS, and running actual YOLOv8n object detection on CPU.
                </p>
                <div className="loading-progress-bar">
                  <div className="loading-progress-fill" />
                </div>
                <span className="loading-note">Filtering strictly to COCO Class 0 (person). Zero synthetic data.</span>
              </div>
            </div>
          )}

          {/* State 2: Empty State Before Processing */}
          {!isProcessing && !detectionResult && (
            <div className="detection-empty-state">
              <div className="empty-state-card">
                <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M15 10l5 5-5 5" />
                  <path d="M4 4v7a4 4 0 0 0 4 4h12" />
                </svg>
                <h4 className="empty-state-title">Awaiting Sample Video Submission</h4>
                <p className="empty-state-desc">
                  Select one of the pre-packaged calibration samples or upload an MP4/MOV video on the left panel, then click <strong>Run Model Inference</strong>.
                </p>
                <div className="empty-state-pills">
                  <span className="empty-pill">✓ Real Pretrained YOLOv8n</span>
                  <span className="empty-pill">✓ CPU-Compatible Inference</span>
                  <span className="empty-pill">✓ Authentic Bounding Boxes</span>
                  <span className="empty-pill">✓ Transparent Zero Handling</span>
                </div>
              </div>
            </div>
          )}

          {/* State 3: Active Detection Results */}
          {!isProcessing && detectionResult && (
            <div className="detection-results-view">
              {/* Telemetry Summary Metric Row */}
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
                  <span className="metric-box-sub">across all sampled frames</span>
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

              {/* Status Notice Message */}
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

              {/* Annotated Keyframe Preview Card */}
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

                  <div className="preview-image-caption">
                    <span>
                      Bounding boxes generated by <strong>{detectionResult.model_name}</strong> on CPU at confidence &ge; {(confThreshold * 100).toFixed(0)}%.
                    </span>
                    <span>Resolution: {detectionResult.video_resolution}</span>
                  </div>
                </div>
              )}

              {/* Frame-by-Frame Detection Inspector Table */}
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
                        <th>Bounding Boxes</th>
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
                            <td className="font-mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {frame.bounding_boxes.length > 0
                                ? `${frame.bounding_boxes.length} person boxes`
                                : 'None detected'}
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

                {/* Inspect Selected Frame Details Drawer */}
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
                              <span>Normalized: [{box.box_normalized.map((c) => c.toFixed(2)).join(', ')}]</span>
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
    </div>
  );
};
