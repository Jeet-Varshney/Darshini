"""
Darshini - Public Attendee API Routes
Unauthenticated endpoints for event details, visitor registration, and digital pass inspection.
"""

from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Request, status

from app.schemas_events import (
    PublicEventResponse,
    PublicRegistrationRequest,
    PublicRegistrationResponse,
)
from app.services.event_service import EventService
from app.services.registration_service import RegistrationService

router = APIRouter(prefix="/api/v1/public", tags=["Public Attendee Services"])


@router.get(
    "/events/{slug_or_token}",
    response_model=PublicEventResponse,
    summary="Get Published Event Info",
    description="Returns public event briefing and capacity status. Rejects drafts or archived events.",
)
async def get_public_event(slug_or_token: str):
    # Lookup by slug or by QR token
    event = EventService.get_event_by_slug(slug_or_token)
    if not event:
        event = EventService.get_event_by_qr_token(slug_or_token)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    if event["status"] != "PUBLISHED":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=f"This event is currently {event['status']} and is not accepting registrations.",
        )

    is_full = event["max_capacity"] > 0 and event["registered_count"] >= event["max_capacity"]

    return {
        "event_id": event["id"],
        "slug": event["slug"],
        "name": event["name"],
        "description": event["description"],
        "venue_name": event["venue_name"],
        "start_time": event["start_time"],
        "end_time": event["end_time"],
        "status": event["status"],
        "is_full": is_full,
    }


@router.post(
    "/events/{slug}/register",
    response_model=PublicRegistrationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register for Event",
    description="Submits attendee registration with E.164 phone normalization, spam trap, and pass generation.",
)
async def register_attendee(slug: str, req: PublicRegistrationRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"

    try:
        return RegistrationService.register_attendee(
            event_slug_or_id=slug,
            data=req,
            client_ip=client_ip,
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "/pass/{registration_code}",
    summary="Get Registration Pass",
    description="Retrieves attendee pass details and verification QR code. Phone numbers remain masked.",
)
async def get_pass(registration_code: str):
    pass_data = RegistrationService.get_registration_by_code(registration_code)
    if not pass_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registration pass not found.")

    return pass_data
