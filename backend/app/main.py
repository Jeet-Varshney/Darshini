"""
CrowdFlow Sentinel - Main FastAPI Application
Entry point for the backend server with CORS, model initialization, and routing.
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.services.model_service import model_service

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("crowdflow.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes the computer-vision model on application startup."""
    logger.info("Initializing CrowdFlow Sentinel Backend API...")
    success = model_service.initialize()
    if success:
        logger.info("Pretrained detection model is ready for inference.")
    else:
        logger.warning("Model initialization deferred or weights unavailable: %s", model_service.error_message)
    yield
    logger.info("Shutting down CrowdFlow Sentinel Backend API and releasing camera devices...")
    try:
        from app.services.camera_stream import live_camera_manager
        live_camera_manager.stop()
    except Exception as e:
        logger.debug("Error releasing camera on shutdown: %s", e)


app = FastAPI(
    title="CrowdFlow Sentinel API",
    description="Operational Command Center API with real computer-vision person detection pipeline.",
    version="0.2.0",
    lifespan=lifespan,
)

# Enable CORS for frontend development and previews
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
        "*",  # Allow broad local access for hackathon evaluations
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
app.include_router(router)


@app.get("/", summary="API Root", description="Provides basic service identification and docs link.")
async def root():
    return {
        "service": "CrowdFlow Sentinel Backend",
        "version": "0.2.0",
        "docs": "/docs",
        "health": "/health",
        "model_ready": model_service.is_ready,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
