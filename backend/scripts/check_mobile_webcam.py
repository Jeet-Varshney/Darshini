#!/usr/bin/env python3
"""
CrowdFlow Sentinel - Mobile USB Webcam Diagnostic & Verification Utility
Checks ADB USB connection, Iriun daemon status, and verifies live video capture on /dev/video2.
"""

import os
import subprocess
import sys
import time
import cv2

def run_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        return res.stdout.strip()
    except Exception as e:
        return f"Error: {e}"

def check_status():
    print("=" * 60)
    print(" CrowdFlow Sentinel: Mobile USB Webcam Diagnostic")
    print("=" * 60)
    
    # 1. Check ADB Devices
    print("\n[1] Checking USB Connection (Android ADB)...")
    adb_output = run_cmd("adb devices -l")
    lines = [l for l in adb_output.splitlines() if l.strip() and not l.startswith("List of devices")]
    
    if not lines:
        print("  ⚠️  No Android device detected over USB cable.")
        print("     To fix:")
        print("     1. Connect phone with a high-quality USB DATA cable (not charge-only).")
        print("     2. On phone: Go to Settings > Developer Options > Enable 'USB Debugging'.")
        print("     3. Tap 'Allow USB debugging' when prompted on your phone screen.")
    else:
        for line in lines:
            if "unauthorized" in line:
                print(f"  ⚠️  Device connected but UNAUTHORIZED: {line}")
                print("     Unlock your phone and tap 'Allow USB debugging' on the popup dialog.")
            else:
                print(f"  ✅ Device connected & authorized: {line}")

    # 2. Check Iriun Webcam Host Daemon
    print("\n[2] Checking Iriun Linux Host Service...")
    iriun_proc = run_cmd("pgrep -a iriunwebcam")
    if iriun_proc:
        print(f"  ✅ Iriun webcam daemon is running (PID: {iriun_proc.split()[0]}).")
    else:
        print("  ⚠️  Iriun daemon not running. Launching it now...")
        subprocess.Popen(["/usr/local/bin/iriunwebcam"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)
        print("  ✅ Started /usr/local/bin/iriunwebcam")

    # 3. Check V4L2 Device Node (/dev/video2)
    print("\n[3] Checking Video Device Nodes...")
    target_node = "/dev/video2"
    if not os.path.exists(target_node):
        print(f"  ❌ {target_node} does not exist.")
        # Check any other video devices
        v_devs = [f"/dev/{d}" for d in os.listdir("/dev") if d.startswith("video")]
        print(f"     Available nodes: {v_devs}")
        return
    else:
        print(f"  ✅ Video device node exists: {target_node}")

    # 4. Test OpenCV Frame Capture on /dev/video2
    print(f"\n[4] Testing Live Frame Grab from {target_node}...")
    cap = cv2.VideoCapture(2, cv2.CAP_V4L2)
    if not cap.isOpened():
        # Try default backend
        cap = cv2.VideoCapture(2)

    if not cap.isOpened():
        print(f"  ❌ Unable to open {target_node} with OpenCV.")
        print("     Ensure your mobile app (Iriun Webcam) is opened on your phone.")
        return

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"  ℹ️  Negotiated resolution: {width}x{height}")

    frames_read = 0
    t0 = time.time()
    for _ in range(10):
        ret, frame = cap.read()
        if ret and frame is not None and frame.size > 0:
            frames_read += 1
        time.sleep(0.05)

    cap.release()
    elapsed = time.time() - t0

    if frames_read > 0:
        fps = frames_read / max(elapsed, 0.001)
        print(f"  ✅ SUCCESS! Captured {frames_read}/10 frames (~{fps:.1f} FPS).")
        print("\n" + "=" * 60)
        print(" READY TO STREAM IN CRODFLOW SENTINEL UI:")
        print(" 1. Open http://localhost:5173")
        print(" 2. Go to Screen 2: 'Camera & Detection'")
        print(" 3. In 'Select Video Capture Device', choose:")
        print("    '● Iriun Webcam (Virtual Webcam) [/dev/video2]'")
        print(" 4. Click 'Start Camera Stream'")
        print("=" * 60)
    else:
        print("  ⚠️  Camera node opened, but returned blank frames.")
        print("     Make sure:")
        print("     1. 'Iriun Webcam' app is OPEN on your phone.")
        print("     2. Phone and PC are connected via USB cable with USB debugging enabled.")

if __name__ == "__main__":
    check_status()
