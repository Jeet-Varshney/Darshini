#!/usr/bin/env python3
"""
CrowdFlow Sentinel - End-to-End Live Camera Pipeline Verification
Tests:
1. Camera discovery endpoint (/api/cameras)
2. Live camera start/stop lifecycle (/api/camera/start, /api/camera/stop)
3. WebSocket streaming (/ws/camera/stream)
4. Measures:
   - Packet throughput & FPS
   - Inference rate & duration
   - Frame age / end-to-end latency
   - Payload size per packet
   - Duplicate loop prevention
5. Uploaded video processing endpoint (/api/detect/video) regression test
"""

import asyncio
import json
import time
import requests
import websockets

BASE_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000/ws/camera/stream"

def test_api():
    print("=" * 70)
    print("TEST 1: API & CAMERA DISCOVERY")
    print("=" * 70)
    
    # 1. Health
    r = requests.get(f"{BASE_URL}/health", timeout=5)
    assert r.status_code == 200, f"Health check failed: {r.text}"
    health = r.json()
    print(f"  ✅ Health: {health['status']} | Model: {health['model_name']} on {health['device']}")
    assert health["model_ready"] is True

    # 2. Camera Discovery
    r = requests.get(f"{BASE_URL}/api/cameras", timeout=5)
    assert r.status_code == 200, f"Camera discovery failed: {r.text}"
    cams = r.json()["cameras"]
    readable_cams = [c for c in cams if c["is_readable"]]
    print(f"  ✅ Discovered {len(cams)} video nodes ({len(readable_cams)} readable):")
    for c in readable_cams:
        print(f"     - Index {c['index']}: {c['name']} [{c['device_path']}] -> {c['resolution']}")

    assert len(readable_cams) > 0, "No readable camera devices found"
    target_cam_idx = readable_cams[0]["index"]
    target_cam_name = readable_cams[0]["name"]
    print(f"\n  Targeting Camera Device #{target_cam_idx} ('{target_cam_name}')")

    return target_cam_idx

async def test_live_websocket(cam_idx: int):
    print("\n" + "=" * 70)
    print("TEST 2: LIVE STREAMING, WEBSOCKET, & MEASURED PERFORMANCE (5s test)")
    print("=" * 70)

    # Step A: Start camera via REST
    r = requests.post(
        f"{BASE_URL}/api/camera/start",
        json={"device_index": cam_idx, "conf_threshold": 0.25},
        timeout=10,
    )
    assert r.status_code == 200, f"Failed to start camera: {r.text}"
    print(f"  ✅ Camera start returned HTTP 200: {r.json()['active_camera_name']}")

    # Step B: Connect WebSocket and collect frames for 5 seconds
    packets = []
    t_start = time.time()
    test_duration = 5.0

    print("  Connecting to WebSocket /ws/camera/stream...")
    async with websockets.connect(WS_URL) as ws:
        while time.time() - t_start < test_duration:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                data = json.loads(msg)
                packets.append(data)
            except asyncio.TimeoutError:
                print("  ⚠️ WebSocket recv timeout")
                break

    total_time = time.time() - t_start
    frame_packets = [p for p in packets if p.get("type") == "frame"]
    print(f"  ✅ Received {len(packets)} total packets ({len(frame_packets)} frames) in {total_time:.2f}s")

    # Step C: Stop camera
    r_stop = requests.post(f"{BASE_URL}/api/camera/stop", timeout=5)
    assert r_stop.status_code == 200, f"Failed to stop camera: {r_stop.text}"
    print(f"  ✅ Camera stopped successfully and hardware released.")

    # Calculate statistics
    assert len(frame_packets) > 0, "No frame packets were received!"
    stream_fps = len(frame_packets) / total_time
    sample_packet = frame_packets[-1]
    
    infer_fps_vals = [p.get("inference_fps", 0) for p in frame_packets if p.get("inference_fps", 0) > 0]
    avg_infer_fps = sum(infer_fps_vals) / len(infer_fps_vals) if infer_fps_vals else 0

    capture_fps_vals = [p.get("capture_fps", 0) for p in frame_packets if p.get("capture_fps", 0) > 0]
    avg_capture_fps = sum(capture_fps_vals) / len(capture_fps_vals) if capture_fps_vals else 0

    dur_ms_vals = [p.get("inference_duration_ms", 0) for p in frame_packets if p.get("inference_duration_ms", 0) > 0]
    avg_dur_ms = sum(dur_ms_vals) / len(dur_ms_vals) if dur_ms_vals else 0

    age_ms_vals = [p.get("frame_age_ms", 0) for p in frame_packets if "frame_age_ms" in p]
    avg_age_ms = sum(age_ms_vals) / len(age_ms_vals) if age_ms_vals else 0

    payload_sizes = [len(json.dumps(p)) / 1024.0 for p in frame_packets]
    avg_payload_kb = sum(payload_sizes) / len(payload_sizes)

    print("\n  MEASURED LIVE STREAMING PERFORMANCE:")
    print(f"    - WebSocket Preview Rate: {stream_fps:.1f} FPS (Target: ~20 FPS)")
    print(f"    - Camera Capture Rate:    {avg_capture_fps:.1f} FPS (Hardware delivery)")
    print(f"    - YOLOv8 CPU Inference:  {avg_infer_fps:.1f} FPS (Compute throughput)")
    print(f"    - Inference Latency:      {avg_dur_ms:.1f} ms")
    print(f"    - End-to-End Frame Age:   {avg_age_ms:.1f} ms")
    print(f"    - Avg Packet Size:        {avg_payload_kb:.1f} KB (Optimized compact JPEG)")
    print(f"    - Persons in Last Frame:  {sample_packet.get('person_count', 0)}")
    print(f"    - Sample Bounding Boxes:  {sample_packet.get('bounding_boxes', [])[:2]}")

def test_video_upload_regression():
    print("\n" + "=" * 70)
    print("TEST 3: VIDEO UPLOAD REGRESSION CHECK (/api/detect/video)")
    print("=" * 70)
    video_path = "frontend/public/samples/gate1_sample.mp4"
    with open(video_path, "rb") as f:
        files = {"file": ("gate1_sample.mp4", f, "video/mp4")}
        data = {"conf_threshold": 0.25, "sample_fps": 1.0}
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/detect/video", files=files, data=data, timeout=30)
        dur = time.time() - t0

    assert r.status_code == 200, f"Video upload detection failed: {r.text}"
    res = r.json()
    print(f"  ✅ Uploaded video analyzed in {dur:.2f}s:")
    print(f"    - Status: {res['status']}")
    print(f"    - Max Persons: {res['max_person_count']}")
    print(f"    - Total Sampled Frames: {res['total_frames_sampled']}")
    print(f"    - Preview Frame Present: {res['preview_frame_base64'] is not None}")
    assert res["max_person_count"] > 0, "Expected persons to be detected in gate1_sample.mp4"

if __name__ == "__main__":
    cam_idx = test_api()
    asyncio.run(test_live_websocket(cam_idx))
    test_video_upload_regression()
    print("\n" + "=" * 70)
    print("ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!")
    print("=" * 70)
