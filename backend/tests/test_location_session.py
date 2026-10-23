"""
Darshini - Location Session & Mobile Live Stream Tests
Tests session creation, coordinate boundary validation, subscriber relay, and WebSocket lifecycle.
"""

import json
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.location_stream import location_stream_manager


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_create_location_session(client):
    """Verify creating an ephemeral pairing session generates a valid 6-char session ID and token."""
    response = client.post("/api/location/session")
    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data
    assert data["session_id"].startswith("DAR-")
    assert "token" in data
    assert len(data["token"]) >= 8
    assert "timestamp" in data


def test_location_update_rest_and_validation(client):
    """Verify REST coordinate relay validates geographic boundaries."""
    # 1. Create session
    create_res = client.post("/api/location/session")
    assert create_res.status_code == 200
    session_data = create_res.json()
    s_id = session_data["session_id"]
    tok = session_data["token"]

    # 2. Send valid coordinate update
    valid_payload = {
        "session_id": s_id,
        "token": tok,
        "latitude": 13.0827,
        "longitude": 80.2707,
        "accuracy": 8.5,
        "heading": 120.0,
        "speed": 1.2,
    }
    up_res = client.post("/api/location/update", json=valid_payload)
    assert up_res.status_code == 200
    assert up_res.json()["status"] == "relayed"

    # 3. Reject invalid latitude (> 90.0)
    invalid_payload = {
        "session_id": s_id,
        "token": tok,
        "latitude": 195.0,
        "longitude": 80.2707,
        "accuracy": 5.0,
    }
    inv_res = client.post("/api/location/update", json=invalid_payload)
    assert inv_res.status_code == 422 or inv_res.status_code == 400

    # 4. Reject invalid token
    bad_token_payload = {
        "session_id": s_id,
        "token": "wrong-token-xyz",
        "latitude": 13.0827,
        "longitude": 80.2707,
        "accuracy": 5.0,
    }
    bad_tok_res = client.post("/api/location/update", json=bad_token_payload)
    assert bad_tok_res.status_code == 404


def test_websocket_location_broadcaster_and_subscriber(client):
    """Verify live WebSocket stream relay between phone broadcaster and desktop subscriber."""
    # 1. Create session
    create_res = client.post("/api/location/session")
    session_data = create_res.json()
    s_id = session_data["session_id"]
    tok = session_data["token"]

    # 2. Connect desktop subscriber
    with client.websocket_connect(f"/ws/location/{s_id}?role=subscriber") as sub_ws:
        init_msg = sub_ws.receive_json()
        assert init_msg["type"] == "session_status"
        assert init_msg["session_id"] == s_id
        assert init_msg["broadcaster_connected"] is False

        # 3. Connect mobile broadcaster in inner context
        with client.websocket_connect(f"/ws/location/{s_id}?role=broadcaster&token={tok}") as broad_ws:
            # Subscriber should be notified that broadcaster connected
            status_msg = sub_ws.receive_json()
            assert status_msg["type"] == "broadcaster_status"
            assert status_msg["connected"] is True

            # Broadcaster sends real-time GPS coordinate update
            update_data = {
                "type": "location_update",
                "latitude": 12.9716,
                "longitude": 77.5946,
                "accuracy": 4.5,
                "heading": 90.0,
                "speed": 0.8,
            }
            broad_ws.send_text(json.dumps(update_data))

            # Subscriber receives the relayed packet
            relayed_msg = sub_ws.receive_json()
            assert relayed_msg["type"] == "location_update"
            assert relayed_msg["latitude"] == 12.9716
            assert relayed_msg["longitude"] == 77.5946
            assert relayed_msg["accuracy"] == 4.5
            assert relayed_msg["source"] == "MOBILE_STREAM"
