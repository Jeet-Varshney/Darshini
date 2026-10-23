#!/usr/bin/env python3
"""
CrowdFlow Sentinel - Pipeline Diagnostic & Benchmark Tool
Measures camera capture performance, YOLOv8 CPU inference latency at various imgsz,
JPEG encoding latency and payload sizes, and end-to-end frame age.
"""

import os
import sys
import time
import base64
from pathlib import Path
import cv2
import numpy as np

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import MODEL_PATH, PERSON_CLASS_ID
from ultralytics import YOLO
import torch

def diagnose():
    print("=" * 70)
    print("CROWDFLOW SENTINEL - COMPLETE PIPELINE DIAGNOSTIC REPORT")
    print("=" * 70)

    # 1. Hardware & System Profiling
    print("\n[1] SYSTEM & HARDWARE PROFILING")
    import platform
    import psutil
    print(f"  OS: {platform.system()} {platform.release()} ({platform.machine()})")
    print(f"  CPU: {platform.processor() or 'x86_64'} | Physical Cores: {psutil.cpu_count(logical=False)}, Logical: {psutil.cpu_count(logical=True)}")
    ram = psutil.virtual_memory()
    print(f"  RAM Total: {ram.total / (1024**3):.2f} GB | Available: {ram.available / (1024**3):.2f} GB | Used: {ram.percent}%")
    print(f"  PyTorch Version: {torch.__version__} | Threads: {torch.get_num_threads()}")
    print(f"  PyTorch CUDA Available: {torch.cuda.is_available()}")

    # 2. Camera Capture Profiling
    print("\n[2] CAMERA CAPTURE PROFILING")
    for dev_idx in [0, 2]:
        node = f"/dev/video{dev_idx}"
        if not os.path.exists(node):
            print(f"  Device {node}: Does not exist on host.")
            continue

        cap = cv2.VideoCapture(dev_idx, cv2.CAP_V4L2)
        if not cap.isOpened():
            cap = cv2.VideoCapture(dev_idx)

        if not cap.isOpened():
            print(f"  Device {node}: Failed to open.")
            continue

        # Test default resolution
        dw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        dh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        dfps = cap.get(cv2.CAP_PROP_FPS)

        # Request 640x480
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_FPS, 30)

        rw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        rh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        rfps = cap.get(cv2.CAP_PROP_FPS)

        # Capture 30 frames and measure actual capture FPS
        t0 = time.time()
        read_success = 0
        read_times = []
        sample_frame = None

        for _ in range(30):
            t_f0 = time.time()
            ret, frame = cap.read()
            t_f1 = time.time()
            if ret and frame is not None and frame.size > 0:
                read_success += 1
                read_times.append((t_f1 - t_f0) * 1000)
                sample_frame = frame

        elapsed = time.time() - t0
        cap.release()

        measured_fps = read_success / max(elapsed, 0.001)
        avg_read_ms = sum(read_times) / max(len(read_times), 1)
        print(f"  Device {node}:")
        print(f"    - Requested Resolution: 640x480 @ 30 FPS")
        print(f"    - Delivered Resolution: {rw}x{rh} (reported FPS prop: {rfps})")
        print(f"    - Frames Captured: {read_success}/30 in {elapsed:.3f}s")
        print(f"    - Actual Measured Capture FPS: {measured_fps:.2f} FPS")
        print(f"    - Avg cap.read() wait time: {avg_read_ms:.1f} ms")

    # 3. Model Loading & Inference Profiling
    print("\n[3] MODEL LOADING & INFERENCE PROFILING")
    t_load_0 = time.time()
    model = YOLO(str(MODEL_PATH))
    t_load_ms = (time.time() - t_load_0) * 1000
    print(f"  Model Weights: {MODEL_PATH.name} ({MODEL_PATH.stat().st_size / (1024*1024):.2f} MB)")
    print(f"  Model Load Time: {t_load_ms:.1f} ms")

    # Generate synthetic or real frame for benchmark
    test_frame = sample_frame if sample_frame is not None else np.zeros((480, 640, 3), dtype=np.uint8)

    # Warmup
    print("  Warming up model inference...")
    with torch.inference_mode():
        _ = model(test_frame, device="cpu", verbose=False, imgsz=320)

    # Compare inference latency at different image sizes: 640, 416, 320
    test_sizes = [640, 416, 320]
    print("\n  Benchmarking YOLOv8n CPU Inference Latency (15 iterations each):")
    for sz in test_sizes:
        durations = []
        person_count = 0
        for _ in range(15):
            t0 = time.time()
            with torch.inference_mode():
                results = model(
                    test_frame,
                    device="cpu",
                    conf=0.25,
                    classes=[PERSON_CLASS_ID],
                    imgsz=sz,
                    verbose=False,
                )
            durations.append((time.time() - t0) * 1000)
            if results and hasattr(results[0], "boxes") and results[0].boxes is not None:
                person_count = len(results[0].boxes)

        avg_ms = sum(durations) / len(durations)
        min_ms = min(durations)
        max_ms = max(durations)
        equiv_fps = 1000.0 / avg_ms
        print(f"    - imgsz={sz:3d}: Avg={avg_ms:5.1f} ms | Min={min_ms:5.1f} ms | Max={max_ms:5.1f} ms | Max Rate: {equiv_fps:4.1f} FPS | Detected: {person_count}")

    # 4. Frame Encoding & Base64 Payload Sizing
    print("\n[4] FRAME ENCODING & PAYLOAD SIZING")
    test_resolutions = [
        ("Full (delivered)", test_frame.shape[1], test_frame.shape[0]),
        ("640x360 (Preview)", 640, int(round(test_frame.shape[0] * (640 / test_frame.shape[1])))),
        ("480x270 (Compact)", 480, int(round(test_frame.shape[0] * (480 / test_frame.shape[1])))),
    ]

    for label, w, h in test_resolutions:
        resized = cv2.resize(test_frame, (w, h), interpolation=cv2.INTER_AREA)
        for q in [85, 70, 60]:
            t0 = time.time()
            success, buf = cv2.imencode(".jpg", resized, [int(cv2.IMWRITE_JPEG_QUALITY), q])
            enc_time_ms = (time.time() - t0) * 1000
            raw_kb = len(buf) / 1024.0
            b64_str = base64.b64encode(buf).decode("utf-8")
            b64_kb = len(b64_str) / 1024.0
            print(f"    - {label:18s} ({w}x{h}) @ Quality {q:2d}: Enc={enc_time_ms:4.2f} ms | JPEG: {raw_kb:5.1f} KB | Base64: {b64_kb:5.1f} KB")

    print("\n" + "=" * 70)
    print("DIAGNOSTIC COMPLETE")
    print("=" * 70)

if __name__ == "__main__":
    diagnose()
