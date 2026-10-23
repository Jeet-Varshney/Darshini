"""
Darshini - Optimized Live Camera Capture, Stationary-Person CV Tracking & Zone Streamer
Decouples camera capture, YOLOv8 CPU inference with stationary-person hysteresis,
and preview streaming into dedicated workers.
Associates live camera observations with configured venue zones.
"""

import asyncio
import base64
import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Any, Union
import cv2
import numpy as np

from app.config import (
    PREVIEW_MAX_WIDTH,
    PREVIEW_JPEG_QUALITY,
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_INFERENCE_IMGSZ,
    LIVE_CAPTURE_TARGET_WIDTH,
    LIVE_CAPTURE_TARGET_HEIGHT,
    LIVE_STREAM_TARGET_FPS,
)
from app.services.model_service import model_service, ModelUnavailableError
from app.services.camera_discovery import camera_discovery_service

logger = logging.getLogger("darshini.camera_stream")

# Configured Venue Zones Catalog
VENUE_ZONES = {
    "zone-north-plaza": {
        "code": "Z-01",
        "name": "North Gate Plaza",
        "area_sqm": 1200.0,
        "safe_capacity": 2400,
    },
    "zone-central-concourse": {
        "code": "Z-02",
        "name": "Central Promenade",
        "area_sqm": 2500.0,
        "safe_capacity": 3750,
    },
    "zone-pavilion-east": {
        "code": "Z-03",
        "name": "Pavilion Hall A (East)",
        "area_sqm": 3200.0,
        "safe_capacity": 4800,
    },
    "zone-west-corridor": {
        "code": "Z-04",
        "name": "West Emergency Corridor",
        "area_sqm": 900.0,
        "safe_capacity": 1350,
    },
    "zone-south-terminal": {
        "code": "Z-05",
        "name": "South Metro Hub",
        "area_sqm": 1800.0,
        "safe_capacity": 2700,
    },
}


def compute_box_iou(b1: List[int], b2: List[int]) -> float:
    """Computes Intersection over Union between two [xmin, ymin, xmax, ymax] boxes."""
    x1 = max(b1[0], b2[0])
    y1 = max(b1[1], b2[1])
    x2 = min(b1[2], b2[2])
    y2 = min(b1[3], b2[3])

    inter_w = max(0, x2 - x1)
    inter_h = max(0, y2 - y1)
    inter_area = inter_w * inter_h

    area1 = max(0, b1[2] - b1[0]) * max(0, b1[3] - b1[1])
    area2 = max(0, b2[2] - b2[0]) * max(0, b2[3] - b2[1])
    union_area = area1 + area2 - inter_area

    if union_area <= 0:
        return 0.0
    return float(inter_area / union_area)


class StationaryPersonTracker:
    """
    2-Tier Hysteresis Tracker for Stationary Person Detection.
    Maintains confirmed tracks across consecutive frames to prevent detection drops
    on motionless individuals without accumulating count across frames.
    """

    def __init__(self, init_conf: float = 0.22, retain_conf: float = 0.15, max_missed: int = 8):
        self.init_conf = init_conf
        self.retain_conf = retain_conf
        self.max_missed = max_missed
        self._next_id = 1
        self.tracks: List[Dict[str, Any]] = []

    def update(self, raw_detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Updates tracks with incoming raw detections for the current frame.
        Returns: list of confirmed active person detections in this frame.
        """
        unmatched_dets = list(raw_detections)
        matched_track_indices = set()

        for t_idx, track in enumerate(self.tracks):
            best_iou = 0.0
            best_d_idx = -1

            for d_idx, det in enumerate(unmatched_dets):
                iou = compute_box_iou(track["box_pixels"], det["box_pixels"])
                if iou > 0.32 and iou > best_iou:
                    best_iou = iou
                    best_d_idx = d_idx

            if best_d_idx >= 0:
                matched_det = unmatched_dets.pop(best_d_idx)
                old_cx = (track["box_pixels"][0] + track["box_pixels"][2]) / 2.0
                old_cy = (track["box_pixels"][1] + track["box_pixels"][3]) / 2.0
                new_cx = (matched_det["box_pixels"][0] + matched_det["box_pixels"][2]) / 2.0
                new_cy = (matched_det["box_pixels"][1] + matched_det["box_pixels"][3]) / 2.0

                dist = np.hypot(new_cx - old_cx, new_cy - old_cy)
                box_diag = np.hypot(
                    matched_det["box_pixels"][2] - matched_det["box_pixels"][0],
                    matched_det["box_pixels"][3] - matched_det["box_pixels"][1],
                )

                # Flag stationary if movement is under 6% of diagonal (cast to pure Python bool)
                is_stationary = bool((dist / max(box_diag, 1.0)) < 0.06)

                track["box_pixels"] = [int(v) for v in matched_det["box_pixels"]]
                track["box_normalized"] = [float(v) for v in matched_det["box_normalized"]]
                track["confidence"] = float(matched_det["confidence"])
                track["missed_count"] = 0
                track["hits"] += 1
                track["is_stationary"] = is_stationary
                track["last_seen"] = time.time()
                matched_track_indices.add(t_idx)
            else:
                track["missed_count"] += 1

        # Establish new tracks from unmatched high-confidence detections
        for det in unmatched_dets:
            if det["confidence"] >= self.init_conf:
                new_track = {
                    "track_id": self._next_id,
                    "box_pixels": det["box_pixels"],
                    "box_normalized": det["box_normalized"],
                    "confidence": det["confidence"],
                    "class_id": 0,
                    "class_name": "person",
                    "missed_count": 0,
                    "hits": 1,
                    "is_stationary": True,
                    "created_at": time.time(),
                    "last_seen": time.time(),
                }
                self._next_id += 1
                self.tracks.append(new_track)

        # Prune tracks that exceeded max missed frames
        self.tracks = [t for t in self.tracks if t["missed_count"] <= self.max_missed]

        # Return confirmed active detections for this frame with pure Python primitives
        active_results = []
        for t in self.tracks:
            active_results.append({
                "track_id": int(t["track_id"]),
                "box_pixels": [int(v) for v in t["box_pixels"]],
                "box_normalized": [float(v) for v in t["box_normalized"]],
                "confidence": float(t["confidence"]),
                "class_id": 0,
                "class_name": "person",
                "is_stationary": bool(t["is_stationary"]),
                "dwell_time_sec": round(float(time.time() - t["created_at"]), 1),
            })

        return active_results


class LiveCameraManager:
    """
    Manages live camera capture, stationary-person model inference,
    venue zone mapping, and WebSocket distribution in Darshini.
    """

    def __init__(self):
        self._state_lock = threading.Lock()
        self._frame_lock = threading.Lock()
        self._detection_lock = threading.Lock()

        self._is_running = False
        self._device_index: Optional[int] = None
        self._camera_name: str = "Unknown Camera"
        self._conf_threshold: float = DEFAULT_CONF_THRESHOLD
        self._assigned_zone_id: Optional[str] = "zone-north-plaza"  # Default initial assignment

        # Hardware capture & frame slots (Capacity 1 latest-frame buffer)
        self._cap: Optional[cv2.VideoCapture] = None
        self._latest_raw_frame: Optional[np.ndarray] = None
        self._latest_frame_id: int = 0
        self._latest_frame_time: float = 0.0
        self._delivered_resolution: str = "Unknown"
        self._frame_available_event = threading.Event()

        # Detection cache & stationary tracker
        self._tracker = StationaryPersonTracker()
        self._latest_detections: List[Dict[str, Any]] = []
        self._latest_person_count: int = 0
        self._latest_infer_duration_ms: float = 0.0
        self._last_inferred_frame_id: int = -1
        self._last_inference_time_iso: Optional[str] = None
        self._last_inference_epoch: float = 0.0

        # Worker threads
        self._capture_thread: Optional[threading.Thread] = None
        self._inference_thread: Optional[threading.Thread] = None
        self._stream_thread: Optional[threading.Thread] = None

        # Telemetry & performance metrics
        self._capture_timestamps: deque = deque(maxlen=30)
        self._inference_timestamps: deque = deque(maxlen=20)
        self._measured_capture_fps: float = 0.0
        self._measured_inference_fps: float = 0.0
        self._error_message: Optional[str] = None

        # Event loop & subscriber queues
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._subscribers: Set[asyncio.Queue] = set()
        self._last_subscriber_disconnect: float = 0.0

        # Milestone 4: Client browser feeds & active zone observations
        self._active_zone_observations: Dict[str, Dict[str, Any]] = {}
        self._client_trackers: Dict[str, StationaryPersonTracker] = {}
        self._client_timestamps: Dict[str, deque] = {}

    @property
    def is_running(self) -> bool:
        with self._state_lock:
            return self._is_running and self._cap is not None and self._cap.isOpened()

    @property
    def active_device_index(self) -> Optional[int]:
        return self._device_index

    @property
    def active_camera_name(self) -> str:
        return self._camera_name

    @property
    def assigned_zone_id(self) -> Optional[str]:
        return self._assigned_zone_id

    @property
    def inference_fps(self) -> float:
        return round(self._measured_inference_fps, 1)

    @property
    def capture_fps(self) -> float:
        return round(self._measured_capture_fps, 1)

    @property
    def last_person_count(self) -> int:
        with self._detection_lock:
            return self._latest_person_count

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    @property
    def error_message(self) -> Optional[str]:
        return self._error_message

    def assign_zone(self, device_index: int, zone_id: Optional[str]) -> bool:
        """Associates or changes the camera's mapped venue zone."""
        with self._state_lock:
            if zone_id and zone_id not in VENUE_ZONES:
                logger.warning("Attempted to assign unknown zone_id '%s'", zone_id)
                return False

            self._assigned_zone_id = zone_id
            zone_name = VENUE_ZONES[zone_id]["name"] if zone_id in VENUE_ZONES else "Unassigned"
            logger.info("Camera %s assigned to zone '%s' (%s)", device_index, zone_id, zone_name)

        # Broadcast updated zone status to subscribers
        status_packet = {
            "type": "status",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **self.get_status(),
        }
        self._broadcast_packet(status_packet)
        return True

    def get_status(self) -> Dict[str, Any]:
        """Returns the full runtime status of the live camera pipeline."""
        with self._state_lock:
            with self._detection_lock:
                zone_info = VENUE_ZONES.get(self._assigned_zone_id or "")
                zone_name = zone_info["name"] if zone_info else None

                return {
                    "is_streaming": self._is_running,
                    "active_device_index": self._device_index,
                    "active_camera_name": self._camera_name,
                    "assigned_zone_id": self._assigned_zone_id,
                    "assigned_zone_name": zone_name,
                    "delivered_resolution": self._delivered_resolution,
                    "model_ready": model_service.is_ready,
                    "capture_fps": round(self._measured_capture_fps, 1),
                    "inference_fps": round(self._measured_inference_fps, 1),
                    "inference_duration_ms": round(self._latest_infer_duration_ms, 1),
                    "last_person_count": self._latest_person_count,
                    "last_inference_time": self._last_inference_time_iso,
                    "active_subscribers": len(self._subscribers),
                    "error_message": self._error_message,
                }

    def get_zone_statuses(self) -> List[Dict[str, Any]]:
        """
        Returns live operational status and person count for each configured venue zone.
        Merges active client browser camera observations with local hardware camera observations.
        Marks data STALE when camera stream stops or frames delay > 4s.
        """
        now = time.time()
        statuses = []

        with self._state_lock:
            with self._detection_lock:
                for z_id, meta in VENUE_ZONES.items():
                    area = meta["area_sqm"]
                    safe_cap = meta["safe_capacity"]

                    # Check for active client browser observation first
                    client_obs = self._active_zone_observations.get(z_id)
                    if client_obs is not None:
                        time_since = now - client_obs["timestamp"]
                        is_stale = time_since > 6.0
                        status_label = "STREAMING" if not is_stale else "STALE"
                        count = client_obs["count"]
                        density = round(count / area, 5) if area > 0 else 0.0

                        note = (
                            f"Live camera observation from '{client_obs['camera_name']}' via hosted CV inference. "
                            "Instantaneous FOV count; never accumulated across frames."
                        ) if not is_stale else f"Client camera stream delayed ({time_since:.1f}s ago); count marked STALE."

                        statuses.append({
                            "zone_id": z_id,
                            "zone_code": meta["code"],
                            "zone_name": meta["name"],
                            "area_sqm": area,
                            "safe_capacity": safe_cap,
                            "camera_assigned": True,
                            "device_index": -1,
                            "camera_name": client_obs["camera_name"],
                            "status": status_label,
                            "instantaneous_count": count,
                            "density_per_sqm": density,
                            "last_inference_time": client_obs["iso_time"],
                            "is_stale": is_stale,
                            "data_source": "LIVE_CAMERA_INFERENCE",
                            "notes": note,
                        })
                        continue

                    # Check local hardware camera observation
                    is_assigned = (z_id == self._assigned_zone_id)
                    if is_assigned and self._is_running:
                        time_since_infer = now - self._last_inference_epoch
                        is_stale = (time_since_infer > 3.0) or (self._last_inference_epoch <= 0)
                        status_label = "STREAMING" if not is_stale else "STALE"
                        count = self._latest_person_count
                        density = round(count / area, 5) if area > 0 else 0.0

                        note = (
                            "Live camera observation derived from actual YOLOv8 person detection. "
                            "Instantaneous FOV count; never accumulated across frames."
                        ) if not is_stale else "Camera stream delayed or awaiting frames; count marked STALE."

                        statuses.append({
                            "zone_id": z_id,
                            "zone_code": meta["code"],
                            "zone_name": meta["name"],
                            "area_sqm": area,
                            "safe_capacity": safe_cap,
                            "camera_assigned": True,
                            "device_index": self._device_index,
                            "camera_name": self._camera_name,
                            "status": status_label,
                            "instantaneous_count": count,
                            "density_per_sqm": density,
                            "last_inference_time": self._last_inference_time_iso,
                            "is_stale": is_stale,
                            "data_source": "LIVE_CAMERA_INFERENCE",
                            "notes": note,
                        })
                    elif is_assigned and not self._is_running:
                        statuses.append({
                            "zone_id": z_id,
                            "zone_code": meta["code"],
                            "zone_name": meta["name"],
                            "area_sqm": area,
                            "safe_capacity": safe_cap,
                            "camera_assigned": True,
                            "device_index": self._device_index,
                            "camera_name": self._camera_name,
                            "status": "DISCONNECTED",
                            "instantaneous_count": None,
                            "density_per_sqm": None,
                            "last_inference_time": self._last_inference_time_iso,
                            "is_stale": True,
                            "data_source": "SIMULATED_FIXTURE",
                            "notes": "Assigned camera is stopped. Displaying configured demonstration fixture.",
                        })
                    else:
                        statuses.append({
                            "zone_id": z_id,
                            "zone_code": meta["code"],
                            "zone_name": meta["name"],
                            "area_sqm": area,
                            "safe_capacity": safe_cap,
                            "camera_assigned": False,
                            "device_index": None,
                            "camera_name": None,
                            "status": "UNASSIGNED",
                            "instantaneous_count": None,
                            "density_per_sqm": None,
                            "last_inference_time": None,
                            "is_stale": True,
                            "data_source": "SIMULATED_FIXTURE",
                            "notes": "No live camera assigned. Displaying configured demonstration fixture.",
                        })

        return statuses

    def start(
        self,
        device_index: int,
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
        assigned_zone_id: Optional[str] = None,
    ) -> bool:
        """
        Starts camera capture, stationary-aware model inference, and streaming.
        Releases any previously open camera before starting.
        """
        if not model_service.is_ready:
            raise ModelUnavailableError(
                model_service.error_message or "Detection model is not available or weights are missing."
            )

        with self._state_lock:
            # If zone specified, update assignment
            if assigned_zone_id is not None:
                self._assigned_zone_id = assigned_zone_id

            # If already running with the same device, update parameters and return
            if self._is_running and self._device_index == device_index:
                self._conf_threshold = conf_threshold
                logger.info("Camera %d already active; updated conf_threshold to %.2f", device_index, conf_threshold)
                return True

            # If running a different device, stop cleanly first
            if self._is_running:
                self._stop_internal()

            # Open video capture device
            cap = cv2.VideoCapture(device_index)
            if not cap.isOpened():
                self._error_message = f"Failed to open video device /dev/video{device_index}."
                logger.error(self._error_message)
                return False

            # Request target capture dimensions and rate
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, LIVE_CAPTURE_TARGET_WIDTH)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, LIVE_CAPTURE_TARGET_HEIGHT)
            cap.set(cv2.CAP_PROP_FPS, 30)

            # Query actual negotiated hardware parameters
            actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            self._delivered_resolution = f"{actual_w}x{actual_h}"
            logger.info("Device /dev/video%d negotiated resolution: %s", device_index, self._delivered_resolution)

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
            self._capture_timestamps.clear()
            self._inference_timestamps.clear()
            self._measured_capture_fps = 0.0
            self._measured_inference_fps = 0.0
            self._latest_frame_id = 0
            self._last_inferred_frame_id = -1
            self._frame_available_event.clear()
            self._tracker = StationaryPersonTracker(init_conf=max(0.20, conf_threshold - 0.05))

            # Store current event loop for subscriber notifications
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                self._loop = None

            # Spawn 3 dedicated workers:
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
            self._stream_thread = threading.Thread(
                target=self._stream_worker,
                name=f"StreamWorker-{device_index}",
                daemon=True,
            )

            self._capture_thread.start()
            self._inference_thread.start()
            self._stream_thread.start()

            logger.info("Live camera capture started on /dev/video%d ('%s')", device_index, cam_name)
            return True

    def stop(self) -> None:
        """Stops camera capture, releases hardware device, and resets state."""
        with self._state_lock:
            self._stop_internal()
        logger.info("Live camera stopped and hardware device released.")

    def _stop_internal(self) -> None:
        """Internal stop logic without re-acquiring self._state_lock."""
        self._is_running = False
        self._frame_available_event.set()  # Wake waiting inference thread

        # Safely join capture worker thread before releasing cap to prevent native OpenCV segfault
        cap_thread = self._capture_thread
        inf_thread = self._inference_thread
        stm_thread = self._stream_thread

        if cap_thread is not None and cap_thread.is_alive() and cap_thread != threading.current_thread():
            cap_thread.join(timeout=1.0)

        if self._cap is not None:
            try:
                self._cap.release()
            except Exception as e:
                logger.warning("Error releasing cv2.VideoCapture: %s", e)
            self._cap = None

        if inf_thread is not None and inf_thread.is_alive() and inf_thread != threading.current_thread():
            inf_thread.join(timeout=0.5)

        if stm_thread is not None and stm_thread.is_alive() and stm_thread != threading.current_thread():
            stm_thread.join(timeout=0.5)

        self._capture_thread = None
        self._inference_thread = None
        self._stream_thread = None

        with self._frame_lock:
            self._latest_raw_frame = None
            self._latest_frame_id = 0

        with self._detection_lock:
            self._latest_detections = []
            self._latest_person_count = 0
            self._latest_infer_duration_ms = 0.0
            self._last_inference_time_iso = None
            self._last_inference_epoch = 0.0

        self._measured_capture_fps = 0.0
        self._measured_inference_fps = 0.0

        # Broadcast stopped packet
        stop_packet = {
            "type": "status",
            "status": "stopped",
            "is_streaming": False,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._broadcast_packet(stop_packet)

    def _capture_worker(self) -> None:
        """
        Dedicated frame acquisition thread.
        Reads frames from the camera device as fast as hardware provides them.
        Maintains a bounded capacity-1 latest-frame buffer.
        """
        logger.debug("Capture worker started for device %s", self._device_index)
        consecutive_failures = 0

        while self._is_running:
            cap = self._cap
            if cap is None or not cap.isOpened():
                break

            ret, frame = cap.read()
            if not self._is_running:
                break

            if not ret or frame is None or frame.size == 0:
                consecutive_failures += 1
                if consecutive_failures > 60:
                    err = f"Camera device /dev/video{self._device_index} stopped delivering frames."
                    logger.error(err)
                    self._error_message = err
                    self._broadcast_packet({
                        "type": "error",
                        "error": err,
                        "status": "error",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    break
                time.sleep(0.02)
                continue

            consecutive_failures = 0
            now = time.time()

            # Record capture timestamp for true hardware FPS measurement
            self._capture_timestamps.append(now)
            if len(self._capture_timestamps) >= 2:
                dt = self._capture_timestamps[-1] - self._capture_timestamps[0]
                if dt > 0:
                    self._measured_capture_fps = (len(self._capture_timestamps) - 1) / dt

            # Update latest-frame buffer (Capacity 1)
            with self._frame_lock:
                self._latest_raw_frame = frame
                self._latest_frame_id += 1
                self._latest_frame_time = now

            # Signal inference worker that a new frame is available
            self._frame_available_event.set()

            time.sleep(0.002)

        logger.debug("Capture worker exited.")

    def _inference_worker(self) -> None:
        """
        Dedicated model inference thread with stationary-person hysteresis tracking.
        Pulls the single latest raw frame from the buffer, discarding stale frames.
        """
        logger.debug("Inference worker started.")

        while self._is_running:
            signaled = self._frame_available_event.wait(timeout=0.1)
            if not self._is_running:
                break

            self._frame_available_event.clear()

            raw_frame = None
            frame_id = 0

            with self._frame_lock:
                if (
                    self._latest_raw_frame is not None
                    and self._latest_frame_id != self._last_inferred_frame_id
                ):
                    raw_frame = self._latest_raw_frame.copy()
                    frame_id = self._latest_frame_id
                    self._last_inferred_frame_id = frame_id

            if raw_frame is None:
                continue

            # Run genuine model inference
            t_start = time.time()
            try:
                # Query with lower retention threshold to feed hysteresis tracker
                raw_detections = model_service.detect_persons(
                    raw_frame,
                    conf_threshold=0.15,
                    imgsz=DEFAULT_INFERENCE_IMGSZ,
                )
                # Filter through stationary-aware hysteresis tracker
                tracked_detections = self._tracker.update(raw_detections)
            except Exception as e:
                logger.error("Inference failed on live camera frame: %s", e)
                continue

            t_duration_ms = (time.time() - t_start) * 1000
            now = time.time()

            self._inference_timestamps.append(now)
            if len(self._inference_timestamps) >= 2:
                dt = self._inference_timestamps[-1] - self._inference_timestamps[0]
                if dt > 0:
                    self._measured_inference_fps = (len(self._inference_timestamps) - 1) / dt

            # Atomically update latest detection results
            with self._detection_lock:
                self._latest_detections = tracked_detections
                self._latest_person_count = len(tracked_detections)
                self._latest_infer_duration_ms = t_duration_ms
                self._last_inference_epoch = now
                self._last_inference_time_iso = datetime.now(timezone.utc).isoformat()

        logger.debug("Inference worker exited.")

    def _stream_worker(self) -> None:
        """
        Dedicated preview streaming worker.
        Broadcasts preview frames at LIVE_STREAM_TARGET_FPS with latest zone mapping.
        """
        logger.debug("Stream worker started.")
        target_interval = 1.0 / max(1, LIVE_STREAM_TARGET_FPS)

        while self._is_running:
            t_cycle_start = time.time()

            if not self._subscribers:
                time.sleep(0.1)
                continue

            raw_frame = None
            frame_time = 0.0

            with self._frame_lock:
                if self._latest_raw_frame is not None:
                    raw_frame = self._latest_raw_frame.copy()
                    frame_time = self._latest_frame_time

            if raw_frame is None:
                time.sleep(0.02)
                continue

            frame_age_ms = (time.time() - frame_time) * 1000 if frame_time > 0 else 0.0

            with self._detection_lock:
                detections = list(self._latest_detections)
                person_count = self._latest_person_count
                infer_duration_ms = self._latest_infer_duration_ms
                last_infer_iso = self._last_inference_time_iso

            zone_info = VENUE_ZONES.get(self._assigned_zone_id or "")
            zone_code = zone_info["code"] if zone_info else "UNASSIGNED"
            zone_name = zone_info["name"] if zone_info else "Unassigned Zone"

            annotated_b64 = self._render_live_annotation(
                raw_frame,
                detections,
                capture_fps=self._measured_capture_fps,
                inference_fps=self._measured_inference_fps,
                camera_name=self._camera_name,
                zone_code=zone_code,
            )

            if annotated_b64:
                packet = {
                    "type": "frame",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "camera_name": self._camera_name,
                    "device_index": self._device_index,
                    "assigned_zone_id": self._assigned_zone_id,
                    "assigned_zone_name": zone_name,
                    "assigned_zone_code": zone_code,
                    "person_count": person_count,
                    "bounding_boxes": detections,
                    "capture_fps": round(self._measured_capture_fps, 1),
                    "inference_fps": round(self._measured_inference_fps, 1),
                    "inference_duration_ms": round(infer_duration_ms, 1),
                    "frame_age_ms": round(frame_age_ms, 1),
                    "last_inference_time": last_infer_iso,
                    "is_stale": False,
                    "data_source": "LIVE_CAMERA_INFERENCE",
                    "image": annotated_b64,
                    "status": "streaming",
                }
                self._broadcast_packet(packet)

            elapsed = time.time() - t_cycle_start
            sleep_time = target_interval - elapsed
            if sleep_time > 0.001:
                time.sleep(sleep_time)

        logger.debug("Stream worker exited.")

    def _render_live_annotation(
        self,
        image_bgr: np.ndarray,
        detections: List[Dict[str, Any]],
        capture_fps: float,
        inference_fps: float,
        camera_name: str,
        zone_code: str,
    ) -> str:
        """Annotates frame with bounding boxes, stationary labels, and Darshini HUD."""
        annotated = image_bgr.copy()
        orig_h, orig_w = annotated.shape[:2]

        box_color = (141, 95, 54)  # Steel Blue #365F8D in BGR
        stationary_chip_bg = (34, 139, 34)  # Forest Green for confirmed stationary
        moving_chip_bg = (54, 95, 141)  # Steel Blue for moving
        text_color = (255, 255, 255)

        for det in detections:
            xmin, ymin, xmax, ymax = det["box_pixels"]
            cv2.rectangle(annotated, (xmin, ymin), (xmax, ymax), box_color, 2)

            conf_pct = int(det["confidence"] * 100)
            t_id = det.get("track_id", "")
            is_stat = det.get("is_stationary", False)
            chip_bg = stationary_chip_bg if is_stat else moving_chip_bg

            label = f"P#{t_id} {conf_pct}%" + (" [STILL]" if is_stat else "")
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.42
            thickness = 1
            (tw, th), _ = cv2.getTextSize(label, font, font_scale, thickness)

            chip_ymin = max(0, ymin - th - 6)
            chip_ymax = max(th + 6, ymin)
            chip_xmax = min(orig_w - 1, xmin + tw + 8)

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

        # Top Live Telemetry HUD Bar (Darshini Operational Header)
        hud_h = 30
        overlay = annotated.copy()
        cv2.rectangle(overlay, (0, 0), (orig_w, hud_h), (23, 43, 67), cv2.FILLED)  # Dark Navy in BGR
        cv2.addWeighted(overlay, 0.85, annotated, 0.15, 0, annotated)

        hud_text = (
            f"LIVE: {camera_name[:16]} | "
            f"ZONE: {zone_code} | "
            f"PERSONS: {len(detections)} | "
            f"INFER: {inference_fps:.1f} FPS | "
            f"DARSHINI CV"
        )
        cv2.putText(
            annotated,
            hud_text,
            (8, 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

        # Downscale for preview if wider than max preview width
        if orig_w > PREVIEW_MAX_WIDTH:
            scale = PREVIEW_MAX_WIDTH / float(orig_w)
            target_h = int(round(orig_h * scale))
            annotated = cv2.resize(annotated, (PREVIEW_MAX_WIDTH, target_h), interpolation=cv2.INTER_AREA)

        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), PREVIEW_JPEG_QUALITY]
        success, buffer = cv2.imencode(".jpg", annotated, encode_params)
        if not success:
            return ""

        b64 = base64.b64encode(buffer).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    def process_client_frame(
        self,
        client_id: str,
        image_data: Union[str, bytes],
        zone_id: Optional[str] = None,
        camera_name: str = "Browser Camera",
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    ) -> Dict[str, Any]:
        """
        Processes a single live camera frame sent from a client's browser.
        Performs genuine YOLOv8 person detection, stationary-person hysteresis tracking,
        computes client-specific inference telemetry, generates an annotated frame,
        and atomically updates the assigned venue zone.
        """
        if not model_service.is_ready:
            raise ModelUnavailableError(
                model_service.error_message or "Detection model is not available or weights are missing."
            )

        # 1. Decode image data (base64 string or binary bytes)
        frame_bgr: Optional[np.ndarray] = None
        try:
            if isinstance(image_data, str):
                if "," in image_data:
                    _, b64_str = image_data.split(",", 1)
                else:
                    b64_str = image_data
                raw_bytes = base64.b64decode(b64_str)
            elif isinstance(image_data, bytes):
                raw_bytes = image_data
            else:
                raise ValueError("Unsupported image_data type")

            np_buf = np.frombuffer(raw_bytes, dtype=np.uint8)
            frame_bgr = cv2.imdecode(np_buf, cv2.IMREAD_COLOR)
        except Exception as e:
            logger.warning("Failed to decode client frame from '%s': %s", client_id, e)
            raise ValueError(f"Invalid image frame encoding: {e}")

        if frame_bgr is None or frame_bgr.size == 0:
            raise ValueError("Decoded image frame is empty or corrupted.")

        # 2. Get or initialize client-specific stationary hysteresis tracker
        with self._detection_lock:
            if client_id not in self._client_trackers:
                self._client_trackers[client_id] = StationaryPersonTracker()
            tracker = self._client_trackers[client_id]

            if client_id not in self._client_timestamps:
                self._client_timestamps[client_id] = deque(maxlen=20)
            t_deque = self._client_timestamps[client_id]

        now = time.time()
        t_deque.append(now)
        client_infer_fps = 0.0
        if len(t_deque) >= 2:
            dt = t_deque[-1] - t_deque[0]
            if dt > 0:
                client_infer_fps = (len(t_deque) - 1) / dt

        # 3. Run genuine computer-vision inference
        t_start = time.time()
        raw_detections = model_service.detect_persons(
            frame_bgr,
            conf_threshold=0.15,
            imgsz=DEFAULT_INFERENCE_IMGSZ,
        )
        tracked_detections = tracker.update(raw_detections)
        infer_duration_ms = (time.time() - t_start) * 1000

        # Filter by requested confidence threshold if higher than 0.15 and normalize primitives
        final_detections = [
            {
                **d,
                "track_id": int(d.get("track_id", 0)),
                "confidence": float(d.get("confidence", 0.0)),
                "is_stationary": bool(d.get("is_stationary", False)),
            }
            for d in tracked_detections
            if bool(d.get("is_stationary", False)) or float(d.get("confidence", 0.0)) >= conf_threshold
        ]

        # 4. Resolve zone assignment
        target_zone = zone_id or self._assigned_zone_id or "zone-north-plaza"
        zone_info = VENUE_ZONES.get(target_zone)
        zone_code = zone_info["code"] if zone_info else "Z-??"
        zone_name = zone_info["name"] if zone_info else "Unknown Zone"

        # 5. Render live annotation with Darshini HUD
        annotated_b64 = self._render_live_annotation(
            frame_bgr,
            final_detections,
            capture_fps=client_infer_fps,
            inference_fps=client_infer_fps,
            camera_name=camera_name,
            zone_code=zone_code,
        )

        iso_now = datetime.now(timezone.utc).isoformat()
        completion_time = time.time()

        # 6. Record active observation for zone status mapping
        with self._detection_lock:
            self._active_zone_observations[target_zone] = {
                "client_id": client_id,
                "camera_name": camera_name,
                "count": len(final_detections),
                "timestamp": completion_time,
                "iso_time": iso_now,
                "inference_fps": client_infer_fps,
                "duration_ms": infer_duration_ms,
            }

        return {
            "type": "frame",
            "frame_id": int(now * 1000) % 1000000,
            "timestamp": iso_now,
            "device_index": -1,
            "camera_name": camera_name,
            "assigned_zone_id": target_zone,
            "assigned_zone_name": zone_name,
            "person_count": len(final_detections),
            "detections": final_detections,
            "inference_fps": round(client_infer_fps, 1),
            "inference_duration_ms": round(infer_duration_ms, 1),
            "frame_age_ms": round((time.time() - now) * 1000, 1),
            "last_inference_time": iso_now,
            "is_stale": False,
            "data_source": "LIVE_CAMERA_INFERENCE",
            "image": annotated_b64,
            "status": "streaming",
        }

    def mark_client_disconnected(self, client_id: str) -> None:
        """Cleans up client tracker state and invalidates any zone observations from this client."""
        with self._detection_lock:
            self._client_trackers.pop(client_id, None)
            self._client_timestamps.pop(client_id, None)
            zones_to_clear = [
                z_id for z_id, obs in self._active_zone_observations.items()
                if obs.get("client_id") == client_id
            ]
            for z_id in zones_to_clear:
                self._active_zone_observations.pop(z_id, None)
        logger.info("Cleaned up client '%s' observation session (cleared zones: %s)", client_id, zones_to_clear)

    def register_subscriber(self, queue: asyncio.Queue, loop: Optional[asyncio.AbstractEventLoop] = None) -> None:
        """Adds a client queue for receiving live stream frames."""
        self._subscribers.add(queue)
        if loop is not None:
            self._loop = loop
        elif self._loop is None:
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                pass

    def unregister_subscriber(self, queue: asyncio.Queue) -> None:
        """Removes a client queue."""
        self._subscribers.discard(queue)
        if len(self._subscribers) == 0:
            self._last_subscriber_disconnect = time.time()

    def _broadcast_packet(self, packet: Dict[str, Any]) -> None:
        """Dispatches packet to all active subscriber queues on the asyncio loop in a thread-safe manner."""
        if not self._subscribers or self._loop is None or self._loop.is_closed():
            return

        for queue in list(self._subscribers):
            try:
                self._loop.call_soon_threadsafe(_safe_dispatch_to_queue, queue, packet)
            except Exception as e:
                logger.debug("Failed to schedule packet dispatch: %s", e)


def _safe_dispatch_to_queue(q: asyncio.Queue, pkt: Dict[str, Any]) -> None:
    """Thread-safe queue dispatch helper executed on the event loop."""
    if q.full():
        try:
            q.get_nowait()
        except (asyncio.QueueEmpty, ValueError):
            pass
    try:
        q.put_nowait(pkt)
    except (asyncio.QueueFull, ValueError):
        pass


# Singleton instance
live_camera_manager = LiveCameraManager()
