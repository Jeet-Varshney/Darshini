"""
CrowdFlow Sentinel - Health & Model Status API Tests
Tests for /health, /api/model/status, and missing model weight reporting.
"""

from pathlib import Path
from unittest.mock import PropertyMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.model_service import model_service


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint_healthy(client):
    """Verify /health returns 200 with model ready when weights are loaded."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "timestamp" in data
    assert data["model_ready"] is True
    assert "YOLO" in data["model_name"]
    assert data["device"] == "cpu"
    assert data["person_class_id"] == 0
    assert data["weights_present"] is True
    assert "ready for inference" in data["message"].lower()


def test_model_status_endpoint(client):
    """Verify /api/model/status provides full operational configuration."""
    response = client.get("/api/model/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["model_ready"] is True
    assert data["max_upload_size_mb"] == 50.0
    assert data["max_frames_to_process"] == 60
    assert data["default_sample_fps"] == 1.0
    assert data["weights_path"] is not None


def test_health_when_model_weights_missing(client):
    """Verify /health reports model_ready=False honestly when weights are missing."""
    with patch.object(type(model_service), "is_ready", new_callable=PropertyMock, return_value=False), \
         patch.object(Path, "exists", return_value=False):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["model_ready"] is False
        assert data["model_name"] == "Unavailable"
        assert data["person_class_id"] is None
        assert data["weights_present"] is False
        assert "not found" in data["message"].lower()
