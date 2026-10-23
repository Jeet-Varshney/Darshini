"""
CrowdFlow Sentinel - Backend Configuration
Configuration parameters for computer-vision inference and API services.
"""

import os
from pathlib import Path

# Base paths
BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
WEIGHTS_DIR = BACKEND_DIR / "weights"
TEMP_UPLOAD_DIR = BACKEND_DIR / "temp_uploads"

# Ensure directories exist
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Model configuration
DEFAULT_WEIGHTS_FILE = WEIGHTS_DIR / "yolov8n.pt"
MODEL_PATH = Path(os.getenv("MODEL_PATH", str(DEFAULT_WEIGHTS_FILE)))
MODEL_NAME = "YOLOv8n (Pretrained COCO Nano)"
PERSON_CLASS_ID = 0  # Class 0 in COCO 80-class taxonomy is "person"

# Video upload and processing constraints
MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
DEFAULT_CONF_THRESHOLD = 0.25
DEFAULT_SAMPLE_FPS = 1.0  # Sample 1 frame per second to keep CPU inference fast
MAX_FRAMES_TO_PROCESS = 60  # Maximum frames sampled per video upload to protect CPU

# Preview generation
PREVIEW_MAX_WIDTH = 960
PREVIEW_JPEG_QUALITY = 85
