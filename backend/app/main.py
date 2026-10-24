"""
Darshini - Main FastAPI Application
Entry point for the backend server with CORS, model initialization, and routing.
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as camera_router
from app.api.routes_simulation import router as simulation_router
from app.api.routes_auth import router as auth_router
from app.api.routes_events import router as events_router
from app.api.routes_public import router as public_router
from app.api.routes_webhooks import router as webhooks_router
from app.api.routes_routing import router as routing_router
from app.api.routes_incidents import router as incidents_router
from app.db.migrations import run_migrations
from app.services.model_service import model_service
from app.services.user_service import UserService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("darshini.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes database schema, admin bootstrap, and computer-vision model on application startup."""
    logger.info("Initializing Darshini Backend API...")
    try:
        run_migrations()
        UserService.bootstrap_admin_if_needed()
    except Exception as e:
        logger.error("Failed during database migration or bootstrap: %s", e)

    success = model_service.initialize()
    if success:
        logger.info("Pretrained detection model is ready for inference.")
    else:
        logger.warning("Model initialization deferred or weights unavailable: %s", model_service.error_message)
    yield
    logger.info("Shutting down Darshini Backend API and releasing camera devices...")
    try:
        from app.services.camera_stream import live_camera_manager
        live_camera_manager.stop()
    except Exception as e:
        logger.debug("Error releasing camera on shutdown: %s", e)


app = FastAPI(
    title="Darshini API",
    description="Operational Command Center API with real computer-vision person detection pipeline, event management, and emergency SMS alert dispatch.",
    version="0.4.0",
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
app.include_router(camera_router)
app.include_router(simulation_router)
app.include_router(auth_router)
app.include_router(events_router)
app.include_router(public_router)
app.include_router(webhooks_router)
app.include_router(routing_router)
app.include_router(incidents_router)


@app.get("/", summary="API Root", description="Provides basic service identification and docs link.")
async def root():
    return {
        "service": "Darshini Backend",
        "version": "0.3.0",
        "docs": "/docs",
        "health": "/health",
        "model_ready": model_service.is_ready,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
