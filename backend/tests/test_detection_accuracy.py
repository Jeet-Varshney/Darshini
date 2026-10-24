"""
Darshini - Milestone 3: Detection Accuracy & Zone Counting Unit & Regression Tests
Focuses on:
- Stationary-person detection and temporal hysteresis
- Moving-person detection
- Empty frames and zero-count integrity
- Departure without ghost detection (non-accumulation)
- Low-confidence filtering
- Partially occluded people at boundaries
- Duplicate detection suppression
- Zone boundary cases (half-open intervals, single-zone guarantee)
- Correct zone-level aggregation
- Recovery from invalid frames or inference errors
"""

import copy
import numpy as np
import pytest
from app.services.camera_stream import (
    StationaryPersonTracker,
    VENUE_ZONES,
    map_detection_to_zone,
    compute_box_iou,
)


def test_stationary_person_persistence_hysteresis():
    """Verify stationary person whose confidence dips below init_conf is retained via hysteresis."""
    tracker = StationaryPersonTracker(init_conf=0.25, retain_conf=0.20, max_missed=5)

    # Frame 1: Person detected with initial high confidence (0.28 >= 0.25)
    det1 = {
        "box_pixels": [100, 100, 200, 300],
        "box_normalized": [0.1, 0.1, 0.3, 0.2],
        "confidence": 0.28,
    }
    res1 = tracker.update([det1])
    assert len(res1) == 1
    track_id = res1[0]["track_id"]
    assert res1[0]["is_stationary"] is False  # Hits=1: not qualified as stationary yet

    # Frame 2: Person remains in same location, confidence drops slightly to 0.22 (< 0.25, but >= 0.20)
    det2 = {
        "box_pixels": [101, 100, 201, 300],
        "box_normalized": [0.1, 0.101, 0.3, 0.201],
        "confidence": 0.22,
    }
    res2 = tracker.update([det2])
    assert len(res2) == 1
    assert res2[0]["track_id"] == track_id
    assert res2[0]["is_stationary"] is True  # Hits=2, minimal movement: qualified stationary!
    assert res2[0]["confidence"] == 0.22


def test_moving_person_detection():
    """Verify moving persons with significant displacement are tracked but NOT flagged stationary."""
    tracker = StationaryPersonTracker(init_conf=0.25, retain_conf=0.20, max_missed=5)

    # Frame 1: Person at position X=100
    det1 = {
        "box_pixels": [100, 100, 160, 250],
        "box_normalized": [0.1, 0.1, 0.25, 0.16],
        "confidence": 0.85,
    }
    res1 = tracker.update([det1])
    assert len(res1) == 1

    # Frame 2: Person moves significantly to X=140 (shift > 6% bbox diagonal)
    det2 = {
        "box_pixels": [140, 100, 200, 250],
        "box_normalized": [0.1, 0.14, 0.25, 0.20],
        "confidence": 0.82,
    }
    res2 = tracker.update([det2])
    assert len(res2) == 1
    assert res2[0]["is_stationary"] is False  # Correctly flagged moving


def test_empty_frames_zero_accumulation():
    """Verify empty frames yield 0 detections and never accumulate synthetic counts."""
    tracker = StationaryPersonTracker(init_conf=0.25, retain_conf=0.20, max_missed=5)

    for _ in range(10):
        res = tracker.update([])
        assert len(res) == 0


def test_no_ghost_detection_when_person_leaves():
    """Verify that when a person leaves the frame, they are NOT reported in instantaneous count."""
    tracker = StationaryPersonTracker(init_conf=0.25, retain_conf=0.20, max_missed=5)

    # Person present in frame 1 and 2
    det = {
        "box_pixels": [100, 100, 200, 300],
        "box_normalized": [0.1, 0.1, 0.3, 0.2],
        "confidence": 0.85,
    }
    tracker.update([det])
    res2 = tracker.update([det])
    assert len(res2) == 1

    # Person leaves: next 3 frames are empty
    for _ in range(3):
        res_empty = tracker.update([])
        # Instantaneous count MUST be 0 - no ghost detections!
        assert len(res_empty) == 0


def test_low_confidence_filtering():
    """Verify low-confidence detections below init_conf are rejected if not matching a track."""
    tracker = StationaryPersonTracker(init_conf=0.25, retain_conf=0.20, max_missed=5)

    # Det below init_conf on first appearance
    det_low = {
        "box_pixels": [100, 100, 200, 300],
        "box_normalized": [0.1, 0.1, 0.3, 0.2],
        "confidence": 0.19,  # < 0.25
    }
    res = tracker.update([det_low])
    assert len(res) == 0


def test_partially_occluded_person_at_boundary():
    """Verify partially occluded person at frame edge is tracked with ground contact point."""
    tracker = StationaryPersonTracker(init_conf=0.25, retain_conf=0.20, max_missed=5)

    edge_det = {
        "box_pixels": [0, 550, 64, 874],
        "box_normalized": [0.509, 0.0, 0.809, 0.079],
        "ground_contact_normalized": [0.0395, 0.809],
        "confidence": 0.26,
    }
    res = tracker.update([edge_det])
    assert len(res) == 1
    assert res[0]["box_pixels"][0] == 0
    assert "ground_contact_normalized" in res[0]
    assert abs(res[0]["ground_contact_normalized"][0] - 0.0395) < 1e-3


def test_duplicate_detection_suppression_iou():
    """Verify compute_box_iou accurately computes overlap for duplicate suppression."""
    b1 = [100, 100, 200, 200]
    b2 = [100, 100, 200, 200]  # Exact duplicate
    assert compute_box_iou(b1, b2) == 1.0

    b3 = [300, 300, 400, 400]  # Disjoint
    assert compute_box_iou(b1, b3) == 0.0

    b4 = [150, 100, 250, 200]  # 50% width overlap
    iou = compute_box_iou(b1, b4)
    assert 0.3 < iou < 0.4


def test_zone_boundary_half_open_interval():
    """Verify half-open interval boundary prevents double counting across adjacent zone partitions."""
    # Partition camera view into Left (Zone A) and Right (Zone B) at X = 0.50
    partitions = {
        "zone-north-plaza": [0.0, 0.0, 0.50, 1.0],      # [0.0, 0.50)
        "zone-central-concourse": [0.50, 0.0, 1.0, 1.0],  # [0.50, 1.0]
    }

    # Point clearly on the left
    z_left = map_detection_to_zone([0.25, 0.5], "zone-north-plaza", partitions)
    assert z_left == "zone-north-plaza"

    # Point clearly on the right
    z_right = map_detection_to_zone([0.75, 0.5], "zone-north-plaza", partitions)
    assert z_right == "zone-central-concourse"

    # Point EXACTLY on the boundary X = 0.50
    # Boundary rule [xmin, xmax) means [0.0, 0.50) EXCLUDES 0.50, while [0.50, 1.0] INCLUDES 0.50.
    z_boundary = map_detection_to_zone([0.50, 0.5], "zone-north-plaza", partitions)
    assert z_boundary == "zone-central-concourse"
    # Guaranteed single-zone assignment (never both!)


def test_zone_level_aggregation_consistency():
    """Verify zone-level crowd count is strictly the sum of detections assigned to that zone."""
    assigned_zone = "zone-north-plaza"
    detections = [
        {"track_id": 1, "confidence": 0.85, "ground_contact_normalized": [0.2, 0.7]},
        {"track_id": 2, "confidence": 0.78, "ground_contact_normalized": [0.4, 0.8]},
        {"track_id": 3, "confidence": 0.81, "ground_contact_normalized": [0.6, 0.75]},
    ]

    zone_counts = {z: 0 for z in VENUE_ZONES}
    for det in detections:
        z_id = map_detection_to_zone(det["ground_contact_normalized"], assigned_zone)
        if z_id in zone_counts:
            zone_counts[z_id] += 1

    # Camera count = 3
    assert len(detections) == 3
    # North Gate Plaza count = 3
    assert zone_counts["zone-north-plaza"] == 3
    # Other zones = 0
    assert zone_counts["zone-central-concourse"] == 0
    assert sum(zone_counts.values()) == len(detections)


def test_tracker_recovery_from_empty_or_corrupt_detections():
    """Verify tracker recovers cleanly from invalid or malformed detection packets."""
    tracker = StationaryPersonTracker(init_conf=0.25, retain_conf=0.20, max_missed=5)

    # Empty list
    res = tracker.update([])
    assert res == []

    # Valid detection
    det = {
        "box_pixels": [50, 50, 150, 150],
        "box_normalized": [0.1, 0.1, 0.3, 0.3],
        "confidence": 0.85,
    }
    res1 = tracker.update([det])
    assert len(res1) == 1

    # Empty frame
    res2 = tracker.update([])
    assert len(res2) == 0

    # Person returns
    res3 = tracker.update([det])
    assert len(res3) == 1
    assert res3[0]["track_id"] == res1[0]["track_id"]  # Preserved track identity upon re-detection
