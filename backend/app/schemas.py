"""
CrowdFlow Sentinel - API Data Schemas
Pydantic schemas for health, model status, and video person detection.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(..., description="Overall health of the API ('healthy' or 'degraded')")
    timestamp: str = Field(..., description="Current ISO 8601 UTC timestamp")
    model_ready: bool = Field(..., description="Whether the person detection model is loaded and ready")
    model_name: str = Field(..., description="Name/version of the detection model")
    device: str = Field("cpu", description="Execution device ('cpu' or 'cuda')")
    person_class_id: Optional[int] = Field(0, description="Model class ID corresponding to 'person'")
    weights_present: bool = Field(..., description="Whether model weights exist on disk")
    message: str = Field(..., description="Status summary message")


class BoundingBox(BaseModel):
    box_normalized: List[float] = Field(
        ...,
        description="Normalized coordinates [ymin, xmin, ymax, xmax] scaled 0.0 to 1.0",
        min_length=4,
        max_length=4,
    )
    box_pixels: List[int] = Field(
        ...,
        description="Absolute pixel coordinates [xmin, ymin, xmax, ymax]",
        min_length=4,
        max_length=4,
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="Model confidence score")
    class_id: int = Field(0, description="Detected class index (0 for person)")
    class_name: str = Field("person", description="Detected class label")


class FrameDetection(BaseModel):
    frame_index: int = Field(..., ge=0, description="0-indexed frame number in original video")
    timestamp_sec: float = Field(..., ge=0.0, description="Offset timestamp in seconds")
    person_count: int = Field(..., ge=0, description="Number of genuine person detections in this frame")
    bounding_boxes: List[BoundingBox] = Field(default_factory=list, description="List of detected person bounding boxes")


class DetectionResponse(BaseModel):
    status: str = Field(
        ...,
        description="Outcome of the detection: 'completed', 'zero_detections', 'model_unavailable', or 'failed'",
    )
    timestamp: str = Field(..., description="Analysis completion timestamp (ISO 8601)")
    model_name: str = Field(..., description="Name of the model used for inference")
    model_ready: bool = Field(..., description="Whether model was available and loaded")
    device: str = Field("cpu", description="Compute device used")
    filename: str = Field(..., description="Name of the analyzed video file")
    video_duration_sec: float = Field(..., ge=0.0, description="Total video duration in seconds")
    video_fps: float = Field(..., ge=0.0, description="Video native framerate")
    video_resolution: str = Field(..., description="Width x Height resolution (e.g. '1280x720')")
    total_frames_sampled: int = Field(..., ge=0, description="Number of frames sampled and evaluated by model")
    max_person_count: int = Field(..., ge=0, description="Peak person count in any single sampled frame")
    total_person_detections: int = Field(..., ge=0, description="Sum of all person detections across sampled frames")
    frames: List[FrameDetection] = Field(default_factory=list, description="Frame-by-frame detection data")
    preview_frame_base64: Optional[str] = Field(
        None,
        description="Base64 data URI of the annotated key frame (peak count or first frame) as JPEG",
    )
    preview_frame_index: Optional[int] = Field(None, description="Index of the frame used for the preview")
    message: str = Field(..., description="Human-readable result summary")
    inference_duration_sec: float = Field(..., ge=0.0, description="Wall-clock time taken for model inference")


class ModelStatusResponse(HealthResponse):
    weights_path: Optional[str] = Field(None, description="Path to weight file on server")
    max_upload_size_mb: float = Field(..., description="Configured upload limit in MB")
    max_frames_to_process: int = Field(..., description="Configured max frames per video")
    default_sample_fps: float = Field(..., description="Default frame sampling rate")


class CameraDeviceInfo(BaseModel):
    id: str = Field(..., description="Identifier (e.g. '0')")
    index: int = Field(..., description="V4L2 device index (e.g. 0)")
    name: str = Field(..., description="Friendly device name (e.g. 'HP True Vision HD Camera (Built-in Webcam)')")
    raw_name: str = Field(..., description="Driver device name from sysfs")
    device_path: str = Field(..., description="Filesystem device node path (e.g. '/dev/video0')")
    device_type: str = Field("PHYSICAL", description="'PHYSICAL' for USB/built-in, 'VIRTUAL' for Iriun/DroidCam")
    is_readable: bool = Field(..., description="Whether device can produce valid video frames")
    resolution: str = Field(..., description="Native frame resolution or 'N/A'")
    error_reason: Optional[str] = Field(None, description="Detailed reason if device cannot be opened")


class CameraListResponse(BaseModel):
    cameras: List[CameraDeviceInfo] = Field(default_factory=list, description="List of discovered camera devices")
    count: int = Field(..., description="Total devices found")
    readable_count: int = Field(..., description="Number of devices confirmed readable")
    timestamp: str = Field(..., description="Discovery timestamp")


class CameraStartRequest(BaseModel):
    device_index: int = Field(0, description="V4L2 index of camera device to activate")
    conf_threshold: float = Field(0.25, ge=0.05, le=0.95, description="Model confidence threshold for person class")


class CameraStatusResponse(BaseModel):
    is_streaming: bool = Field(..., description="Whether live camera capture and inference is active")
    active_device_index: Optional[int] = Field(None, description="Active camera index")
    active_camera_name: Optional[str] = Field(None, description="Active camera name")
    model_ready: bool = Field(..., description="Whether model is loaded and ready")
    inference_fps: float = Field(0.0, description="Measured real inference FPS on CPU")
    last_person_count: int = Field(0, description="Number of persons detected in latest frame")
    active_subscribers: int = Field(0, description="Number of connected WebSocket viewers")
    error_message: Optional[str] = Field(None, description="Last runtime capture error")
    timestamp: str = Field(..., description="Current status timestamp")

