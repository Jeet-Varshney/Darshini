"""
CrowdFlow Sentinel - Camera Discovery & Live Capture Tests
Tests for camera discovery, readability validation, lifecycle control, and model-readiness guards.
"""

from unittest.mock import patch, PropertyMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.camera_discovery import camera_discovery_service
from app.services.camera_stream import live_camera_manager
from app.services.model_service import model_service


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_discover_cameras_endpoint(client):
    """Verify /api/cameras discovers system video devices and filters readability."""
    response = client.get("/api/cameras")
    assert response.status_code == 200
    data = response.json()
    assert "cameras" in data
    assert "count" in data
    assert "readable_count" in data
    assert data["count"] >= 0

    if data["count"] > 0:
        first = data["cameras"][0]
        assert "id" in first
        assert "name" in first
        assert "device_path" in first
        assert "device_type" in first
        assert "is_readable" in first


def test_camera_status_endpoint(client):
    """Verify /api/camera/status returns current streaming telemetry."""
    response = client.get("/api/camera/status")
    assert response.status_code == 200
    data = response.json()
    assert "is_streaming" in data
    assert "model_ready" in data
    assert "inference_fps" in data
    assert "active_subscribers" in data


def test_start_camera_invalid_index(client):
    """Verify activating an invalid camera index (e.g. 999) returns 400 Bad Request."""
    response = client.post(
        "/api/camera/start",
        json={"device_index": 999, "conf_threshold": 0.25},
    )
    assert response.status_code == 400
    assert "cannot open" in response.json()["detail"].lower() or "failed" in response.json()["detail"].lower()


def test_start_camera_model_unavailable(client):
    """Verify activating camera when model is unavailable returns 503."""
    with patch.object(type(model_service), "is_ready", new_callable=PropertyMock, return_value=False), \
         patch.object(type(model_service), "error_message", new_callable=PropertyMock, return_value="Model unavailable"):
        response = client.post(
            "/api/camera/start",
            json={"device_index": 0, "conf_threshold": 0.25},
        )
        assert response.status_code == 503
        assert "unavailable" in response.json()["detail"].lower()


def test_camera_start_and_stop_lifecycle(client):
    """Verify starting and stopping a readable camera releases the hardware cleanly."""
    cams = camera_discovery_service.discover_cameras(test_read=True)
    readable = [c for c in cams if c["is_readable"]]
    if not readable:
        pytest.skip("No physical or virtual camera device available on this host.")

    target_idx = readable[0]["index"]

    # 1. Start camera
    start_res = client.post(
        "/api/camera/start",
        json={"device_index": target_idx, "conf_threshold": 0.25},
    )
    assert start_res.status_code == 200
    start_data = start_res.json()
    assert start_data["is_streaming"] is True
    assert start_data["active_device_index"] == target_idx

    # 2. Stop camera
    stop_res = client.post("/api/camera/stop")
    assert stop_res.status_code == 200
    stop_data = stop_res.json()
    assert stop_data["is_streaming"] is False
    assert live_camera_manager.is_running is False
