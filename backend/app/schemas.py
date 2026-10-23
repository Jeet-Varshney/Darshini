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
