"""
CrowdFlow Sentinel - Camera Discovery & Live Capture Tests
Tests for camera discovery, readability validation, lifecycle control, and model-readiness guards.
"""

import json
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


def test_assign_camera_zone_endpoint(client):
    """Verify assigning a camera to a configured venue zone."""
    response = client.post(
        "/api/camera/assign-zone",
        json={"device_index": 0, "zone_id": "zone-north-plaza"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["assigned_zone_id"] == "zone-north-plaza"
    assert data["assigned_zone_name"] == "North Gate Plaza"


def test_zones_live_status_endpoint(client):
    """Verify /api/zones/live-status returns all 5 zones and provenance disclaimers."""
    response = client.get("/api/zones/live-status")
    assert response.status_code == 200
    data = response.json()
    assert "zones" in data
    assert len(data["zones"]) == 5
    assert "multiple_camera_disclaimer" in data

    # Check North Gate Plaza zone record
    north_plaza = next((z for z in data["zones"] if z["zone_id"] == "zone-north-plaza"), None)
    assert north_plaza is not None
    assert north_plaza["zone_code"] == "Z-01"
    assert "area_sqm" in north_plaza
    assert north_plaza["area_sqm"] == 1200.0


def test_infer_client_frame_endpoint(client):
    """Verify client browser frame inference updates zone status with genuine CV output."""
    import base64
    import cv2
    import numpy as np

    # Create dummy black test image
    test_img = np.zeros((240, 320, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", test_img)
    b64_data = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"

    response = client.post(
        "/api/camera/infer-frame",
        json={
            "image": b64_data,
            "zone_id": "zone-central-concourse",
            "camera_name": "MacBook FaceTime HD Camera",
            "conf_threshold": 0.25,
            "client_id": "test-browser-client-01",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "frame"
    assert data["assigned_zone_id"] == "zone-central-concourse"
    assert data["assigned_zone_name"] == "Central Promenade"
    assert data["camera_name"] == "MacBook FaceTime HD Camera"
    assert data["person_count"] == 0
    assert data["image"].startswith("data:image/jpeg;base64,")

    # Verify that Central Promenade zone now shows live STREAMING status
    zone_res = client.get("/api/zones/live-status")
    assert zone_res.status_code == 200
    zones = zone_res.json()["zones"]
    central_zone = next((z for z in zones if z["zone_id"] == "zone-central-concourse"), None)
    assert central_zone is not None
    assert central_zone["status"] == "STREAMING"
    assert central_zone["camera_assigned"] is True
    assert central_zone["camera_name"] == "MacBook FaceTime HD Camera"
    assert central_zone["instantaneous_count"] == 0
    assert central_zone["is_stale"] is False

    # Cleanup client
    live_camera_manager.mark_client_disconnected("test-browser-client-01")


def test_numpy_bool_and_scalar_json_serialization():
    """Verify safe_json_dumps handles np.bool_, np.floating, np.integer without TypeError."""
    import numpy as np
    from app.api.routes import safe_json_dumps
    from app.services.camera_stream import StationaryPersonTracker

    # 1. Direct safe_json_dumps verification with numpy primitives
    payload = {
        "is_stationary": np.bool_(True),
        "is_moving": np.bool_(False),
        "confidence": np.float32(0.88),
        "count": np.int64(5),
        "coordinates": np.array([10, 20, 100, 200]),
        "status": "active"
    }

    serialized = safe_json_dumps(payload)
    assert isinstance(serialized, str)
    decoded = json.loads(serialized)
    assert decoded["is_stationary"] is True
    assert decoded["is_moving"] is False
    assert abs(decoded["confidence"] - 0.88) < 1e-4
    assert decoded["count"] == 5
    assert decoded["coordinates"] == [10, 20, 100, 200]

    # 2. Verify StationaryPersonTracker explicitly produces standard Python bool
    tracker = StationaryPersonTracker()
    det1 = {
        "box_pixels": [50, 50, 150, 150],
        "box_normalized": [0.1, 0.1, 0.3, 0.3],
        "confidence": 0.85,
    }
    # First frame - new track
    res1 = tracker.update([det1])
    assert len(res1) == 1
    assert type(res1[0]["is_stationary"]) is bool

    # Second frame with minimal movement
    det2 = {
        "box_pixels": [51, 51, 151, 151],
        "box_normalized": [0.1, 0.1, 0.3, 0.3],
        "confidence": 0.82,
    }
    res2 = tracker.update([det2])
    assert len(res2) == 1
    assert type(res2[0]["is_stationary"]) is bool
    assert res2[0]["is_stationary"] is True


def test_consecutive_client_frames_processing(client):
    """Verify multiple consecutive client frames update hysteresis tracking without freezing."""
    import base64
    import cv2
    import numpy as np

    client_id = "consecutive-test-client"
    zone_id = "zone-north-plaza"

    for frame_idx in range(5):
        # Create unique frames (gradient bar shifting)
        test_img = np.zeros((240, 320, 3), dtype=np.uint8)
        test_img[:, (frame_idx * 20):(frame_idx * 20 + 30)] = 200
        _, buf = cv2.imencode(".jpg", test_img)
        b64_data = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"

        res = client.post(
            "/api/camera/infer-frame",
            json={
                "image": b64_data,
                "zone_id": zone_id,
                "camera_name": "USB Android Camera",
                "conf_threshold": 0.25,
                "client_id": client_id,
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["type"] == "frame"
        assert "detections" in data
        assert "person_count" in data
        assert "inference_fps" in data
        assert "frame_id" in data

    # Clean up client
    live_camera_manager.mark_client_disconnected(client_id)


def test_websocket_client_stream_and_disconnect(client):
    """Verify WebSocket client frame ingestion, inference response, and clean disconnection."""
    import base64
    import cv2
    import numpy as np

    test_img = np.zeros((240, 320, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", test_img)
    b64_data = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"
    client_id = "ws-consecutive-client-01"

    with client.websocket_connect("/ws/camera/stream") as ws:
        # Initial connection receives status
        welcome = ws.receive_json()
        assert welcome["type"] == "status"

        # Send frame
        frame_msg = {
            "action": "infer_frame",
            "image": b64_data,
            "zone_id": "zone-gate-a",
            "camera_name": "USB Mobile Webcam",
            "conf_threshold": 0.25,
            "client_id": client_id,
        }
        ws.send_text(json.dumps(frame_msg))

        # Receive frame response
        resp = ws.receive_json()
        assert resp["type"] == "frame"
        assert resp["assigned_zone_id"] == "zone-gate-a"
        assert resp["camera_name"] == "USB Mobile Webcam"
        assert "detections" in resp
        assert "inference_fps" in resp

    # After websocket closes, verify client disconnection cleanup
    live_camera_manager.mark_client_disconnected(client_id)
    zone_res = client.get("/api/zones/live-status")
    assert zone_res.status_code == 200


