"""
Darshini - Backend Configuration
Configuration parameters for computer-vision inference and API services.
"""

import os
from pathlib import Path

# Base paths
BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
WEIGHTS_DIR = BACKEND_DIR / "weights"
TEMP_UPLOAD_DIR = BACKEND_DIR / "temp_uploads"
DATA_DIR = BACKEND_DIR / "app" / "data"

# Ensure directories exist
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

# SQLite persistence configuration
DATABASE_PATH = Path(os.getenv("DARSHINI_DB_PATH", str(DATA_DIR / "darshini.db")))
DETECTION_HISTORY_MAX_RECORDS = int(os.getenv("DETECTION_HISTORY_MAX_RECORDS", "1000"))
DETECTION_HISTORY_MIN_INTERVAL_SEC = float(os.getenv("DETECTION_HISTORY_MIN_INTERVAL_SEC", "2.0"))

# Model configuration
DEFAULT_WEIGHTS_FILE = WEIGHTS_DIR / "yolov8n.pt"
MODEL_PATH = Path(os.getenv("MODEL_PATH", str(DEFAULT_WEIGHTS_FILE)))
if not MODEL_PATH.exists() and (BACKEND_DIR / MODEL_PATH).exists():
    MODEL_PATH = BACKEND_DIR / MODEL_PATH
MODEL_NAME = "YOLOv8n (Pretrained COCO Nano)"
PERSON_CLASS_ID = 0  # Class 0 in COCO 80-class taxonomy is "person"

# Video upload and processing constraints
MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
DEFAULT_CONF_THRESHOLD = 0.25
DEFAULT_SAMPLE_FPS = 1.0  # Sample 1 frame per second to keep CPU inference fast
MAX_FRAMES_TO_PROCESS = 60  # Maximum frames sampled per video upload to protect CPU

# Inference and streaming optimization
DEFAULT_INFERENCE_IMGSZ = 640  # Full-resolution inference (640x640) for high recall on stationary and distant persons
LIVE_CAPTURE_TARGET_WIDTH = 640
LIVE_CAPTURE_TARGET_HEIGHT = 480
LIVE_STREAM_TARGET_FPS = 20  # Smooth UI preview rate

# Preview generation
PREVIEW_MAX_WIDTH = 640  # Downscale preview to 640px wide (~4-6 KB per frame)
PREVIEW_JPEG_QUALITY = 75  # Optimal visual fidelity with 4x smaller payload than 85

# Authentication and Security configuration
JWT_SECRET_FILE = DATA_DIR / ".jwt_secret"
def _get_or_create_jwt_secret() -> str:
    env_secret = os.getenv("JWT_SECRET_KEY")
    if env_secret:
        return env_secret
    if JWT_SECRET_FILE.exists():
        try:
            return JWT_SECRET_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    import secrets
    new_secret = secrets.token_hex(32)
    try:
        JWT_SECRET_FILE.write_text(new_secret, encoding="utf-8")
        JWT_SECRET_FILE.chmod(0o600)
    except Exception:
        pass
    return new_secret

JWT_SECRET_KEY = _get_or_create_jwt_secret()
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

# SMS Provider configuration
SMS_PROVIDER = os.getenv("SMS_PROVIDER", "mock").lower()  # "mock" | "twilio" | "generic_dlt"
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:5173").rstrip("/")
