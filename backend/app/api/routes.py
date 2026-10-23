import asyncio
import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status

from app.config import (
    ALLOWED_EXTENSIONS,
    MAX_UPLOAD_SIZE_BYTES,
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_SAMPLE_FPS,
    MAX_FRAMES_TO_PROCESS,
    TEMP_UPLOAD_DIR,
    MODEL_PATH,
)
from app.schemas import (
    HealthResponse,
    ModelStatusResponse,
    DetectionResponse,
    CameraDeviceInfo,
    CameraListResponse,
    CameraStartRequest,
    CameraStatusResponse,
)
from app.services.model_service import model_service, ModelUnavailableError
from app.services.video_service import VideoProcessor, VideoProcessingError
from app.services.camera_discovery import camera_discovery_service
from app.services.camera_stream import live_camera_manager

logger = logging.getLogger("crowdflow.routes")
router = APIRouter()
video_processor = VideoProcessor(model_service)


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health and model readiness check",
    description="Reports the operational status of the API and whether the YOLO model is loaded.",
)
async def get_health():
    """Separately reports API health and model inference readiness."""
    is_ready = model_service.is_ready
    weights_exist = model_service.weights_path.exists()

    if is_ready:
        msg = f"API operational. {model_service.model_name} is loaded on {model_service.device} and ready for inference."
    elif weights_exist:
        msg = "API operational. Model weights are present on disk but model has not completed initialization."
    else:
        msg = (
            f"API operational, but model weights were not found at '{model_service.weights_path}'. "
            "Inference is unavailable."
        )

    return HealthResponse(
        status="healthy",
        timestamp=datetime.now(timezone.utc).isoformat(),
        model_ready=is_ready,
        model_name=model_service.model_name if is_ready else "Unavailable",
        device=model_service.device,
        person_class_id=model_service.person_class_id if is_ready else None,
        weights_present=weights_exist,
        message=msg,
    )


@router.get(
    "/api/model/status",
    response_model=ModelStatusResponse,
    summary="Detailed model status",
    description="Returns detailed telemetry on model weights, execution constraints, and inference settings.",
)
async def get_model_status():
    """Returns detailed status of the detection model and processing limits."""
    health = await get_health()
    return ModelStatusResponse(
        status=health.status,
        timestamp=health.timestamp,
        model_ready=health.model_ready,
        model_name=health.model_name,
        device=health.device,
        person_class_id=health.person_class_id,
        weights_present=health.weights_present,
        message=health.message,
        weights_path=str(model_service.weights_path) if health.weights_present else None,
        max_upload_size_mb=round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024), 1),
        max_frames_to_process=MAX_FRAMES_TO_PROCESS,
        default_sample_fps=DEFAULT_SAMPLE_FPS,
    )


@router.post(
    "/api/detect/video",
    response_model=DetectionResponse,
    summary="Run person detection on uploaded video",
    description=(
        "Accepts a sample video file (.mp4, .avi, .mov, etc.), extracts frames, "
        "runs actual YOLO model inference filtering for class 'person', "
        "and returns frame-by-frame detections, counts, and an annotated preview frame."
    ),
)
async def detect_video(
    file: UploadFile = File(..., description="Video file to analyze"),
    conf_threshold: float = Form(
        DEFAULT_CONF_THRESHOLD,
        ge=0.05,
        le=0.95,
        description="Confidence threshold for person class filtering",
    ),
    sample_fps: float = Form(
        DEFAULT_SAMPLE_FPS,
        ge=0.2,
        le=5.0,
        description="Frame sampling rate in frames per second",
    ),
):
    """
    Validates uploaded video, enforces size limits, executes person detection,
    and reliably cleans up temporary files upon completion or failure.
    """
    # 1. Model readiness guard
    if not model_service.is_ready:
        logger.warning("Video detection requested while model is not ready.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                model_service.error_message
                or "Inference model is unavailable. Model weights are missing or failed to initialize."
            ),
        )

    # 2. File type validation
    filename = file.filename or "uploaded_video.mp4"
    file_ext = Path(filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unsupported video format '{file_ext}'. "
                f"Supported formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )

    # 3. Stream upload into temporary file with byte limit enforcement
    temp_file_id = f"upload_{uuid.uuid4().hex}{file_ext}"
    temp_file_path = TEMP_UPLOAD_DIR / temp_file_id

    total_bytes = 0
    try:
        with open(temp_file_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB chunks
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            f"Uploaded file exceeds maximum allowed size of "
                            f"{MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB."
                        ),
                    )
                buffer.write(chunk)

        if total_bytes == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty (0 bytes). Please provide a valid video.",
            )

        # 4. Execute video processing and inference
        response = video_processor.process_video(
            video_path=temp_file_path,
            filename=filename,
            conf_threshold=conf_threshold,
            sample_fps=sample_fps,
            max_frames=MAX_FRAMES_TO_PROCESS,
        )
        return response

    except VideoProcessingError as e:
        logger.warning("Video processing failed for '%s': %s", filename, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except ModelUnavailableError as e:
        logger.error("Model unavailable during inference: %s", str(e))
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error processing video '%s': %s", filename, str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred during video analysis: {str(e)}",
        )
    finally:
        # Crucial safeguard: Clean up temporary upload file immediately
        if temp_file_path.exists():
            try:
                temp_file_path.unlink()
                logger.debug("Cleaned up temporary upload file: %s", temp_file_path)
            except OSError as err:
                logger.error("Failed to delete temp file %s: %s", temp_file_path, err)


# ============================================================================
# Universal Live Camera Endpoints
# ============================================================================

@router.get(
    "/api/cameras",
    response_model=CameraListResponse,
    summary="Discover available video devices",
    description="Discovers all video devices on the host (built-in, USB, virtual) and reports frame readability.",
)
async def list_available_cameras(refresh: bool = False):
    """Discovers available video devices on the host system."""
    devices = camera_discovery_service.discover_cameras(test_read=True)
    device_objects = [CameraDeviceInfo(**d) for d in devices]
    readable_count = sum(1 for d in device_objects if d.is_readable)

    return CameraListResponse(
        cameras=device_objects,
        count=len(device_objects),
        readable_count=readable_count,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get(
    "/api/camera/status",
    response_model=CameraStatusResponse,
    summary="Get active live camera status",
    description="Returns whether live capture is active, current camera name, subscribers, and measured FPS.",
)
async def get_camera_status():
    """Returns the current state of live camera streaming and inference."""
    status_data = live_camera_manager.get_status()
    return CameraStatusResponse(
        is_streaming=status_data["is_streaming"],
        active_device_index=status_data["active_device_index"],
        active_camera_name=status_data["active_camera_name"],
        model_ready=status_data["model_ready"],
        inference_fps=status_data["inference_fps"],
        last_person_count=status_data["last_person_count"],
        active_subscribers=status_data["active_subscribers"],
        error_message=status_data["error_message"],
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post(
    "/api/camera/start",
    response_model=CameraStatusResponse,
    summary="Start live camera capture",
    description="Activates live video capture on the specified device index and initiates background model inference.",
)
async def start_camera(request: CameraStartRequest):
    """Starts live capture on a chosen camera index."""
    if not model_service.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=model_service.error_message or "Inference model is not ready.",
        )

    success = live_camera_manager.start(
        device_index=request.device_index,
        conf_threshold=request.conf_threshold,
    )
    if not success:
        err = live_camera_manager.error_message or f"Could not open device /dev/video{request.device_index}"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    return await get_camera_status()


@router.post(
    "/api/camera/stop",
    response_model=CameraStatusResponse,
    summary="Stop live camera capture",
    description="Stops live video capture, terminates background inference threads, and releases the hardware device.",
)
async def stop_camera():
    """Stops live capture and releases hardware device."""
    live_camera_manager.stop()
    return await get_camera_status()


@router.websocket("/ws/camera/stream")
async def websocket_camera_stream(websocket: WebSocket):
    """
    WebSocket endpoint delivering live annotated video frames and genuine detection metadata.
    Supports client commands:
      - {"action": "start", "device_index": 0, "conf_threshold": 0.25}
      - {"action": "stop"}
      - {"action": "ping"}
    """
    await websocket.accept()
    queue = asyncio.Queue(maxsize=2)
    live_camera_manager.register_subscriber(queue)
    logger.info("WebSocket subscriber connected (total: %d)", live_camera_manager.subscriber_count)

    # Initial status packet
    status_packet = {
        "type": "status",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **live_camera_manager.get_status(),
    }
    await websocket.send_text(json.dumps(status_packet))

    # Helper task to listen for client commands concurrently
    async def listen_for_client_commands():
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    cmd = json.loads(text)
                    action = cmd.get("action")
                    if action == "start":
                        dev_idx = cmd.get("device_index", 0)
                        conf = cmd.get("conf_threshold", DEFAULT_CONF_THRESHOLD)
                        live_camera_manager.start(dev_idx, conf)
                        ack = {
                            "type": "status",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            **live_camera_manager.get_status(),
                        }
                        await websocket.send_text(json.dumps(ack))
                    elif action == "stop":
                        live_camera_manager.stop()
                        ack = {
                            "type": "status",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            **live_camera_manager.get_status(),
                        }
                        await websocket.send_text(json.dumps(ack))
                    elif action == "ping":
                        await websocket.send_text(json.dumps({"type": "pong", "timestamp": time.time()}))
                except json.JSONDecodeError:
                    pass
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    listener_task = asyncio.create_task(listen_for_client_commands())

    try:
        while True:
            # Wait for next frame packet from camera stream worker
            packet = await queue.get()
            await websocket.send_text(json.dumps(packet))
    except (WebSocketDisconnect, ConnectionResetError):
        logger.info("WebSocket subscriber disconnected.")
    except Exception as e:
        logger.warning("Error in WebSocket streaming loop: %s", e)
    finally:
        listener_task.cancel()
        live_camera_manager.unregister_subscriber(queue)
        logger.info("WebSocket subscriber unregistered (remaining: %d)", live_camera_manager.subscriber_count)

