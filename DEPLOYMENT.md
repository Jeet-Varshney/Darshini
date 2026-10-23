# Darshini — Deployment & Cloud Inference Guide

This guide describes how to deploy **Darshini** as a multi-device, browser-based crowd safety command center with centralized computer-vision model hosting.

---

## 1. Architectural Model

```
┌────────────────────────────────┐         Secure WebSocket         ┌───────────────────────────────┐
│     User's Web Browser         │ ──────────────────────────────── │   Central Darshini Backend    │
│  (Mac / Windows / Linux / iOS) │  (WSS / Frame stream: 12-15 FPS) │        (FastAPI Service)      │
│                                │                                  │                               │
│  - navigator.mediaDevices      │ ◀─────────────────────────────── │  - Central YOLOv8n Model      │
│  - navigator.geolocation       │    Detection results, boxes,     │  - Stationary Person Tracker  │
│  - Zero Python / PyTorch / CV  │    annotated frames & telemetry  │  - Live Zone Status Engine    │
└────────────────────────────────┘                                  └───────────────────────────────┘
```

### Key Architectural Advantages
1. **Zero Client Dependencies:** Any device with a modern browser can access Darshini. Users do **not** install Python, PyTorch, OpenCV, CUDA, or model weights on their laptops or mobile devices.
2. **Browser-Based Dynamic Hardware Discovery:** Client webcams, USB cameras, and virtual cameras (Iriun, DroidCam, OBS) are enumerated directly via `navigator.mediaDevices.enumerateDevices()` and captured via `getUserMedia()`.
3. **Dedicated In-Memory Processing:** Video frames are decoded and evaluated in RAM. Frames are **never** stored permanently on disk or forwarded to external third parties.

---

## 2. Infrastructure Requirements

| Component | Minimum Specification | Recommended Specification |
|---|---|---|
| **CPU** | 2 vCPUs (x86_64 or ARM64) | 4 vCPUs |
| **RAM** | 1.5 GB Available RAM | 4.0 GB Available RAM |
| **Storage** | 2.0 GB (OS + PyTorch + YOLO weights) | 10 GB SSD |
| **Network** | 10 Mbps duplex | 50 Mbps duplex |
| **Execution Model** | **Persistent Process** (Stateful / Long-Lived) | **Persistent Process** |

> [!IMPORTANT]
> **Why Serverless (AWS Lambda, Vercel Serverless) Is Not Supported:**
> Serverless functions enforce execution timeouts, terminate background threads, cannot maintain stateful WebSocket streams, and suffer from cold-start model weight reload penalties. Darshini requires a persistent container or VM process.

---

## 3. HTTPS / WSS Security Requirement

Modern web browsers enforce strict security restrictions:
- `navigator.mediaDevices.getUserMedia()` requires a **secure context** (`https://` or `localhost`).
- `navigator.geolocation` requires a **secure context** (`https://` or `localhost`).

When hosting Darshini remotely, ensure an SSL certificate (e.g., Let's Encrypt or Cloudflare SSL) terminates HTTPS and forwards WebSocket upgrades to the backend.

### Nginx Reverse Proxy Configuration Example

```nginx
server {
    listen 80;
    server_name darshini.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name darshini.example.com;

    ssl_certificate /etc/letsencrypt/live/darshini.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/darshini.example.com/privkey.pem;

    # Static Frontend Assets
    location / {
        root /var/www/darshini/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend REST Endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health Endpoint
    location /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_set_header Host $host;
    }

    # Persistent WebSocket Stream
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

## 4. Deployment Methods

### Option A: Docker Compose (Single Host / Local Server)

1. Clone repository and verify environment files:
   ```bash
   cd /home/jyno/Projects/Darshini
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
2. Build and start containers:
   ```bash
   docker compose up -d --build
   ```
3. Verify backend health:
   ```bash
   curl http://localhost:8000/health
   ```
4. Access application at `http://localhost:5173`.

---

### Option B: Cloud Hosting (Render / Railway / Fly.io / DigitalOcean)

#### 1. Backend Service
- **Service Type:** Web Service (Persistent Docker)
- **Root Directory:** `backend`
- **Build Command:** Built via `backend/Dockerfile`
- **Environment Variables:**
  ```env
  MODEL_PATH=weights/yolov8n.pt
  HOST=0.0.0.0
  PORT=8000
  CORS_ORIGINS=https://darshini-frontend.example.com
  ```
- **Health Check Path:** `/health`

#### 2. Frontend Static Site
- **Service Type:** Static Web App (Vercel, Netlify, Cloudflare Pages, or Render Static)
- **Root Directory:** `frontend`
- **Build Command:** `npm run build`
- **Publish Directory:** `dist`
- **Environment Variables:**
  ```env
  VITE_API_URL=https://darshini-api.example.com
  VITE_WS_URL=wss://darshini-api.example.com
  ```

---

## 5. Local Development Mode

To run Darshini locally without Docker:

### 1. Start Backend API
```bash
cd /home/jyno/Projects/Darshini/backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Start Frontend Dev Server
```bash
cd /home/jyno/Projects/Darshini/frontend
npm run dev -- --host
```

---

## 6. Data Privacy, Video Retention, and Operational Governance

1. **No Persistent Frame Storage:** Client video frames are received via WebSocket into a memory buffer, downsampled to 416px, processed through YOLOv8, and discarded after returning predictions. No camera footage is saved to disk.
2. **Field-of-View Non-Accumulation:** Counts represent instantaneous people visible in the camera field of view at that exact moment. They are never summed across frames.
3. **Zone Mapping Isolation:** A camera assigned to a venue zone updates only that specific zone's live count. Unassigned zones maintain their baseline demonstration status.
4. **Geolocation Confidentiality:** Browser location coordinates remain exclusively in the client's memory to render the "My Location" marker and are never stored in backend databases or shared with external parties.
