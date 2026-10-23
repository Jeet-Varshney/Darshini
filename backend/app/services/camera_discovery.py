"""
Darshini - Universal Camera Discovery Service
Discovers, inspects, and validates any readable video device exposed by the OS
(built-in laptop webcams, external USB webcams, Iriun virtual devices, DroidCam, etc.).
"""

import glob
import logging
import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Any
import cv2

logger = logging.getLogger("darshini.camera_discovery")


class CameraDiscoveryService:
    """Discovers and inspects V4L2 and generic video capture devices."""

    def __init__(self):
        self._cached_cameras: Optional[List[Dict[str, Any]]] = None
        self._last_scan_time: float = 0.0

    def discover_cameras(self, test_read: bool = True) -> List[Dict[str, Any]]:
        """
        Discovers all /dev/video* devices and queries their V4L2 metadata.
        If test_read=True, attempts to open each device briefly to verify
        whether it can produce actual frames (distinguishing capture nodes from metadata nodes).
        """
        cameras: List[Dict[str, Any]] = []

        # Find all /sys/class/video4linux/video* entries
        sys_paths = sorted(
            glob.glob("/sys/class/video4linux/video*"),
            key=lambda p: self._extract_node_number(p),
        )

        if sys_paths:
            for sys_path in sys_paths:
                cam_info = self._inspect_sysfs_device(sys_path, test_read=test_read)
                if cam_info:
                    cameras.append(cam_info)
        else:
            # Fallback for systems without /sys/class/video4linux: probe indices 0..9
            logger.info("Sysfs video4linux not found; probing indices 0..5 via OpenCV fallback...")
            for idx in range(6):
                cam_info = self._probe_index(idx, test_read=test_read)
                if cam_info:
                    cameras.append(cam_info)

        self._cached_cameras = cameras
        return cameras

    def _extract_node_number(self, path: str) -> int:
        base = os.path.basename(path)
        match = re.search(r"video(\d+)$", base)
        return int(match.group(1)) if match else 999

    def _inspect_sysfs_device(self, sys_path: str, test_read: bool) -> Optional[Dict[str, Any]]:
        idx = self._extract_node_number(sys_path)
        dev_path = f"/dev/video{idx}"

        if not os.path.exists(dev_path):
            return None

        # 1. Read hardware/driver name from sysfs
        raw_name = "Generic Video Device"
        name_file = os.path.join(sys_path, "name")
        if os.path.exists(name_file):
            try:
                with open(name_file, "r", encoding="utf-8", errors="ignore") as f:
                    raw_name = f.read().strip()
            except OSError as e:
                logger.debug("Could not read device name for %s: %s", sys_path, e)

        # 2. Identify device type (Virtual vs Physical USB / Built-in)
        real_target = os.path.realpath(sys_path).lower()
        if "virtual" in real_target or "iriun" in raw_name.lower() or "droidcam" in raw_name.lower():
            device_type = "VIRTUAL"
            type_label = "Virtual Webcam"
        elif "usb" in real_target:
            device_type = "PHYSICAL"
            type_label = "USB / Built-in Webcam"
        else:
            device_type = "PHYSICAL"
            type_label = "System Video Device"

        friendly_name = f"{raw_name} ({type_label})"

        # 3. Check readability with OpenCV if requested
        is_readable = False
        resolution = "N/A"
        error_reason: Optional[str] = None

        if test_read:
            is_readable, resolution, error_reason = self._test_capture(idx)
        else:
            is_readable = True
            resolution = "Pending Check"

        return {
            "id": str(idx),
            "index": idx,
            "name": friendly_name,
            "raw_name": raw_name,
            "device_path": dev_path,
            "device_type": device_type,
            "is_readable": is_readable,
            "resolution": resolution,
            "error_reason": error_reason,
        }

    def _probe_index(self, idx: int, test_read: bool) -> Optional[Dict[str, Any]]:
        """Probes a raw OpenCV capture index when sysfs is unavailable."""
        is_readable, resolution, error_reason = self._test_capture(idx)
        if not is_readable and error_reason and "cannot open" in error_reason.lower():
            return None

        return {
            "id": str(idx),
            "index": idx,
            "name": f"Camera Device #{idx}",
            "raw_name": f"Video {idx}",
            "device_path": f"/dev/video{idx}",
            "device_type": "UNKNOWN",
            "is_readable": is_readable,
            "resolution": resolution,
            "error_reason": error_reason,
        }

    def _test_capture(self, idx: int) -> tuple[bool, str, Optional[str]]:
        """Safely test-opens a video index to check for readable frames."""
        try:
            cap = cv2.VideoCapture(idx)
            if not cap.isOpened():
                return False, "N/A", "Device node cannot be opened (metadata node, busy, or permission denied)"

            ret, frame = cap.read()
            cap.release()

            if ret and frame is not None and frame.size > 0:
                h, w = frame.shape[:2]
                return True, f"{w}x{h}", None
            else:
                return False, "N/A", "Device opened but failed to produce a valid video frame"
        except Exception as e:
            return False, "N/A", f"Exception testing camera capture: {str(e)}"


# Singleton instance
camera_discovery_service = CameraDiscoveryService()
