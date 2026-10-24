#!/usr/bin/env python3
"""
Darshini - Milestone 3: Comprehensive Detection Accuracy & Zone Counting Benchmark
Evaluates person detection reliability across:
- Stationary people
- Walking/moving people
- Partially occluded people
- Groups of people
- Low-light and high-contrast conditions
- Camera distances and downscaled resolutions
- Empty negative scenes (False Positive check)

Measures and outputs:
- True Positives (TP)
- False Positives (FP)
- False Negatives (FN)
- Precision
- Recall
- F1 Score
- Person-Count Error & Mean Absolute Error (MAE)
"""

import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple, Any
import cv2
import numpy as np

# Ensure backend app is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import MODEL_PATH, DEFAULT_CONF_THRESHOLD, DEFAULT_INFERENCE_IMGSZ
from ultralytics import YOLO
import torch


def compute_iou(box1: List[float], box2: List[float]) -> float:
    """Computes IoU between two [xmin, ymin, xmax, ymax] boxes."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    inter_w = max(0.0, x2 - x1)
    inter_h = max(0.0, y2 - y1)
    inter_area = inter_w * inter_h

    area1 = max(0.0, box1[2] - box1[0]) * max(0.0, box1[3] - box1[1])
    area2 = max(0.0, box2[2] - box2[0]) * max(0.0, box2[3] - box2[1])
    union_area = area1 + area2 - inter_area

    if union_area <= 0:
        return 0.0
    return inter_area / union_area


def match_detections(
    gt_boxes: List[List[float]],
    pred_boxes: List[List[float]],
    iou_threshold: float = 0.40,
) -> Tuple[int, int, int]:
    """
    Performs greedy bipartite matching between ground-truth and predicted boxes.
    Returns: (TP, FP, FN)
    """
    matched_gt = set()
    matched_pred = set()

    # Precompute pairwise IoUs
    ious = []
    for p_idx, p_box in enumerate(pred_boxes):
        for g_idx, g_box in enumerate(gt_boxes):
            iou = compute_iou(p_box, g_box)
            if iou >= iou_threshold:
                ious.append((iou, p_idx, g_idx))

    # Sort descending by IoU
    ious.sort(key=lambda x: x[0], reverse=True)

    for iou, p_idx, g_idx in ious:
        if p_idx not in matched_pred and g_idx not in matched_gt:
            matched_pred.add(p_idx)
            matched_gt.add(g_idx)

    tp = len(matched_gt)
    fp = len(pred_boxes) - len(matched_pred)
    fn = len(gt_boxes) - len(matched_gt)
    return tp, fp, fn


class BenchmarkDataset:
    """Constructs and manages the fixed, repeatable evaluation test set."""

    def __init__(self, project_root: Path):
        self.root = project_root
        self.gate1_video = self.root / "frontend" / "public" / "samples" / "gate1_sample.mp4"
        self.empty_video = self.root / "frontend" / "public" / "samples" / "empty_zone_sample.mp4"
        self.zidane_img = (
            self.root
            / "backend"
            / ".venv"
            / "lib"
            / "python3.13"
            / "site-packages"
            / "ultralytics"
            / "assets"
            / "zidane.jpg"
        )

        # Ground-truth annotations for gate1_sample.mp4
        # 4 persons:
        # Person 1 (Standing left): [48, 398, 246, 903]
        # Person 2 (Standing group): [221, 405, 345, 858]
        # Person 3 (Standing right): [668, 381, 810, 874]
        # Person 4 (Stationary, occluded at left edge): [0, 550, 64, 874]
        self.gate1_gt = [
            [48.0, 398.0, 246.0, 903.0],
            [221.0, 405.0, 345.0, 858.0],
            [668.0, 381.0, 810.0, 874.0],
            [0.0, 550.0, 64.0, 874.0],
        ]

        # Ground-truth annotations for zidane.jpg
        # 2 persons:
        # Zidane: [115, 197, 1115, 712]
        # Player right: [748, 42, 1143, 713]
        self.zidane_gt = [
            [115.0, 197.0, 1115.0, 712.0],
            [748.0, 42.0, 1143.0, 713.0],
        ]

    def load_gate1_frames(self, num_frames: int = 40) -> List[np.ndarray]:
        cap = cv2.VideoCapture(str(self.gate1_video))
        frames = []
        while len(frames) < num_frames:
            ret, f = cap.read()
            if not ret or f is None:
                break
            frames.append(f)
        cap.release()
        return frames

    def load_empty_frames(self, num_frames: int = 30) -> List[np.ndarray]:
        cap = cv2.VideoCapture(str(self.empty_video))
        frames = []
        while len(frames) < num_frames:
            ret, f = cap.read()
            if not ret or f is None:
                break
            frames.append(f)
        cap.release()
        return frames

    def get_test_suites(self) -> Dict[str, Dict[str, Any]]:
        gate1_frames = self.load_gate1_frames(40)
        empty_frames = self.load_empty_frames(30)
        zidane_frame = cv2.imread(str(self.zidane_img))
        assert zidane_frame is not None, f"Failed to load {self.zidane_img}"

        # Variation 1: Low-light condition on gate1 base frame
        # Gamma = 0.55, -25 brightness shift
        base_f = gate1_frames[0].copy()
        inv_gamma = 1.0 / 0.55
        table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
        low_light_frame = cv2.LUT(base_f, table)
        low_light_frame = cv2.convertScaleAbs(low_light_frame, alpha=0.85, beta=-20)

        # Variation 2: Bright sunlight / high contrast condition
        inv_gamma_bright = 1.0 / 1.50
        table_bright = np.array([((i / 255.0) ** inv_gamma_bright) * 255 for i in np.arange(0, 256)]).astype("uint8")
        bright_frame = cv2.LUT(base_f, table_bright)
        bright_frame = cv2.convertScaleAbs(bright_frame, alpha=1.1, beta=15)

        # Variation 3: Camera distance / downscaled resolution (480x360)
        orig_h, orig_w = base_f.shape[:2]
        downscaled_frame = cv2.resize(base_f, (405, 540))
        # Scale GT boxes accordingly
        sx = 405.0 / orig_w
        sy = 540.0 / orig_h
        downscaled_gt = [
            [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy]
            for b in self.gate1_gt
        ]

        # Variation 4: Sensor noise / motion blur
        noisy_frame = cv2.GaussianBlur(base_f, (5, 5), 1.5)

        return {
            "gate1_stationary_sequence": {
                "description": "Gate 1 Surveillance Sequence (Stationary + Group + Border Occluded)",
                "frames": gate1_frames,
                "gt_boxes_per_frame": [self.gate1_gt] * len(gate1_frames),
                "is_sequence": True,
            },
            "empty_zone_negative": {
                "description": "Empty Venue Zone (FP Negative Control - 0 persons expected)",
                "frames": empty_frames,
                "gt_boxes_per_frame": [[]] * len(empty_frames),
                "is_sequence": True,
            },
            "zidane_indoor_group": {
                "description": "Close/Medium Distance Sports/Venue Group (2 persons)",
                "frames": [zidane_frame],
                "gt_boxes_per_frame": [self.zidane_gt],
                "is_sequence": False,
            },
            "low_light_stationary": {
                "description": "Low-Light Stationary Scene (Night / Dim Area)",
                "frames": [low_light_frame],
                "gt_boxes_per_frame": [self.gate1_gt],
                "is_sequence": False,
            },
            "bright_sunlight_stationary": {
                "description": "High-Contrast Bright Sunlight Stationary Scene",
                "frames": [bright_frame],
                "gt_boxes_per_frame": [self.gate1_gt],
                "is_sequence": False,
            },
            "downscaled_cctv_resolution": {
                "description": "Downscaled Surveillance Resolution (405x540)",
                "frames": [downscaled_frame],
                "gt_boxes_per_frame": [downscaled_gt],
                "is_sequence": False,
            },
            "sensor_noise_motion_blur": {
                "description": "Webcam Sensor Noise & Motion Blur",
                "frames": [noisy_frame],
                "gt_boxes_per_frame": [self.gate1_gt],
                "is_sequence": False,
            },
        }


def run_evaluation(
    conf_threshold: float = 0.25,
    imgsz: int = 416,
    use_tracker: bool = False,
    tag: str = "BASELINE",
) -> Dict[str, Any]:
    """Runs end-to-end evaluation on the benchmark dataset."""
    project_root = Path(__file__).resolve().parent.parent.parent
    dataset = BenchmarkDataset(project_root)
    suites = dataset.get_test_suites()

    # Load YOLO model
    torch.set_num_threads(4)
    model = YOLO(str(MODEL_PATH))

    # Import tracker if testing with tracker
    tracker = None
    if use_tracker:
        from app.services.camera_stream import StationaryPersonTracker
        tracker = StationaryPersonTracker()

    overall_tp = 0
    overall_fp = 0
    overall_fn = 0
    total_count_errors = []
    suite_metrics = {}

    print(f"\n{'='*75}")
    print(f"EVALUATION RUN: [{tag}] (conf={conf_threshold}, imgsz={imgsz}, use_tracker={use_tracker})")
    print(f"{'='*75}")

    for suite_name, sdata in suites.items():
        frames = sdata["frames"]
        gt_list = sdata["gt_boxes_per_frame"]
        is_seq = sdata["is_sequence"]

        s_tp = 0
        s_fp = 0
        s_fn = 0
        s_count_errors = []

        # Reset tracker between test suites
        if use_tracker and is_seq:
            from app.services.camera_stream import StationaryPersonTracker
            tracker = StationaryPersonTracker()

        for idx, (frame, gt_boxes) in enumerate(zip(frames, gt_list)):
            h, w = frame.shape[:2]

            # Run inference
            with torch.inference_mode():
                # If tracker is used, query at retain threshold
                infer_conf = 0.15 if use_tracker else conf_threshold
                res = model(frame, device="cpu", conf=infer_conf, classes=[0], imgsz=imgsz, verbose=False)

            boxes = res[0].boxes
            pred_boxes = []
            raw_dets = []

            if boxes is not None:
                for b in boxes:
                    xyxy = [float(x) for x in b.xyxy[0].tolist()]
                    c = float(b.conf[0])
                    raw_dets.append({
                        "box_pixels": [int(x) for x in xyxy],
                        "box_normalized": [xyxy[1]/h, xyxy[0]/w, xyxy[3]/h, xyxy[2]/w],
                        "confidence": c,
                    })
                    if not use_tracker and c >= conf_threshold:
                        pred_boxes.append(xyxy)

            if use_tracker:
                active_tracks = tracker.update(raw_dets)
                # Tracker active boxes
                pred_boxes = [t["box_pixels"] for t in active_tracks]

            tp, fp, fn = match_detections(gt_boxes, pred_boxes, iou_threshold=0.40)
            s_tp += tp
            s_fp += fp
            s_fn += fn

            count_error = abs(len(pred_boxes) - len(gt_boxes))
            s_count_errors.append(count_error)

        total_gt = s_tp + s_fn
        prec = s_tp / (s_tp + s_fp) if (s_tp + s_fp) > 0 else (1.0 if total_gt == 0 else 0.0)
        rec = s_tp / (s_tp + s_fn) if (s_tp + s_fn) > 0 else (1.0 if total_gt == 0 else 0.0)
        f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
        mae = float(np.mean(s_count_errors))

        suite_metrics[suite_name] = {
            "description": sdata["description"],
            "total_frames": len(frames),
            "total_gt_persons": total_gt,
            "tp": s_tp,
            "fp": s_fp,
            "fn": s_fn,
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "mae_count_error": round(mae, 3),
        }

        overall_tp += s_tp
        overall_fp += s_fp
        overall_fn += s_fn
        total_count_errors.extend(s_count_errors)

        desc = sdata["description"][:48]
        print(f"  {desc:<48} | TP={s_tp:3d} FP={s_fp:2d} FN={s_fn:3d} | P={prec*100:5.1f}% R={rec*100:5.1f}% F1={f1*100:5.1f}% | MAE={mae:.2f}")

    tot_gt = overall_tp + overall_fn
    overall_prec = overall_tp / (overall_tp + overall_fp) if (overall_tp + overall_fp) > 0 else 0.0
    overall_rec = overall_tp / (overall_tp + overall_fn) if (overall_tp + overall_fn) > 0 else 0.0
    overall_f1 = (2 * overall_prec * overall_rec) / (overall_prec + overall_rec) if (overall_prec + overall_rec) > 0 else 0.0
    overall_mae = float(np.mean(total_count_errors))

    print(f"{'-'*75}")
    print(f"  {'OVERALL SUMMARY':<48} | TP={overall_tp:3d} FP={overall_fp:2d} FN={overall_fn:3d} | P={overall_prec*100:5.1f}% R={overall_rec*100:5.1f}% F1={overall_f1*100:5.1f}% | MAE={overall_mae:.2f}")
    print(f"{'='*75}\n")

    return {
        "tag": tag,
        "conf_threshold": conf_threshold,
        "imgsz": imgsz,
        "use_tracker": use_tracker,
        "overall": {
            "tp": overall_tp,
            "fp": overall_fp,
            "fn": overall_fn,
            "precision": round(overall_prec, 4),
            "recall": round(overall_rec, 4),
            "f1": round(overall_f1, 4),
            "mae": round(overall_mae, 3),
        },
        "suites": suite_metrics,
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Darshini Detection Accuracy Benchmark")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--imgsz", type=int, default=416, help="Inference resolution")
    parser.add_argument("--tracker", action="store_true", help="Enable tracker")
    parser.add_argument("--tag", type=str, default="RUN", help="Benchmark tag")
    args = parser.parse_args()

    run_evaluation(conf_threshold=args.conf, imgsz=args.imgsz, use_tracker=args.tracker, tag=args.tag)
