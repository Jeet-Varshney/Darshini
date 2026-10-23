import asyncio
import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any
import numpy as np
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
    CameraZoneAssignRequest,
    CameraStatusResponse,
    ZoneLiveStatus,
    ZoneStatusListResponse,
    ClientFrameInferRequest,
    LocationSessionResponse,
    LocationUpdateRequest,
)
from app.services.model_service import model_service, ModelUnavailableError
from app.services.video_service import VideoProcessor, VideoProcessingError
from app.services.camera_discovery import camera_discovery_service
from app.services.camera_stream import live_camera_manager
from app.services.location_stream import location_stream_manager

logger = logging.getLogger("darshini.routes")
router = APIRouter()
video_processor = VideoProcessor(model_service)


def safe_json_dumps(obj: Any) -> str:
    """
    Safely serializes data payloads to JSON, normalizing NumPy booleans (np.bool_),
    integers, floats, arrays, and date-time objects into standard JSON primitives.
    Prevents 'TypeError: Object of type bool is not JSON serializable'.
    """
    def _default(o):
        if isinstance(o, np.generic):
            return o.item()
        if type(o).__name__ in ("bool", "bool_"):
            return bool(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        if hasattr(o, "isoformat"):
            return o.isoformat()
        if hasattr(o, "model_dump"):
            return o.model_dump()
        if hasattr(o, "dict"):
            return o.dict()
        raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")

    return json.dumps(obj, default=_default)



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
        assigned_zone_id=status_data.get("assigned_zone_id"),
        assigned_zone_name=status_data.get("assigned_zone_name"),
        model_ready=status_data["model_ready"],
        inference_fps=status_data["inference_fps"],
        capture_fps=status_data.get("capture_fps", 0.0),
        last_person_count=status_data["last_person_count"],
        active_subscribers=status_data["active_subscribers"],
        error_message=status_data["error_message"],
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post(
    "/api/camera/start",
    response_model=CameraStatusResponse,
    summary="Start live camera capture",
    description="Activates live video capture on the specified device index, assigns target zone, and initiates background inference.",
)
async def start_camera(request: CameraStartRequest):
    """Starts live capture on a chosen camera index and associates it with a venue zone."""
    if not model_service.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=model_service.error_message or "Inference model is not ready.",
        )

    success = live_camera_manager.start(
        device_index=request.device_index,
        conf_threshold=request.conf_threshold,
        assigned_zone_id=request.assigned_zone_id,
    )
    if not success:
        err = live_camera_manager.error_message or f"Could not open device /dev/video{request.device_index}"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    return await get_camera_status()


@router.post(
    "/api/camera/assign-zone",
    response_model=CameraStatusResponse,
    summary="Assign camera to venue zone",
    description="Associates or reassigns an active camera to a configured venue zone.",
)
async def assign_camera_zone(request: CameraZoneAssignRequest):
    """Associates an active camera with a venue zone."""
    success = live_camera_manager.assign_zone(
        device_index=request.device_index,
        zone_id=request.zone_id,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid or unknown venue zone ID: '{request.zone_id}'",
        )
    return await get_camera_status()


@router.get(
    "/api/zones/live-status",
    response_model=ZoneStatusListResponse,
    summary="Get live operational status of all venue zones",
    description="Returns live camera observations for mapped zones and baseline simulation data for unassigned zones.",
)
async def get_live_zone_statuses():
    """Returns zone-by-zone operational status with genuine live camera counts where assigned."""
    statuses = [ZoneLiveStatus(**z) for z in live_camera_manager.get_zone_statuses()]
    active_count = 1 if live_camera_manager.is_running else 0
    return ZoneStatusListResponse(
        zones=statuses,
        active_camera_count=active_count,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


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


@router.post(
    "/api/camera/infer-frame",
    summary="Run model inference on single client camera frame",
    description="Accepts base64 frame from browser camera, executes YOLOv8 person detection on CPU, and updates zone status.",
)
async def infer_client_frame(req: ClientFrameInferRequest):
    """Fallback REST endpoint for processing browser frames on CPU model."""
    try:
        res = await asyncio.to_thread(
            live_camera_manager.process_client_frame,
            client_id=req.client_id or "http-client",
            image_data=req.image,
            zone_id=req.zone_id,
            camera_name=req.camera_name or "Browser Camera",
            conf_threshold=req.conf_threshold,
        )
        return res
    except ModelUnavailableError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to process client frame: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.websocket("/ws/camera/stream")
async def websocket_camera_stream(websocket: WebSocket):
    """
    WebSocket endpoint delivering live annotated video frames and genuine detection metadata.
    Supports both server-captured V4L2 streaming AND client browser camera inference:
      - {"action": "infer_frame", "image": "data:image/jpeg;base64,...", "zone_id": "...", "client_id": "..."}
      - {"action": "start", "device_index": 0, "conf_threshold": 0.25}
      - {"action": "stop"}
      - {"action": "ping"}
    """
    await websocket.accept()
    loop = asyncio.get_running_loop()
    queue = asyncio.Queue(maxsize=1)
    live_camera_manager.register_subscriber(queue, loop=loop)
    client_id = f"client-{uuid.uuid4().hex[:8]}"
    send_lock = asyncio.Lock()

    logger.info("WebSocket subscriber connected: %s (total: %d)", client_id, live_camera_manager.subscriber_count)



    async def safe_send(text_payload: str):
        """Thread-safe WebSocket sender to avoid concurrent write collisions."""
        async with send_lock:
            try:
                await websocket.send_text(text_payload)
            except (WebSocketDisconnect, RuntimeError):
                pass

    # Initial status packet
    status_packet = {
        "type": "status",
        "client_id": client_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **live_camera_manager.get_status(),
    }
    await safe_send(safe_json_dumps(status_packet))

    # Helper task to listen for client commands and browser camera frames concurrently
    async def listen_for_client_commands():
        nonlocal client_id
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    cmd = json.loads(text)
                    action = cmd.get("action")

                    if action == "infer_frame":
                        c_id = cmd.get("client_id") or client_id
                        img_data = cmd.get("image")
                        if not img_data:
                            continue
                        z_id = cmd.get("zone_id")
                        c_name = cmd.get("camera_name", "Browser Camera")
                        conf = cmd.get("conf_threshold", DEFAULT_CONF_THRESHOLD)

                        try:
                            # Run CPU model inference in thread pool to avoid blocking the event loop
                            result = await asyncio.to_thread(
                                live_camera_manager.process_client_frame,
                                client_id=c_id,
                                image_data=img_data,
                                zone_id=z_id,
                                camera_name=c_name,
                                conf_threshold=conf,
                            )
                            await safe_send(safe_json_dumps(result))
                        except Exception as infer_err:
                            err_packet = {
                                "type": "error",
                                "error": str(infer_err),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            }
                            await safe_send(safe_json_dumps(err_packet))

                    elif action == "client_stop":
                        c_id = cmd.get("client_id") or client_id
                        live_camera_manager.mark_client_disconnected(c_id)
                        ack = {
                            "type": "status",
                            "status": "client_stopped",
                            "client_id": c_id,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        await safe_send(safe_json_dumps(ack))

                    elif action == "start":
                        dev_idx = cmd.get("device_index", 0)
                        conf = cmd.get("conf_threshold", DEFAULT_CONF_THRESHOLD)
                        assigned_zone = cmd.get("assigned_zone_id")
                        live_camera_manager.start(dev_idx, conf, assigned_zone)
                        ack = {
                            "type": "status",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            **live_camera_manager.get_status(),
                        }
                        await safe_send(safe_json_dumps(ack))

                    elif action == "assign_zone":
                        dev_idx = cmd.get("device_index", 0)
                        zone_id = cmd.get("zone_id")
                        live_camera_manager.assign_zone(dev_idx, zone_id)
                        ack = {
                            "type": "status",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            **live_camera_manager.get_status(),
                        }
                        await safe_send(safe_json_dumps(ack))

                    elif action == "stop":
                        live_camera_manager.stop()
                        ack = {
                            "type": "status",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            **live_camera_manager.get_status(),
                        }
                        await safe_send(safe_json_dumps(ack))

                    elif action == "ping":
                        await safe_send(safe_json_dumps({"type": "pong", "timestamp": time.time()}))
                except json.JSONDecodeError:
                    pass
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    listener_task = asyncio.create_task(listen_for_client_commands())

    try:
        while True:
            # Wait for next server-hardware frame packet (if local V4L2 camera is active)
            packet = await queue.get()
            try:
                await safe_send(safe_json_dumps(packet))
            except (WebSocketDisconnect, RuntimeError):
                break
            except Exception as e:
                logger.warning("Error serializing or sending hardware frame packet: %s", e)
    except (WebSocketDisconnect, ConnectionResetError):
        logger.info("WebSocket subscriber disconnected: %s", client_id)
    except Exception as e:
        logger.warning("Error in WebSocket streaming loop: %s", e)
    finally:
        listener_task.cancel()
        live_camera_manager.unregister_subscriber(queue)
        live_camera_manager.mark_client_disconnected(client_id)
        logger.info("WebSocket subscriber unregistered: %s (remaining: %d)", client_id, live_camera_manager.subscriber_count)


# ============================================================================
# Mobile-to-Desktop Live GPS Location Bridge Endpoints
# ============================================================================

@router.post(
    "/api/location/session",
    response_model=LocationSessionResponse,
    summary="Create pairing session for mobile phone GPS streaming",
    description="Creates a secure ephemeral pairing token and session ID allowing a mobile phone to stream real-time GPS coordinates to the desktop command center.",
)
async def create_location_session():
    data = await location_stream_manager.create_session()
    return LocationSessionResponse(
        session_id=data["session_id"],
        token=data["token"],
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post(
    "/api/location/update",
    summary="REST fallback for mobile location updates",
    description="Receives validated mobile GPS coordinates and relays them to desktop subscribers.",
)
async def post_location_update(req: LocationUpdateRequest):
    session = location_stream_manager.get_session(req.session_id)
    if not session or session.token != req.token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired location session.")

    if not location_stream_manager.validate_coordinates(req.latitude, req.longitude, req.accuracy):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid coordinate boundaries.")

    payload = {
        "type": "location_update",
        "session_id": req.session_id,
        "latitude": float(req.latitude),
        "longitude": float(req.longitude),
        "accuracy": float(req.accuracy),
        "heading": req.heading,
        "speed": req.speed,
        "timestamp": req.timestamp or datetime.now(timezone.utc).isoformat(),
        "source": "MOBILE_STREAM",
    }
    session.last_update = payload

    # Broadcast to any active subscribers
    dead_subs = set()
    for sub in list(session.subscribers):
        try:
            await sub.send_text(safe_json_dumps(payload))
        except (WebSocketDisconnect, RuntimeError):
            dead_subs.add(sub)
    session.subscribers.difference_update(dead_subs)

    return {"status": "relayed", "subscribers": len(session.subscribers)}


@router.websocket("/ws/location/{session_id}")
async def websocket_location_stream(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for real-time location streaming and subscription.
    Query params: role=broadcaster&token=... OR role=subscriber
    """
    await websocket.accept()
    role = websocket.query_params.get("role", "subscriber")
    token = websocket.query_params.get("token", "")

    session = location_stream_manager.get_session(session_id)
    if not session:
        await websocket.send_text(safe_json_dumps({"type": "error", "error": f"Session '{session_id}' not found or expired."}))
        await websocket.close(code=1008)
        return

    if role == "broadcaster":
        if session.token != token:
            await websocket.send_text(safe_json_dumps({"type": "error", "error": "Invalid session authentication token."}))
            await websocket.close(code=1008)
            return

        session.broadcaster = websocket
        logger.info("Location broadcaster connected to session: %s", session_id)

        # Notify subscribers that broadcaster is online
        for sub in list(session.subscribers):
            try:
                await sub.send_text(safe_json_dumps({"type": "broadcaster_status", "connected": True, "session_id": session_id}))
            except Exception:
                pass

        try:
            while True:
                text = await websocket.receive_text()
                try:
                    data = json.loads(text)
                    if data.get("type") == "location_update":
                        lat = data.get("latitude")
                        lng = data.get("longitude")
                        acc = data.get("accuracy", 20.0)

                        if location_stream_manager.validate_coordinates(lat, lng, acc):
                            update_packet = {
                                "type": "location_update",
                                "session_id": session_id,
                                "latitude": float(lat),
                                "longitude": float(lng),
                                "accuracy": float(acc),
                                "heading": data.get("heading"),
                                "speed": data.get("speed"),
                                "timestamp": data.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                                "source": "MOBILE_STREAM",
                            }
                            session.last_update = update_packet

                            # Relay to all subscribers
                            dead = set()
                            for sub in list(session.subscribers):
                                try:
                                    await sub.send_text(safe_json_dumps(update_packet))
                                except Exception:
                                    dead.add(sub)
                            session.subscribers.difference_update(dead)
                except json.JSONDecodeError:
                    pass
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        finally:
            session.broadcaster = None
            logger.info("Location broadcaster disconnected from session: %s", session_id)
            for sub in list(session.subscribers):
                try:
                    await sub.send_text(safe_json_dumps({"type": "broadcaster_status", "connected": False, "session_id": session_id}))
                except Exception:
                    pass

    else:
        # Subscriber (Desktop Command Center)
        session.subscribers.add(websocket)
        logger.info("Location subscriber registered for session: %s (total: %d)", session_id, len(session.subscribers))

        # Send initial status & cached position if present
        init_packet = {
            "type": "session_status",
            "session_id": session_id,
            "broadcaster_connected": session.broadcaster is not None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await websocket.send_text(safe_json_dumps(init_packet))
        if session.last_update:
            await websocket.send_text(safe_json_dumps(session.last_update))

        try:
            while True:
                await websocket.receive_text()
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        finally:
            session.subscribers.discard(websocket)
            logger.info("Location subscriber unregistered from session: %s (remaining: %d)", session_id, len(session.subscribers))


