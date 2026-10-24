"""
Darshini - Computer Vision Model Service
Manages pretrained YOLO model lifecycle, CPU inference, and person class filtering.
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

import os
import torch
from app.config import (
    MODEL_PATH,
    MODEL_NAME,
    PERSON_CLASS_ID,
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_INFERENCE_IMGSZ,
)

logger = logging.getLogger("darshini.model_service")


class ModelUnavailableError(Exception):
    """Raised when inference is requested while the model is not loaded."""
    pass


class ModelService:
    """Encapsulates pretrained YOLO object detection for person detection."""

    def __init__(self, weights_path: Path = MODEL_PATH):
        self.weights_path = Path(weights_path)
        self.model_name = MODEL_NAME
        self.person_class_id = PERSON_CLASS_ID
        self.device = "cpu"
        self._model = None
        self._is_ready = False
        self._error_message: Optional[str] = None

    def initialize(self) -> bool:
        """Loads model weights from disk. Safe to call multiple times."""
        if self._is_ready and self._model is not None:
            return True

        if not self.weights_path.exists():
            self._is_ready = False
            self._error_message = (
                f"Model weights file not found at '{self.weights_path}'. "
                f"Inference is unavailable until weights are placed."
            )
            logger.warning(self._error_message)
            return False

        try:
            from ultralytics import YOLO

            # Configure optimal CPU thread pool (clamp to physical core budget)
            cpu_threads = min(4, os.cpu_count() or 1)
            torch.set_num_threads(cpu_threads)
            logger.info("Configured PyTorch CPU thread pool to %d threads.", cpu_threads)

            logger.info("Loading pretrained YOLO model from %s on CPU...", self.weights_path)
            model = YOLO(str(self.weights_path))
            
            # Verify person class exists in model taxonomy
            names = model.names if hasattr(model, "names") else {}
            person_label = names.get(self.person_class_id, "unknown")
            if person_label != "person":
                logger.warning(
                    "Class ID %d is '%s' in model taxonomy (expected 'person').",
                    self.person_class_id,
                    person_label,
                )

            self._model = model
            self._is_ready = True
            self._error_message = None
            logger.info("YOLO model successfully initialized on device '%s'.", self.device)
            return True
        except Exception as e:
            self._model = None
            self._is_ready = False
            self._error_message = f"Failed to initialize YOLO model: {str(e)}"
            logger.error(self._error_message, exc_info=True)
            return False

    @property
    def is_ready(self) -> bool:
        return self._is_ready and self._model is not None

    @is_ready.setter
    def is_ready(self, value: bool) -> None:
        self._is_ready = value
        if not value:
            self._model = None

    @property
    def error_message(self) -> Optional[str]:
        return self._error_message

    def detect_persons(
        self,
        image_bgr: np.ndarray,
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
        imgsz: int = DEFAULT_INFERENCE_IMGSZ,
    ) -> List[Dict[str, Any]]:
        """
        Runs real model inference on a single BGR frame and returns detected persons.
        Uses torch.inference_mode() and configurable imgsz for rapid CPU evaluation.
        """
        if not self.is_ready:
            raise ModelUnavailableError(
                self._error_message or "Detection model is not available or weights are missing."
            )

        h, w = image_bgr.shape[:2]
        if h <= 0 or w <= 0:
            return []

        # Run model inference on CPU within torch.inference_mode()
        with torch.inference_mode():
            results = self._model(
                image_bgr,
                device=self.device,
                conf=conf_threshold,
                classes=[self.person_class_id],
                imgsz=imgsz,
                verbose=False,
            )

        detections: List[Dict[str, Any]] = []
        if not results:
            return detections

        first_res = results[0]
        if not hasattr(first_res, "boxes") or first_res.boxes is None:
            return detections

        for box in first_res.boxes:
            cls_id = int(box.cls[0].item())
            if cls_id != self.person_class_id:
                continue

            conf = float(box.conf[0].item())
            xyxy = box.xyxy[0].tolist()
            xmin, ymin, xmax, ymax = [int(round(coord)) for coord in xyxy]

            # Clamp coordinates to frame boundaries
            xmin = max(0, min(w - 1, xmin))
            ymin = max(0, min(h - 1, ymin))
            xmax = max(xmin, min(w - 1, xmax))
            ymax = max(ymin, min(h - 1, ymax))

            # Normalized [ymin, xmin, ymax, xmax]
            norm_ymin = round(float(ymin / h), 4)
            norm_xmin = round(float(xmin / w), 4)
            norm_ymax = round(float(ymax / h), 4)
            norm_xmax = round(float(xmax / w), 4)

            # Ground-contact point [x_ground, y_ground] (bottom-center on ground plane)
            ground_x = round(float((norm_xmin + norm_xmax) / 2.0), 4)
            ground_y = round(float(norm_ymax), 4)

            detections.append({
                "box_pixels": [xmin, ymin, xmax, ymax],
                "box_normalized": [norm_ymin, norm_xmin, norm_ymax, norm_xmax],
                "ground_contact_normalized": [ground_x, ground_y],
                "confidence": round(conf, 4),
                "class_id": self.person_class_id,
                "class_name": "person",
            })

        return detections


# Global singleton instance
model_service = ModelService()
