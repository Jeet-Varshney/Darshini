"""
Darshini - Video Processing Service
Decodes video frames using OpenCV, samples frames at controlled intervals,
runs real model inference, generates annotated preview images, and aggregates telemetry.
"""

import base64
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import cv2
import numpy as np

from app.config import (
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_SAMPLE_FPS,
    MAX_FRAMES_TO_PROCESS,
    PREVIEW_MAX_WIDTH,
    PREVIEW_JPEG_QUALITY,
)
from app.schemas import BoundingBox, FrameDetection, DetectionResponse
from app.services.model_service import ModelService, ModelUnavailableError

logger = logging.getLogger("darshini.video_service")


class VideoProcessingError(Exception):
    """Raised when video decoding or processing encounters an error."""
    pass


class VideoProcessor:
    """Manages video file decoding, sampling, frame annotation, and preview generation."""

    def __init__(self, model_service: ModelService):
        self.model_service = model_service

    def inspect_video(self, video_path: Path) -> Dict[str, Any]:
        """
        Extracts native video metadata using OpenCV.
        Raises VideoProcessingError if the video cannot be opened.
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise VideoProcessingError(
                f"Could not open video file '{video_path.name}'. Format may be unsupported or corrupted."
            )

        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()

        # Handle corrupt or zero-fps cases
        if fps <= 0 or np.isnan(fps):
            fps = 25.0
        if frame_count <= 0:
            frame_count = 1

        duration_sec = round(float(frame_count / fps), 2)

        return {
            "frame_count": frame_count,
            "fps": round(fps, 2),
            "width": width,
            "height": height,
            "resolution": f"{width}x{height}",
            "duration_sec": duration_sec,
        }

    def process_video(
        self,
        video_path: Path,
        filename: str,
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
        sample_fps: float = DEFAULT_SAMPLE_FPS,
        max_frames: int = MAX_FRAMES_TO_PROCESS,
    ) -> DetectionResponse:
        """
        Decodes video, samples frames at `sample_fps`, executes model inference,
        and constructs an annotated preview frame from the frame with peak detections.
        """
        start_time = time.time()
        video_meta = self.inspect_video(video_path)

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise VideoProcessingError(f"Failed to open video stream for '{filename}'.")

        fps = video_meta["fps"]
        native_frame_count = video_meta["frame_count"]

        # Calculate sample step in frames (e.g. if 30fps and sample_fps=1, sample every 30th frame)
        sample_step = max(1, int(round(fps / max(0.1, sample_fps))))

        sampled_frames_data: List[FrameDetection] = []
        peak_person_count = 0
        peak_frame_index = 0
        peak_frame_img: Optional[np.ndarray] = None
        first_frame_img: Optional[np.ndarray] = None
        first_frame_index = 0

        current_frame_idx = 0
        sampled_count = 0

        try:
            while cap.isOpened() and sampled_count < max_frames:
                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                # Only evaluate frames that align with the sampling interval
                if current_frame_idx % sample_step == 0:
                    timestamp_sec = round(float(current_frame_idx / fps), 2)

                    if first_frame_img is None:
                        first_frame_img = frame.copy()
                        first_frame_index = current_frame_idx

                    # Run actual model inference on this frame
                    raw_detections = self.model_service.detect_persons(
                        frame, conf_threshold=conf_threshold
                    )

                    box_objects: List[BoundingBox] = [
                        BoundingBox(
                            box_pixels=det["box_pixels"],
                            box_normalized=det["box_normalized"],
                            ground_contact_normalized=det.get("ground_contact_normalized"),
                            confidence=det["confidence"],
                            class_id=det["class_id"],
                            class_name=det["class_name"],
                        )
                        for det in raw_detections
                    ]

                    person_count = len(box_objects)

                    sampled_frames_data.append(
                        FrameDetection(
                            frame_index=current_frame_idx,
                            timestamp_sec=timestamp_sec,
                            person_count=person_count,
                            bounding_boxes=box_objects,
                        )
                    )

                    # Track the frame with highest person detections for the preview frame
                    if person_count > peak_person_count or peak_frame_img is None:
                        peak_person_count = person_count
                        peak_frame_index = current_frame_idx
                        peak_frame_img = frame.copy()

                    sampled_count += 1

                current_frame_idx += 1
        finally:
            cap.release()

        inference_duration_sec = round(time.time() - start_time, 3)
        total_detections = sum(fd.person_count for fd in sampled_frames_data)

        # Decide preview frame: either the peak frame, or first frame if zero detections
        preview_img = peak_frame_img if peak_frame_img is not None else first_frame_img
        chosen_preview_idx = peak_frame_index if peak_frame_img is not None else first_frame_index

        preview_b64: Optional[str] = None
        if preview_img is not None:
            # Find the detection records for this chosen preview frame
            matching_boxes = next(
                (fd.bounding_boxes for fd in sampled_frames_data if fd.frame_index == chosen_preview_idx),
                [],
            )
            preview_b64 = self._generate_annotated_preview(
                image_bgr=preview_img,
                boxes=matching_boxes,
                frame_idx=chosen_preview_idx,
                total_detected=len(matching_boxes),
                model_name=self.model_service.model_name,
            )

        # Status determination: honest reflection of detection outcome
        if total_detections == 0:
            status = "zero_detections"
            message = (
                f"Inference completed across {len(sampled_frames_data)} sampled frames. "
                f"Zero people were detected at confidence >= {conf_threshold}."
            )
        else:
            status = "completed"
            message = (
                f"Inference completed across {len(sampled_frames_data)} sampled frames. "
                f"Detected {total_detections} total person instances with a peak of {peak_person_count} persons in frame #{peak_frame_index}."
            )

        return DetectionResponse(
            status=status,
            timestamp=datetime.now(timezone.utc).isoformat(),
            model_name=self.model_service.model_name,
            model_ready=True,
            device=self.model_service.device,
            filename=filename,
            video_duration_sec=video_meta["duration_sec"],
            video_fps=video_meta["fps"],
            video_resolution=video_meta["resolution"],
            total_frames_sampled=len(sampled_frames_data),
            max_person_count=peak_person_count,
            total_person_detections=total_detections,
            frames=sampled_frames_data,
            preview_frame_base64=preview_b64,
            preview_frame_index=chosen_preview_idx,
            message=message,
            inference_duration_sec=inference_duration_sec,
        )

    def _generate_annotated_preview(
        self,
        image_bgr: np.ndarray,
        boxes: List[BoundingBox],
        frame_idx: int,
        total_detected: int,
        model_name: str,
    ) -> str:
        """
        Draws bounding boxes, confidence tags, and a command center HUD header on the preview frame,
        then encodes it to a base64 JPEG data URI.
        """
        annotated = image_bgr.copy()
        h, w = annotated.shape[:2]

        # Colors (BGR):
        # Steel blue accent: #365F8D -> BGR: (141, 95, 54)
        # Accent light/high contrast: BGR: (234, 180, 54) / Amber: (54, 150, 234)
        box_color = (141, 95, 54)  # Steel blue in BGR
        chip_bg = (54, 95, 141)
        text_color = (255, 255, 255)

        # 1. Draw each detected person's bounding box and confidence tag
        for b in boxes:
            xmin, ymin, xmax, ymax = b.box_pixels
            # Bounding box
            cv2.rectangle(annotated, (xmin, ymin), (xmax, ymax), box_color, 2)

            # Confidence label chip
            label = f"Person {int(b.confidence * 100)}%"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.45
            thickness = 1
            (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, thickness)

            chip_ymin = max(0, ymin - text_h - 6)
            chip_ymax = max(text_h + 6, ymin)
            chip_xmax = min(w - 1, xmin + text_w + 8)

            cv2.rectangle(
                annotated,
                (xmin, chip_ymin),
                (chip_xmax, chip_ymax),
                chip_bg,
                cv2.FILLED,
            )
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

        # 2. Draw HUD header banner across top of frame
        banner_h = 32
        overlay = annotated.copy()
        cv2.rectangle(overlay, (0, 0), (w, banner_h), (23, 43, 67), cv2.FILLED)  # Dark Navy #172B43 in BGR
        cv2.addWeighted(overlay, 0.85, annotated, 0.15, 0, annotated)

        hud_text = (
            f"DARSHINI CV | FRAME #{frame_idx} | "
            f"DETECTED PERSONS: {total_detected} | "
            f"MODEL: {model_name}"
        )
        cv2.putText(
            annotated,
            hud_text,
            (10, 21),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

        # 3. Scale down if wider than max preview width to optimize payload transfer
        if w > PREVIEW_MAX_WIDTH:
            scale = PREVIEW_MAX_WIDTH / float(w)
            new_w = PREVIEW_MAX_WIDTH
            new_h = int(round(h * scale))
            annotated = cv2.resize(annotated, (new_w, new_h), interpolation=cv2.INTER_AREA)

        # 4. Encode to JPEG base64 data URI
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), PREVIEW_JPEG_QUALITY]
        success, buffer = cv2.imencode(".jpg", annotated, encode_params)
        if not success:
            return ""

        b64_str = base64.b64encode(buffer).decode("utf-8")
        return f"data:image/jpeg;base64,{b64_str}"
