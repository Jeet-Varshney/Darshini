#!/usr/bin/env python3
"""
Darshini - Milestone 3: Stationary Person Detection Diagnostic & Benchmark
Tests parameter variations (confidence thresholds, imgsz, and temporal persistence)
on reproducible video frames containing stationary and moving individuals.
"""

import os
import sys
import time
from pathlib import Path
import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import MODEL_PATH
from ultralytics import YOLO

def benchmark_stationary():
    print("=" * 70)
    print("DARSHINI - STATIONARY PERSON DETECTION ACCURACY BENCHMARK")
    print("=" * 70)

    torch.set_num_threads(4)
    model = YOLO(str(MODEL_PATH))

    # 1. Load sample video: gate1_sample.mp4
    video_path = "frontend/public/samples/gate1_sample.mp4"
    cap = cv2.VideoCapture(video_path)
    assert cap.isOpened(), f"Cannot open {video_path}"

    frames = []
    for _ in range(60):
        ret, f = cap.read()
        if ret and f is not None:
            frames.append(f)
    cap.release()

    print(f"Loaded {len(frames)} frames from {video_path} (Resolution: {frames[0].shape[1]}x{frames[0].shape[0]})")

    # Warmup
    with torch.inference_mode():
        _ = model(frames[0], device="cpu", verbose=False, imgsz=416)

    # TEST A: Effect of Confidence Threshold on Detection Stability
    print("\n--- TEST A: Confidence Threshold Variation (Fixed imgsz=416) ---")
    conf_levels = [0.15, 0.20, 0.25, 0.30, 0.35]
    for conf in conf_levels:
        counts = []
        confs = []
        t0 = time.time()
        for frame in frames[:30]:
            with torch.inference_mode():
                res = model(frame, device="cpu", conf=conf, classes=[0], imgsz=416, verbose=False)
            boxes = res[0].boxes
            n = len(boxes) if boxes is not None else 0
            counts.append(n)
            if boxes is not None:
                confs.extend([float(c) for c in boxes.conf])

        elapsed_ms = (time.time() - t0) * 1000 / 30
        avg_confs = sum(confs) / len(confs) if confs else 0
        print(f"  Conf >= {conf:.2f}: Avg Detections/frame = {np.mean(counts):.2f} (Min={min(counts)}, Max={max(counts)}, StdDev={np.std(counts):.2f}) | Avg Conf = {avg_confs*100:.1f}% | Latency = {elapsed_ms:.1f}ms")

    # TEST B: Effect of Input Resolution (imgsz)
    print("\n--- TEST B: Input Resolution (imgsz) Variation (Fixed Conf=0.20) ---")
    imgsz_levels = [320, 384, 416, 480, 640]
    for sz in imgsz_levels:
        counts = []
        t0 = time.time()
        for frame in frames[:20]:
            with torch.inference_mode():
                res = model(frame, device="cpu", conf=0.20, classes=[0], imgsz=sz, verbose=False)
            boxes = res[0].boxes
            n = len(boxes) if boxes is not None else 0
            counts.append(n)

        elapsed_ms = (time.time() - t0) * 1000 / 20
        fps = 1000.0 / max(elapsed_ms, 0.001)
        print(f"  imgsz = {sz:3d}: Avg Detections = {np.mean(counts):.2f} (Min={min(counts)}, Max={max(counts)}) | Latency = {elapsed_ms:.1f}ms ({fps:.1f} FPS)")

    # TEST C: Temporal Hysteresis / Persistence Filter on Stationary Persons
    print("\n--- TEST C: Temporal Persistence Filter vs Raw Detections ---")
    print("  Problem: In stationary surveillance, detector confidence on motionless persons fluctuates frame-to-frame (e.g. 0.26 -> 0.19 -> 0.24), causing them to disappear.")
    print("  Hypothesis: A 2-tier hysteresis tracker (Initial detection >= 0.25, Track continuation >= 0.15, 8-frame grace period) stabilizes stationary count without false accumulation.")

    # Simple IoU helper
    def box_iou(b1, b2):
        x1 = max(b1[0], b2[0])
        y1 = max(b1[1], b2[1])
        x2 = min(b1[2], b2[2])
        y2 = min(b1[3], b2[3])
        inter = max(0, x2 - x1) * max(0, y2 - y1)
        area1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
        area2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
        union = area1 + area2 - inter
        return inter / max(union, 1e-6)

    # Simulate raw detection vs persistence tracker over 40 frames
    raw_counts = []
    tracked_counts = []

    class SimplePersistenceTracker:
        def __init__(self, high_thresh=0.25, low_thresh=0.15, max_missed=6):
            self.high_thresh = high_thresh
            self.low_thresh = low_thresh
            self.max_missed = max_missed
            self.tracks = [] # each: {"box": [x1,y1,x2,y2], "conf": c, "missed": 0, "hits": 1}

        def update(self, detections):
            # detections: list of (box, conf)
            # 1. Match existing tracks to detections
            unmatched_dets = list(detections)
            matched_track_indices = set()

            for t_idx, track in enumerate(self.tracks):
                best_iou = 0.0
                best_d_idx = -1
                for d_idx, (box, conf) in enumerate(unmatched_dets):
                    iou = box_iou(track["box"], box)
                    if iou > 0.4 and iou > best_iou:
                        best_iou = iou
                        best_d_idx = d_idx

                if best_d_idx >= 0:
                    matched_box, matched_conf = unmatched_dets.pop(best_d_idx)
                    track["box"] = matched_box
                    track["conf"] = matched_conf
                    track["missed"] = 0
                    track["hits"] += 1
                    matched_track_indices.add(t_idx)
                else:
                    track["missed"] += 1

            # 2. Add new tracks from unmatched high-confidence detections
            for box, conf in unmatched_dets:
                if conf >= self.high_thresh:
                    self.tracks.append({"box": box, "conf": conf, "missed": 0, "hits": 1})

            # 3. Prune tracks that missed too many frames
            self.tracks = [t for t in self.tracks if t["missed"] <= self.max_missed]

            # Current confirmed count (only active or recently confirmed tracks)
            return len(self.tracks)

    tracker = SimplePersistenceTracker(high_thresh=0.25, low_thresh=0.15, max_missed=6)

    for frame in frames[:40]:
        with torch.inference_mode():
            # Get raw detections down to low_thresh
            res = model(frame, device="cpu", conf=0.15, classes=[0], imgsz=416, verbose=False)
        boxes = res[0].boxes
        frame_dets = []
        raw_high = 0
        if boxes is not None:
            for b in boxes:
                c = float(b.conf[0])
                box = [int(x) for x in b.xyxy[0].tolist()]
                frame_dets.append((box, c))
                if c >= 0.25:
                    raw_high += 1

        raw_counts.append(raw_high)
        active_count = tracker.update(frame_dets)
        tracked_counts.append(active_count)

    print(f"  Raw Detections (conf>=0.25):     Avg={np.mean(raw_counts):.2f} | Min={min(raw_counts)}, Max={max(raw_counts)}, StdDev={np.std(raw_counts):.2f}")
    print(f"  With Persistence Hysteresis:    Avg={np.mean(tracked_counts):.2f} | Min={min(tracked_counts)}, Max={max(tracked_counts)}, StdDev={np.std(tracked_counts):.2f}")
    print(f"  Count Stability Improvement:    Variance reduced by {(1 - (np.var(tracked_counts)/max(np.var(raw_counts), 1e-4))) * 100:.1f}%")
    print("=" * 70)

if __name__ == "__main__":
    benchmark_stationary()
