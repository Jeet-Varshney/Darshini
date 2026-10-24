"""
Darshini - Detection History Storage and API Tests
Tests for SQLite initialization, deterministic sampling rate-limiting,
retention pruning, parameter filtering, ordering, error resilience,
and the /api/detections/history API endpoint.
"""

import os
import time
import pytest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app
from app.services.history_service import DetectionHistoryService, detection_history_service


@pytest.fixture
def temp_history_service(tmp_path: Path):
    """Provides an isolated DetectionHistoryService using a temporary SQLite database."""
    test_db = tmp_path / "test_darshini.db"
    service = DetectionHistoryService(
        db_path=test_db,
        max_records=10,
        min_interval_sec=2.0,
    )
    yield service


@pytest.fixture
def client(temp_history_service, monkeypatch):
    """Provides a TestClient with detection_history_service monkeypatched to temporary service."""
    # Monkeypatch the module-level detection_history_service in routes and camera_stream
    import app.api.routes as routes_module
    import app.services.camera_stream as stream_module
    
    monkeypatch.setattr(routes_module, "detection_history_service", temp_history_service)
    monkeypatch.setattr(stream_module, "detection_history_service", temp_history_service)
    
    with TestClient(app) as test_client:
        yield test_client


def test_database_initialization(temp_history_service: DetectionHistoryService):
    """Verifies that SQLite table and indices are cleanly created."""
    assert temp_history_service.db_path.exists()
    assert temp_history_service.count_records() == 0


def test_record_and_query_history(temp_history_service: DetectionHistoryService):
    """Verifies persisting a genuine detection observation and querying it back."""
    iso_time = "2026-10-24T03:00:00Z"
    success = temp_history_service.record_detection(
        camera_id="cam-front-01",
        camera_name="Front Gate Camera",
        person_count=3,
        zone_id="zone-north-plaza",
        zone_name="North Gate Plaza",
        stationary_count=2,
        moving_count=1,
        avg_confidence=0.852,
        inference_duration_ms=64.5,
        data_source="LIVE_CAMERA_INFERENCE",
        timestamp=iso_time,
        epoch_time=1000.0,
    )
    assert success is True
    assert temp_history_service.count_records() == 1

    records = temp_history_service.query_history(camera_id="cam-front-01")
    assert len(records) == 1
    rec = records[0]
    assert rec["camera_id"] == "cam-front-01"
    assert rec["camera_name"] == "Front Gate Camera"
    assert rec["person_count"] == 3
    assert rec["stationary_count"] == 2
    assert rec["moving_count"] == 1
    assert rec["avg_confidence"] == 0.852
    assert rec["inference_duration_ms"] == 64.5
    assert rec["zone_id"] == "zone-north-plaza"
    assert rec["zone_name"] == "North Gate Plaza"
    assert rec["data_source"] == "LIVE_CAMERA_INFERENCE"


def test_sampling_rate_limit_enforcement(temp_history_service: DetectionHistoryService):
    """
    Verifies that no more than one sample per camera is persisted within 2.0 seconds,
    and that different cameras do not throttle each other.
    """
    # 1. Camera A at t=100.0 (Recorded)
    res1 = temp_history_service.record_detection(
        camera_id="cam-A",
        camera_name="Camera Alpha",
        person_count=1,
        epoch_time=100.0,
    )
    assert res1 is True

    # 2. Camera A at t=100.5 (Skipped due to 2.0s rule)
    res2 = temp_history_service.record_detection(
        camera_id="cam-A",
        camera_name="Camera Alpha",
        person_count=2,
        epoch_time=100.5,
    )
    assert res2 is False

    # 3. Camera A at t=101.9 (Skipped: elapsed is 1.9s < 2.0s)
    res3 = temp_history_service.record_detection(
        camera_id="cam-A",
        camera_name="Camera Alpha",
        person_count=3,
        epoch_time=101.9,
    )
    assert res3 is False

    # 4. Camera B at t=101.0 (Recorded: independent camera source)
    res_b = temp_history_service.record_detection(
        camera_id="cam-B",
        camera_name="Camera Beta",
        person_count=5,
        epoch_time=101.0,
    )
    assert res_b is True

    # 5. Camera A at t=102.1 (Recorded: elapsed 2.1s >= 2.0s)
    res4 = temp_history_service.record_detection(
        camera_id="cam-A",
        camera_name="Camera Alpha",
        person_count=4,
        epoch_time=102.1,
    )
    assert res4 is True

    # Total recorded: 2 from cam-A, 1 from cam-B
    assert temp_history_service.count_records() == 3
    assert temp_history_service.count_records(camera_id="cam-A") == 2
    assert temp_history_service.count_records(camera_id="cam-B") == 1


def test_retention_policy_pruning(temp_history_service: DetectionHistoryService):
    """Verifies that exceeding max_records (10 in test fixture) prunes the oldest records."""
    # Insert 15 samples spaced 2.5s apart
    for i in range(15):
        epoch = 1000.0 + (i * 2.5)
        iso_str = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
        temp_history_service.record_detection(
            camera_id="cam-stream",
            camera_name="Stream Cam",
            person_count=i,
            timestamp=iso_str,
            epoch_time=epoch,
        )

    # Must be bounded by max_records (10)
    assert temp_history_service.count_records() == 10

    # The 10 remaining records should be the latest 10 (i = 5 through 14)
    records = temp_history_service.query_history(limit=20, order="desc")
    assert len(records) == 10
    counts = [r["person_count"] for r in records]
    assert counts == [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]


def test_query_filters_and_ordering(temp_history_service: DetectionHistoryService):
    """Verifies filtering by camera, zone, start_time, end_time, and order direction."""
    t0 = datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)

    # Sample 1: Zone A, Cam 1
    temp_history_service.record_detection(
        camera_id="cam-1",
        camera_name="Cam 1",
        person_count=2,
        zone_id="zone-A",
        timestamp=(t0 + timedelta(minutes=1)).isoformat(),
        epoch_time=100.0,
    )
    # Sample 2: Zone B, Cam 2
    temp_history_service.record_detection(
        camera_id="cam-2",
        camera_name="Cam 2",
        person_count=4,
        zone_id="zone-B",
        timestamp=(t0 + timedelta(minutes=5)).isoformat(),
        epoch_time=105.0,
    )
    # Sample 3: Zone A, Cam 1
    temp_history_service.record_detection(
        camera_id="cam-1",
        camera_name="Cam 1",
        person_count=6,
        zone_id="zone-A",
        timestamp=(t0 + timedelta(minutes=10)).isoformat(),
        epoch_time=110.0,
    )

    # Filter by zone-A
    zone_a_recs = temp_history_service.query_history(zone_id="zone-A")
    assert len(zone_a_recs) == 2
    assert all(r["zone_id"] == "zone-A" for r in zone_a_recs)

    # Filter by cam-2
    cam_2_recs = temp_history_service.query_history(camera_id="cam-2")
    assert len(cam_2_recs) == 1
    assert cam_2_recs[0]["person_count"] == 4

    # Filter by time range: [12:03 to 12:08] (Only Sample 2 matches)
    time_recs = temp_history_service.query_history(
        start_time=(t0 + timedelta(minutes=3)).isoformat(),
        end_time=(t0 + timedelta(minutes=8)).isoformat(),
    )
    assert len(time_recs) == 1
    assert time_recs[0]["camera_id"] == "cam-2"

    # Order asc vs desc
    asc_recs = temp_history_service.query_history(order="asc")
    assert asc_recs[0]["person_count"] == 2
    assert asc_recs[-1]["person_count"] == 6

    desc_recs = temp_history_service.query_history(order="desc")
    assert desc_recs[0]["person_count"] == 6
    assert desc_recs[-1]["person_count"] == 2


def test_zero_detections_avg_confidence_handling(temp_history_service: DetectionHistoryService):
    """Verifies that 0 person detections record avg_confidence as None (never fabricated)."""
    temp_history_service.record_detection(
        camera_id="cam-empty",
        camera_name="Empty Plaza",
        person_count=0,
        avg_confidence=None,
        epoch_time=10.0,
    )
    recs = temp_history_service.query_history(camera_id="cam-empty")
    assert len(recs) == 1
    assert recs[0]["person_count"] == 0
    assert recs[0]["avg_confidence"] is None


def test_storage_error_resilience(tmp_path: Path):
    """Verifies that a database failure is logged and returns False without raising an unhandled exception."""
    unwritable_dir = tmp_path / "protected"
    unwritable_dir.mkdir(parents=True)
    unwritable_file = unwritable_dir / "protected.db"
    # Make it a directory or read-only file to trigger an operational error
    unwritable_file.mkdir()

    service = DetectionHistoryService(db_path=unwritable_file)
    # Attempting to record should fail gracefully
    res = service.record_detection(
        camera_id="cam-fail",
        camera_name="Failing Cam",
        person_count=1,
        epoch_time=100.0,
    )
    assert res is False


def test_history_api_endpoint(client: TestClient, temp_history_service: DetectionHistoryService):
    """Verifies GET /api/detections/history endpoint responses, filters, and schemas."""
    # 1. Query when empty
    resp = client.get("/api/detections/history")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["records"] == []

    # 2. Add test detections
    temp_history_service.record_detection(
        camera_id="test-client-1",
        camera_name="Webcam 1",
        person_count=4,
        zone_id="zone-north-plaza",
        zone_name="North Gate Plaza",
        stationary_count=2,
        moving_count=2,
        avg_confidence=0.795,
        inference_duration_ms=45.0,
        epoch_time=10.0,
    )

    # 3. Query populated endpoint
    resp = client.get("/api/detections/history?limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["limit"] == 10
    rec = data["records"][0]
    assert rec["camera_id"] == "test-client-1"
    assert rec["person_count"] == 4
    assert rec["avg_confidence"] == 0.795
    assert rec["zone_id"] == "zone-north-plaza"

    # 4. Query with non-matching filter returns empty list
    resp_empty = client.get("/api/detections/history?zone_id=non-existent-zone")
    assert resp_empty.status_code == 200
    assert resp_empty.json()["total"] == 0
    assert resp_empty.json()["records"] == []
