# Live USB Mobile Webcam Freeze Audit
**Project:** Darshini  
**Component:** Live Person Detection & Camera Streaming Pipeline  
**Investigation Scope:** USB-Connected Mobile Webcams (Iriun, DroidCam, external USB webcams)  
**Status:** Read-Only Technical Audit (No code modified)

---

## 1. Actual End-to-End Frame Flow in Current Code

The application provides two distinct camera capture engines selectable in the UI:
- **Engine A: Browser Camera (Client MediaDevices)** — *Default mode for cross-device client operation*
- **Engine B: Server Hardware (Linux V4L2)** — *Local edge appliance mode*

### Pipeline Trace: Engine A (Browser Camera via MediaDevices)

```
[Mobile Phone via USB]
       │ (USB cable via Iriun/DroidCam driver)
       ▼
[Browser MediaDevices API]
       │ navigator.mediaDevices.getUserMedia({ video: { deviceId } })
       ▼
[Hidden HTMLVideoElement]
       │ <video ref={hiddenVideoRef} playsInline muted autoPlay style={{ display: 'none' }} />
       ▼
[Client Capture Loop]
       │ window.setInterval(..., 80ms)
       │ Check: if (isInferringRef.current) return;
       │ ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
       │ b64Data = canvas.toDataURL('image/jpeg', 0.75);
       │ isInferringRef.current = true;
       ▼
[WebSocket Client Transport]
       │ wsRef.current.send({"action": "infer_frame", "image": b64Data, ...})
       ▼
[FastAPI WebSocket Handler]
       │ backend/app/api/routes.py: websocket_camera_stream() -> listen_for_client_commands()
       │ Offloaded to worker thread: asyncio.to_thread(live_camera_manager.process_client_frame)
       ▼
[Inference & Stationary Tracking Engine]
       │ base64.b64decode() -> cv2.imdecode() -> np.ndarray (BGR)
       │ model_service.detect_persons(frame_bgr, conf=0.15) (YOLOv8n CPU)
       │ StationaryPersonTracker.update(raw_detections) (Hysteresis tracking)
       │ live_camera_manager._render_live_annotation() (Draw bounding boxes & Darshini HUD)
       │ cv2.imencode('.jpg') -> base64 string
       ▼
[WebSocket Response Dispatch]
       │ safe_send(json.dumps(result)) using asyncio.Lock
       ▼
[Frontend Reception & State Update]
       │ ws.onmessage: packet.type === 'frame'
       │ isInferringRef.current = false;
       │ setLiveFramePacket(packet);
       ▼
[React UI Rendering]
       │ <img src={liveFramePacket.image} className="preview-image" />
       │ Metric tiles: Person Count, Scene Tracking, Capture FPS, Inference FPS
```

### Pipeline Trace: Engine B (Server Hardware via Linux V4L2)

```
[Mobile Phone via USB]
       │ Exposes /dev/video* via v4l2loopback
       ▼
[FastAPI Start Request]
       │ POST /api/camera/start -> live_camera_manager.start(device_index)
       ▼
[OpenCV VideoCapture & 3 Dedicated Threads]
       │ Thread 1 (CaptureWorker): while is_running: ret, frame = cap.read()
       │ Thread 2 (InferenceWorker): YOLOv8 CPU inference with stationary tracking
       │ Thread 3 (StreamWorker): Render annotated frame @ 15 FPS -> _broadcast_packet()
       ▼
[Asyncio Queue Dispatch]
       │ _loop.call_soon_threadsafe(_safe_dispatch_to_queue, queue, packet)
       ▼
[WebSocket Stream Delivery]
       │ routes.py: packet = await queue.get() -> safe_send(packet)
       ▼
[Frontend Reception]
       │ ws.onmessage -> setLiveFramePacket(packet) -> UI render
```

---

## 2. Evidence-Based Root Causes of the Freeze

### Root Cause 1 (Primary): `<video style="display: none">` Halts Browser Video Decoding After the First Frame
- **File:** `frontend/src/screens/CameraDetectionScreen.tsx`
- **Line Number:** Line 595
```tsx
<video ref={hiddenVideoRef} playsInline muted autoPlay style={{ display: 'none' }} />
```
- **Technical Mechanism:**  
  In modern browser engines (Chromium Blink, WebKit, and Gecko), elements styled with `display: 'none'` have no `LayoutObject` in the layout tree.  
  1. When `hiddenVideoRef.current.srcObject = stream` and `play()` are called, the browser processes the initial frame to resolve `videoWidth`, `videoHeight`, and transition `readyState` to `HAVE_CURRENT_DATA` (2).
  2. Because the `<video>` element is not in the layout tree, browser power/resource optimization algorithms **suspend further video decoder paint callbacks**.
  3. On subsequent ticks of `setInterval` (every 80ms), `ctx.drawImage(video, ...)` continues to paint the frozen first frame buffer, or if the USB camera stream halts presentation callbacks, `video.readyState` or `video.videoWidth` stalls.
  4. The user observes the camera preview rendering exactly one frame and then freezing.

### Root Cause 2 (Primary): `isInferringRef.current` Deadlock Without Timeout or Socket Failure Recovery
- **File:** `frontend/src/screens/CameraDetectionScreen.tsx`
- **Line Numbers:** Lines 188–207, 351–354, 382–384
```ts
351: if (isInferringRef.current) {
352:   return;
353: }
...
383: isInferringRef.current = true;
```
- **Technical Mechanism:**  
  `isInferringRef.current` acts as a binary mutex gate to enforce bounded capacity-1 queueing. It is set to `true` when a frame is dispatched over WebSocket.  
  However, it is **only reset to `false`** if the WebSocket receives a packet of `type === 'frame'` or `type === 'error'`:
```ts
190: if (packet.type === 'frame') {
191:   isInferringRef.current = false;
...
194: } else if (packet.type === 'error') {
195:   isInferringRef.current = false;
```
  **Critical flaw:**  
  - If the WebSocket closes (`onClose`), `isInferringRef.current` is **never reset**.
  - If a network error occurs (`onError`), `isInferringRef.current` is **never reset**.
  - If the backend takes longer to process or drops the frame, `isInferringRef.current` is **never reset** (no watchdog timer).
  - Once stuck `true`, line 352 causes every single future execution of `setInterval` to abort at line 353. The capture loop permanently deadlocks after frame 1.

### Root Cause 3 (Secondary): Device Re-enumeration in Start Handler Triggers React Mount Effect and Resets WebSocket
- **File:** `frontend/src/screens/CameraDetectionScreen.tsx`
- **Line Numbers:** Lines 138–160, 214–235, 327–328
```ts
327: // Re-enumerate devices so browser populates device labels now that permission was granted
328: await refreshBrowserCameras();
```
- **Technical Mechanism:**  
  Inside `refreshBrowserCameras()`, line 152 calls `setSelectedBrowserDeviceId(videoInputs[0].deviceId)`.  
  Because `selectedBrowserDeviceId` is in the dependency array of `refreshBrowserCameras` (`useCallback(..., [selectedBrowserDeviceId])`), its identity changes.  
  Because `refreshBrowserCameras` is in the dependency array of the main `useEffect` (line 235), the main effect re-runs while streaming:
  ```ts
  214: useEffect(() => {
  ...
  220:   fetchCameraStatus().then((status) => {
  221:     if (status.is_streaming) {
  ...
  231:       connectWebSocket(); // Closes the active WebSocket and opens a new one!
  ```
  If `connectWebSocket()` is invoked during frame 1 transmission, the socket is destroyed before the frame 1 response is processed. `isInferringRef.current` remains `true` indefinitely.

### Root Cause 4 (Secondary): Wall-Clock `setInterval` Capture Rather Than Video Frame Callback
- **File:** `frontend/src/screens/CameraDetectionScreen.tsx`
- **Line Numbers:** Lines 331–333, 349–395
- **Technical Mechanism:**  
  The capture loop is driven by an uncoupled `window.setInterval(..., 80)` (12.5 Hz).  
  - It does not synchronize with actual hardware frame delivery via `HTMLVideoElement.requestVideoFrameCallback()`.
  - It does not wait for `loadeddata` or `onplaying` events before starting the timer.
  - USB mobile webcams (especially over ADB or USB virtual video drivers) have an initial frame negotiation latency of 300–800ms. Starting `setInterval` immediately after `play()` often captures an uninitialized or corrupt initial buffer.

### Root Cause 5 (Engine B Specific): V4L2 Device Contention and Tight Failure Threshold
- **File:** `backend/app/services/camera_stream.py` & `backend/app/services/camera_discovery.py`
- **Line Numbers:** `camera_stream.py:618–629`, `camera_discovery.py:133–148`
- **Technical Mechanism:**  
  If the user chooses Engine B (Server Hardware V4L2):
  1. **Tight Threshold:** `_capture_worker` counts consecutive read failures:
     ```python
     if consecutive_failures > 20:
         err = f"Camera device /dev/video{self._device_index} stopped delivering frames."
         break
     ```
     With `time.sleep(0.02)`, 20 failures equal **only 400 milliseconds**. Mobile webcams transmitting over USB frequently experience brief pipeline sync delays during format negotiation or autofocus adjustments. A 400ms stall causes the capture worker thread to permanently terminate.
  2. **Device Locking:** Virtual V4L2 devices (`v4l2loopback`) are single-consumer. When `camera_discovery_service.discover_cameras()` probes `/dev/video*` by test-opening and releasing it, any concurrent stream read causes an immediate hardware contention.

---

## 3. Existing Protections That Already Work

1. **CPU Thread-Pool Offloading:**  
   In `backend/app/api/routes.py` (lines 423–431), client frame inference is wrapped in `await asyncio.to_thread(live_camera_manager.process_client_frame, ...)`. This prevents CPU-bound YOLO inference from blocking the FastAPI event loop.
2. **WebSocket Send Lock:**  
   In `backend/app/api/routes.py` (lines 385–391), `safe_send()` acquires `async with send_lock:`, preventing concurrent write collisions on the WebSocket transport.
3. **Thread-Safe Queue Dispatching:**  
   In `backend/app/services/camera_stream.py` (lines 1041–1063), `_broadcast_packet()` uses `self._loop.call_soon_threadsafe(_safe_dispatch_to_queue, queue, packet)` to safely pass frames from background worker OS threads to the asyncio event loop.
4. **OpenCV Segfault Prevention on Shutdown:**  
   In `backend/app/services/camera_stream.py` (lines 551–564), `_capture_thread.join(timeout=1.0)` is awaited before invoking `cap.release()`, avoiding C-level segfaults between `cap.read()` and `cap.release()`.
5. **Stationary-Person Hysteresis Tracking:**  
   `StationaryPersonTracker` maintains confirmed tracks across frames without accumulating counts across time.
6. **Bounded Latest-Frame Queue:**  
   The frontend limits in-flight inference using `isInferringRef`, and the backend stream worker maintains a capacity-1 raw frame buffer.

---

## 4. Missing Safeguards

1. **No Visible Layout Presence for Video Element:**  
   The `<video>` element uses `display: none`, triggering browser frame throttling and presentation halting.
2. **No Timeout / Watchdog on In-Flight Inference:**  
   If `isInferringRef.current` remains `true` for more than 2.0 seconds, there is no automatic watchdog to reset it to `false` and resume streaming.
3. **No Reset on WebSocket Drop or Error:**  
   `ws.onerror` and `ws.onclose` do not reset `isInferringRef.current = false`, guaranteeing a permanent freeze if any network blip occurs.
4. **No Reconnection Logic:**  
   When the WebSocket drops or the mobile USB connection is briefly interrupted, the frontend logs an error banner but does not attempt exponential-backoff reconnection.
5. **No MediaStreamTrack Health Monitoring:**  
   The frontend does not listen for `track.onended` or `track.onmute` on the active video track. If the mobile app disconnects or locks, the app silently polls empty/frozen frames without notifying the user.
6. **No Frame Synchronization via `requestVideoFrameCallback`:**  
   The loop relies on `setInterval` instead of `requestVideoFrameCallback`, missing native presentation events and frame metadata.
7. **No V4L2 Read Timeout in OpenCV:**  
   OpenCV's `cv2.VideoCapture` on Linux has no default timeout. If a USB device stops delivering frames, `cap.read()` blocks the capture thread indefinitely.

---

## 5. Prioritized Minimal Fix Plan

### Priority 1: Render Video in Layout Tree (Fix Primary Freeze)
- **Target File:** `frontend/src/screens/CameraDetectionScreen.tsx`
- **Action:** Replace `style={{ display: 'none' }}` on `<video ref={hiddenVideoRef}>` with an off-screen layout style:
  ```css
  style={{
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    width: '320px',
    height: '240px',
    opacity: 0,
    pointerEvents: 'none',
  }}
  ```
  *Benefit:* Keeps the video element fully active in the browser compositor, ensuring continuous hardware decoding and frame updates.

### Priority 2: Add In-Flight Inference Watchdog & Socket Recovery
- **Target File:** `frontend/src/screens/CameraDetectionScreen.tsx`
- **Action:**
  1. In `captureTimerRef.current`: Record `lastDispatchTimeRef`. If `isInferringRef.current === true` and `Date.now() - lastDispatchTimeRef > 2000` (2s timeout), log a warning and reset `isInferringRef.current = false`.
  2. In `createCameraWebSocket`: Ensure `onError` and `onClose` callbacks explicitly set `isInferringRef.current = false`.
  *Benefit:* Completely eliminates deadlock. If a frame or packet is lost, the capture loop recovers within 2 seconds.

### Priority 3: Modernize Frame Capture to `requestVideoFrameCallback` with Fallback
- **Target File:** `frontend/src/screens/CameraDetectionScreen.tsx`
- **Action:**
  Replace blind `setInterval` with a recursive `requestVideoFrameCallback(captureFrame)` loop (falling back to `requestAnimationFrame` or interval if unsupported).
  Await `loadeddata` or `onplaying` before launching the capture loop:
  ```ts
  video.onplaying = () => { startCaptureLoop(); };
  ```
  *Benefit:* Synchronizes frame dispatch directly with fresh camera hardware presentation.

### Priority 4: Monitor `MediaStreamTrack` Lifecycle Events
- **Target File:** `frontend/src/screens/CameraDetectionScreen.tsx`
- **Action:** Attach `track.onended` and `track.onmute` listeners to `stream.getVideoTracks()[0]`:
  - `onmute`: Display warning: *"Mobile camera stream paused (screen locked or USB busy)."*
  - `onended`: Display error: *"Mobile camera disconnected. Check USB cable."* and cleanly transition state.
  *Benefit:* Clear, actionable user feedback instead of a silent freeze when the USB cable or mobile app drops.

### Priority 5: Increase Server V4L2 Failure Threshold & Non-Blocking Read
- **Target File:** `backend/app/services/camera_stream.py`
- **Action:** Increase `consecutive_failures` threshold from 20 to 100 (2.0s grace period) and log a warning before terminating the capture thread.
  *Benefit:* Prevents premature worker death during USB bus sync jitter.

---

## 6. Reproducible Test Plan Using Real USB Mobile Webcam

### Test Environment Setup
1. **Device:** Android or iOS smartphone running Iriun Webcam or DroidCam app.
2. **Connection:** High-quality USB data cable connected to host PC.
3. **Operating System Verification:**
   ```bash
   # Check if USB webcam is detected by Linux V4L2
   v4l2-ctl --list-devices
   # Verify device nodes exist (e.g., /dev/video0 or /dev/video2)
   ls -la /dev/video*
   ```
4. **Browser Verification:**
   - Open Chrome / Edge at `http://localhost:5173`.
   - Open Developer Tools Console (`F12`).
   - Navigate to **Camera & Detection** (`[2]`).

### Execution Steps
1. In the **Camera Source & Controls** card, ensure **Browser Camera (Client)** is selected.
2. Click **Rescan Inputs**. Confirm the mobile phone webcam appears in the dropdown (e.g., `"Iriun Webcam"` or `"DroidCam Source"`).
3. Select the mobile camera device.
4. Click **Start Browser Camera**.
5. Observe the Developer Tools Console and the **Real-Time Annotated Camera Feed**.
6. Wave a hand or move a person in front of the mobile phone camera continuously for 60 seconds.
7. Record whether the HUD timestamp and bounding boxes continue to update.

---

## 7. Separate Verification Criteria

| Verification Domain | Success Criteria | Failure Indicator |
| :--- | :--- | :--- |
| **1. Continuous Frame Capture** | `clientCaptureFps` stays at 12–15 FPS continuously. Hidden video `currentTime` advances continuously. | `clientCaptureFps` drops to 0.0 FPS after 1 frame. `video.readyState` stalls. |
| **2. Continuous WebSocket Traffic** | Chrome DevTools Network Tab -> WS messages show ongoing alternating `infer_frame` send and receive packets ($\approx 10\text{--}15$ msgs/sec). | WS traffic ceases after 1 message pair. |
| **3. Ongoing YOLO Inference** | Backend log continuously outputs inference timings (`INFER: ~45ms`). Telemetry `inference_fps` reflects steady 10–14 FPS. | Backend logs no inference activity after the first frame. |
| **4. Changing Detection Results** | Person walking in and out of the phone's field of view causes `person_count` and bounding boxes to change in real time. | The preview image and bounding boxes remain identical despite physical motion. |
| **5. Temporary Disconnect Recovery** | Unplugging the USB cable triggers `"Mobile camera disconnected"` notification. Re-plugging and clicking restart restores streaming without refreshing the page. | Application hangs, crashes, or requires a full browser reload. |

---
*Report prepared for technical review prior to code modification.*
