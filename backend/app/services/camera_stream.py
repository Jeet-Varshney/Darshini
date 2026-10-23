"""
CrowdFlow Sentinel - Live Camera Capture & Inference Streamer
Manages the live camera lifecycle, latest-frame non-blocking queueing,
genuine YOLO model inference on live camera frames, and subscriber broadcasting.
"""

import asyncio
import base64
import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Any
import cv2
import numpy as np

from app.config import PREVIEW_MAX_WIDTH, PREVIEW_JPEG_QUALITY, DEFAULT_CONF_THRESHOLD
from app.services.model_service import model_service, ModelUnavailableError
from app.services.camera_discovery import camera_discovery_service

logger = logging.getLogger("crowdflow.camera_stream")


class LiveCameraManager:
    """Singleton managing active camera capture, inference loop, and WebSocket subscribers."""

    def __init__(self):
        self._lock = threading.Lock()
        self._is_running = False
        self._device_index: Optional[int] = None
        self._camera_name: str = "Unknown Camera"
        self._conf_threshold: float = DEFAULT_CONF_THRESHOLD

        # Hardware capture & frames
        self._cap: Optional[cv2.VideoCapture] = None
        self._latest_raw_frame: Optional[np.ndarray] = None
        self._latest_raw_frame_id: int = 0
        self._last_processed_frame_id: int = -1

        # Threads
        self._capture_thread: Optional[threading.Thread] = None
        self._inference_thread: Optional[threading.Thread] = None

        # Telemetry & performance metrics
        self._inference_times: deque = deque(maxlen=20)
        self._measured_inference_fps: float = 0.0
        self._last_person_count: int = 0
        self._last_bounding_boxes: List[Dict[str, Any]] = []
        self._last_annotated_base64: Optional[str] = None
        self._error_message: Optional[str] = None

        # Event loop & subscriber queues
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._subscribers: Set[asyncio.Queue] = set()
        self._last_subscriber_disconnect: float = 0.0

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._is_running and self._cap is not None and self._cap.isOpened()

    @property
    def active_device_index(self) -> Optional[int]:
        return self._device_index

    @property
    def active_camera_name(self) -> str:
        return self._camera_name

    @property
    def inference_fps(self) -> float:
        return round(self._measured_inference_fps, 1)

    @property
    def last_person_count(self) -> int:
        return self._last_person_count

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    @property
    def error_message(self) -> Optional[str]:
        return self._error_message

    def get_status(self) -> Dict[str, Any]:
        """Returns the full runtime status of the live camera pipeline."""
        with self._lock:
            return {
                "is_streaming": self._is_running,
                "active_device_index": self._device_index,
                "active_camera_name": self._camera_name,
                "model_ready": model_service.is_ready,
                "inference_fps": round(self._measured_inference_fps, 1),
                "last_person_count": self._last_person_count,
                "active_subscribers": len(self._subscribers),
                "error_message": self._error_message,
            }

    def start(self, device_index: int, conf_threshold: float = DEFAULT_CONF_THRESHOLD) -> bool:
        """
        Starts camera capture and real-time model inference in background threads.
        Releases any previously open camera before starting.
        """
        if not model_service.is_ready:
            raise ModelUnavailableError(
                model_service.error_message or "Detection model is not available or weights are missing."
            )

        with self._lock:
            # If already running with the same device, update parameters and return
            if self._is_running and self._device_index == device_index:
                self._conf_threshold = conf_threshold
                logger.info("Camera %d already active; updated conf_threshold to %.2f", device_index, conf_threshold)
                return True

            # If running a different device, stop first
            if self._is_running:
                self._stop_internal()

            # Open video capture device
            cap = cv2.VideoCapture(device_index)
            if not cap.isOpened():
                self._error_message = f"Failed to open video device /dev/video{device_index}."
                logger.error(self._error_message)
                return False

            # Set preferred resolution
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

            # Resolve camera name
            cams = camera_discovery_service.discover_cameras(test_read=False)
            matched = next((c for c in cams if c["index"] == device_index), None)
            cam_name = matched["name"] if matched else f"Camera #{device_index}"

            self._cap = cap
            self._device_index = device_index
            self._camera_name = cam_name
            self._conf_threshold = conf_threshold
            self._is_running = True
            self._error_message = None
            self._inference_times.clear()
            self._measured_inference_fps = 0.0

            # Store current event loop for subscriber notifications
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                self._loop = None

            # Spawn threads: capture loop + inference loop
            self._capture_thread = threading.Thread(
                target=self._capture_worker,
                name=f"CaptureWorker-{device_index}",
                daemon=True,
            )
            self._inference_thread = threading.Thread(
                target=self._inference_worker,
                name=f"InferenceWorker-{device_index}",
                daemon=True,
            )

            self._capture_thread.start()
            self._inference_thread.start()

            logger.info("Live camera capture started on /dev/video%d ('%s')", device_index, cam_name)
            return True

    def stop(self) -> None:
        """Stops camera capture, releases hardware device, and resets state."""
        with self._lock:
            self._stop_internal()
        logger.info("Live camera stopped and hardware device released.")

    def _stop_internal(self) -> None:
        """Internal stop logic without re-acquiring self._lock."""
        self._is_running = False
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception as e:
                logger.warning("Error releasing cv2.VideoCapture: %s", e)
            self._cap = None

        self._latest_raw_frame = None
        self._latest_raw_frame_id = 0
        self._last_processed_frame_id = -1
        self._measured_inference_fps = 0.0

    def _capture_worker(self) -> None:
        """
        Continuous frame acquisition thread.
        Reads frames as fast as the camera hardware delivers them,
        storing only the latest raw frame (latest-frame strategy to prevent backlog).
        """
        logger.debug("Capture worker thread started for device %s", self._device_index)
        while self._is_running and self._cap is not None:
            ret, frame = self._cap.read()
            if not ret or frame is None or frame.size == 0:
                logger.warning("Camera %s failed to read frame.", self._device_index)
                time.sleep(0.05)
                continue

            with self._lock:
                self._latest_raw_frame = frame
                self._latest_raw_frame_id += 1

            # Micro-sleep to prevent 100% core spin on tight capture loop
            time.sleep(0.005)

        logger.debug("Capture worker thread exited.")

    def _inference_worker(self) -> None:
        """
        Inference worker thread.
        Pulls the latest raw frame and executes YOLO person detection on CPU.
        If a new frame is not yet available, yields briefly.
        """
        logger.debug("Inference worker thread started.")
        while self._is_running:
            raw_frame = None
            frame_id = 0

            with self._lock:
                if self._latest_raw_frame is not None and self._latest_raw_frame_id != self._last_processed_frame_id:
                    raw_frame = self._latest_raw_frame.copy()
                    frame_id = self._latest_raw_frame_id
                    self._last_processed_frame_id = frame_id

            if raw_frame is None:
                time.sleep(0.01)
                continue

            t_start = time.time()
            try:
                # Execute genuine model inference
                detections = model_service.detect_persons(
                    raw_frame,
                    conf_threshold=self._conf_threshold,
                )
            except Exception as e:
                logger.error("Inference failed on live camera frame: %s", e)
                time.sleep(0.05)
                continue

            t_duration = time.time() - t_start

            # Calculate genuine measured FPS using rolling timestamps
            now = time.time()
            self._inference_times.append(now)
            if len(self._inference_times) >= 2:
                dt = self._inference_times[-1] - self._inference_times[0]
                if dt > 0:
                    self._measured_inference_fps = (len(self._inference_times) - 1) / dt

            self._last_person_count = len(detections)
            self._last_bounding_boxes = detections

            # Generate annotated frame
            annotated_b64 = self._render_live_annotation(
                raw_frame,
                detections,
                fps=self._measured_inference_fps,
                camera_name=self._camera_name,
            )
            self._last_annotated_base64 = annotated_b64

            # Broadcast packet to all active WebSocket subscribers
            packet = {
                "type": "frame",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "camera_name": self._camera_name,
                "device_index": self._device_index,
                "person_count": len(detections),
                "bounding_boxes": detections,
                "inference_fps": round(self._measured_inference_fps, 1),
                "inference_duration_ms": round(t_duration * 1000, 1),
                "image": annotated_b64,
                "status": "streaming",
            }
            self._broadcast_packet(packet)

        logger.debug("Inference worker thread exited.")

    def _render_live_annotation(
        self,
        image_bgr: np.ndarray,
        detections: List[Dict[str, Any]],
        fps: float,
        camera_name: str,
    ) -> str:
        """Annotates live camera frame with bounding boxes, confidences, and top HUD banner."""
        annotated = image_bgr.copy()
        h, w = annotated.shape[:2]

        box_color = (141, 95, 54)  # Steel Blue #365F8D in BGR
        chip_bg = (54, 95, 141)
        text_color = (255, 255, 255)

        for det in detections:
            xmin, ymin, xmax, ymax = det["box_pixels"]
            cv2.rectangle(annotated, (xmin, ymin), (xmax, ymax), box_color, 2)

            conf_pct = int(det["confidence"] * 100)
            label = f"Person {conf_pct}%"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.42
            thickness = 1
            (tw, th), _ = cv2.getTextSize(label, font, font_scale, thickness)

            chip_ymin = max(0, ymin - th - 6)
            chip_ymax = max(th + 6, ymin)
            chip_xmax = min(w - 1, xmin + tw + 8)

            cv2.rectangle(annotated, (xmin, chip_ymin), (chip_xmax, chip_ymax), chip_bg, cv2.FILLED)
            cv2.putText(
                annotated,
                label,
                (xmin + 4, chip_ymax - 4),
                font,
                font_scale,
                text_color,
                thickness,
                cv2.LINE_AA,
            )

        # Top Live Telemetry HUD Bar
        hud_h = 30
        overlay = annotated.copy()
        cv2.rectangle(overlay, (0, 0), (w, hud_h), (23, 43, 67), cv2.FILLED)  # Dark Navy in BGR
        cv2.addWeighted(overlay, 0.85, annotated, 0.15, 0, annotated)

        hud_text = (
            f"LIVE STREAM: {camera_name[:24]} | "
            f"PERSONS: {len(detections)} | "
            f"FPS: {fps:.1f} | "
            f"MODEL: YOLOv8n"
        )
        cv2.putText(
            annotated,
            hud_text,
            (8, 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.44,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

        # Scale down if wider than max preview width
        if w > PREVIEW_MAX_WIDTH:
            scale = PREVIEW_MAX_WIDTH / float(w)
            annotated = cv2.resize(annotated, (PREVIEW_MAX_WIDTH, int(round(h * scale))), interpolation=cv2.INTER_AREA)

        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), PREVIEW_JPEG_QUALITY]
        success, buffer = cv2.imencode(".jpg", annotated, encode_params)
        if not success:
            return ""

        b64 = base64.b64encode(buffer).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    def register_subscriber(self, queue: asyncio.Queue) -> None:
        """Adds a client queue for receiving live stream frames."""
        self._subscribers.add(queue)

    def unregister_subscriber(self, queue: asyncio.Queue) -> None:
        """Removes a client queue. If zero subscribers remain, records disconnect time."""
        self._subscribers.discard(queue)
        if len(self._subscribers) == 0:
            self._last_subscriber_disconnect = time.time()

    def _broadcast_packet(self, packet: Dict[str, Any]) -> None:
        """Dispatches a frame packet to all active subscriber queues on the asyncio loop."""
        if not self._subscribers or self._loop is None:
            return

        for queue in list(self._subscribers):
            try:
                # Non-blocking put_nowait into subscriber queue
                if queue.full():
                    try:
                        queue.get_nowait()  # Drop oldest unconsumed frame to prevent client lag
                    except asyncio.QueueEmpty:
                        pass
                self._loop.call_soon_threadsafe(queue.put_nowait, packet)
            except Exception as e:
                logger.debug("Failed to dispatch to subscriber queue: %s", e)


# Singleton instance
live_camera_manager = LiveCameraManager()
