"""
CrowdFlow Sentinel - Computer Vision Detection Pipeline Tests
Tests for video upload validation, real YOLO inference, zero detection handling,
model-unavailable behavior, and temporary-file cleanup.
"""

import io
from pathlib import Path
from unittest.mock import PropertyMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import TEMP_UPLOAD_DIR
from app.services.model_service import model_service

SAMPLE_VIDEO_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "samples"
GATE1_SAMPLE = SAMPLE_VIDEO_DIR / "gate1_sample.mp4"
EMPTY_SAMPLE = SAMPLE_VIDEO_DIR / "empty_zone_sample.mp4"


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_detect_unsupported_file_extension(client):
    """Verify API rejects non-video file formats with 400 Bad Request."""
    dummy_file = io.BytesIO(b"Hello plain text")
    response = client.post(
        "/api/detect/video",
        files={"file": ("malicious.txt", dummy_file, "text/plain")},
    )
    assert response.status_code == 400
    assert "unsupported video format" in response.json()["detail"].lower()


def test_detect_empty_file(client):
    """Verify API rejects 0-byte video files with 400 Bad Request."""
    empty_file = io.BytesIO(b"")
    response = client.post(
        "/api/detect/video",
        files={"file": ("empty.mp4", empty_file, "video/mp4")},
    )
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_detect_when_model_unavailable(client):
    """Verify API returns 503 Service Unavailable when model is not ready."""
    with patch.object(type(model_service), "is_ready", new_callable=PropertyMock, return_value=False), \
         patch.object(type(model_service), "error_message", new_callable=PropertyMock, return_value="Inference model is unavailable: weights missing"):
        dummy_video = io.BytesIO(b"fake video data")
        response = client.post(
            "/api/detect/video",
            files={"file": ("test.mp4", dummy_video, "video/mp4")},
        )
        assert response.status_code == 503
        assert "unavailable" in response.json()["detail"].lower()


def test_genuine_person_detection(client):
    """Verify genuine model inference extracts real persons and returns valid metadata schema."""
    assert GATE1_SAMPLE.exists(), f"Sample video {GATE1_SAMPLE} must exist for smoke test."

    with open(GATE1_SAMPLE, "rb") as f:
        response = client.post(
            "/api/detect/video",
            files={"file": ("gate1_sample.mp4", f, "video/mp4")},
            data={"conf_threshold": 0.25, "sample_fps": 1.0},
        )

    assert response.status_code == 200
    data = response.json()

    # Verify response schema
    assert data["status"] == "completed"
    assert data["model_ready"] is True
    assert "YOLO" in data["model_name"]
    assert data["filename"] == "gate1_sample.mp4"
    assert data["total_frames_sampled"] > 0
    assert data["max_person_count"] > 0
    assert data["total_person_detections"] > 0
    assert data["inference_duration_sec"] > 0

    # Verify frame detections
    assert len(data["frames"]) > 0
    first_frame = data["frames"][0]
    assert "frame_index" in first_frame
    assert "timestamp_sec" in first_frame
    assert "person_count" in first_frame
    assert len(first_frame["bounding_boxes"]) > 0

    # Verify bounding box coordinates
    first_box = first_frame["bounding_boxes"][0]
    assert first_box["class_name"] == "person"
    assert first_box["class_id"] == 0
    assert 0.0 <= first_box["confidence"] <= 1.0
    assert len(first_box["box_normalized"]) == 4
    # Check normalized coordinate ranges [0, 1]
    for coord in first_box["box_normalized"]:
        assert 0.0 <= coord <= 1.0

    # Verify annotated preview
    assert data["preview_frame_base64"] is not None
    assert data["preview_frame_base64"].startswith("data:image/jpeg;base64,")


def test_zero_detections_on_empty_video(client):
    """Verify zero detections is handled honestly without synthetic fallback."""
    assert EMPTY_SAMPLE.exists(), f"Empty sample video {EMPTY_SAMPLE} must exist."

    with open(EMPTY_SAMPLE, "rb") as f:
        response = client.post(
            "/api/detect/video",
            files={"file": ("empty_zone_sample.mp4", f, "video/mp4")},
            data={"conf_threshold": 0.25, "sample_fps": 1.0},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "zero_detections"
    assert data["total_person_detections"] == 0
    assert data["max_person_count"] == 0
    assert "zero people were detected" in data["message"].lower()


def test_temp_file_cleanup_after_processing(client):
    """Verify no temporary files remain in temp_uploads after video analysis."""
    initial_files = list(TEMP_UPLOAD_DIR.glob("*"))

    with open(GATE1_SAMPLE, "rb") as f:
        response = client.post(
            "/api/detect/video",
            files={"file": ("gate1_sample.mp4", f, "video/mp4")},
        )
    assert response.status_code == 200

    remaining_files = list(TEMP_UPLOAD_DIR.glob("*"))
    assert len(remaining_files) == len(initial_files)


def test_temp_file_cleanup_on_corrupt_video(client):
    """Verify temporary files are deleted even if video processing fails."""
    initial_files = list(TEMP_UPLOAD_DIR.glob("*"))

    # Upload random binary gibberish labeled as .mp4
    corrupt_data = io.BytesIO(b"RIFF\x00\x00\x00\x00NOT_A_REAL_MP4_CORRUPTED_BYTES")
    response = client.post(
        "/api/detect/video",
        files={"file": ("corrupt.mp4", corrupt_data, "video/mp4")},
    )
    assert response.status_code == 400

    remaining_files = list(TEMP_UPLOAD_DIR.glob("*"))
    assert len(remaining_files) == len(initial_files)
