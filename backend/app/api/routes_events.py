"""
Darshini - Management API Routes for Events, Gate Check-in, and Emergency Alerts
Enforces strict server-side RBAC, transaction-safe operations, and audit recording.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import (
    ROLE_ADMIN,
    ROLE_CHECKIN_OPERATOR,
    ROLE_EVENT_MANAGER,
    get_current_user,
    require_role,
)
from app.schemas_events import (
    AlertCreateRequest,
    AlertDeliveriesResponse,
    AlertDispatchResponse,
    AlertPreviewRequest,
    AlertPreviewResponse,
    AlertResponse,
    CheckinRequest,
    CheckinResponse,
    CheckinReverseRequest,
    CheckinReverseResponse,
    EventCreateRequest,
    EventResponse,
    EventStatusUpdateRequest,
    EventUpdateRequest,
    RegistrationAdminRecord,
)
from app.services.checkin_service import CheckinService
from app.services.event_service import EventService
from app.services.registration_service import RegistrationService
from app.services.sms.alert_service import AlertService

router = APIRouter(prefix="/api/v1/management", tags=["Event Management & Command Center"])


# -------------------------------------------------------------
# Event Lifecycle Endpoints
# -------------------------------------------------------------

@router.post(
    "/events",
    response_model=EventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Event",
    description="Creates a new event with an opaque revocable registration QR code.",
)
async def create_event(
    req: EventCreateRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return EventService.create_event(req, creator_id=user["id"])
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "/events",
    response_model=List[EventResponse],
    summary="List Events",
    description="Lists all events with live registration and check-in tallies.",
)
async def list_events(
    status_filter: Optional[str] = Query(None, alias="status"),
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    return EventService.list_events(status=status_filter)


@router.get(
    "/events/{event_id}",
    response_model=EventResponse,
    summary="Get Event Details",
    description="Returns event metadata, registration URL, and vector QR SVG.",
)
async def get_event(
    event_id: str,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    event = EventService.get_event_by_id(event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    return event


@router.patch(
    "/events/{event_id}",
    response_model=EventResponse,
    summary="Update Event Metadata",
)
async def update_event(
    event_id: str,
    req: EventUpdateRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return EventService.update_event(event_id, req)
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch(
    "/events/{event_id}/status",
    response_model=EventResponse,
    summary="Transition Event Status",
    description="Transitions lifecycle: DRAFT -> PUBLISHED -> CLOSED -> ARCHIVED.",
)
async def update_event_status(
    event_id: str,
    req: EventStatusUpdateRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return EventService.update_event_status(event_id, req.status)
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/events/{event_id}/regenerate-qr",
    response_model=EventResponse,
    summary="Regenerate Registration QR",
    description="Revokes the previous registration QR token and issues a fresh one.",
)
async def regenerate_qr(
    event_id: str,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return EventService.regenerate_qr_token(event_id)
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# -------------------------------------------------------------
# Attendee & Gate Check-in Endpoints
# -------------------------------------------------------------

@router.get(
    "/events/{event_id}/registrations",
    response_model=List[RegistrationAdminRecord],
    summary="List Registrations",
    description="Lists registered attendees with phone numbers safely masked.",
)
async def list_registrations(
    event_id: str,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    return RegistrationService.list_registrations_for_event(event_id)


@router.post(
    "/events/{event_id}/checkin",
    response_model=CheckinResponse,
    summary="Authorized Gate Check-in",
    description="Admits an attendee upon physical pass scan. Enforces exact-event ownership and idempotency.",
)
async def execute_checkin(
    event_id: str,
    req: CheckinRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return CheckinService.checkin_attendee(
            event_id=event_id,
            operator_id=user["id"],
            registration_code=req.registration_code,
            registration_id=req.registration_id,
            gate_terminal=req.gate_terminal,
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "/events/{event_id}/checkins",
    summary="List Active Check-ins",
    description="Lists all verified attendees currently admitted to this event.",
)
async def list_checkins(
    event_id: str,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    return CheckinService.list_checkins_for_event(event_id)


@router.post(
    "/events/{event_id}/checkin/{checkin_id}/reverse",
    response_model=CheckinReverseResponse,
    summary="Reverse Gate Check-in",
    description="Reverses check-in admission. Attendee is immediately removed from future SMS alert snapshots.",
)
async def reverse_checkin(
    event_id: str,
    checkin_id: str,
    req: CheckinReverseRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return CheckinService.reverse_checkin(
            checkin_id=checkin_id,
            reversal_reason=req.reversal_reason,
            reversed_by=user["id"],
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# -------------------------------------------------------------
# Emergency Alert & Targeted SMS Endpoints
# -------------------------------------------------------------

@router.post(
    "/events/{event_id}/alerts/preview",
    response_model=AlertPreviewResponse,
    summary="Preview Recipient Pool",
    description="Calculates exact checked-in recipient pool without queueing or sending alerts.",
)
async def preview_alert_recipients(
    event_id: str,
    req: AlertPreviewRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return AlertService.preview_recipients(event_id, req)
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/events/{event_id}/alerts/compose",
    response_model=AlertResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Compose Emergency Alert",
    description="Creates draft alert. If severity is CRITICAL, sets status to PENDING_APPROVAL.",
)
async def compose_alert(
    event_id: str,
    req: AlertCreateRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return AlertService.compose_alert(event_id, req, creator_id=user["id"])
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "/events/{event_id}/alerts",
    response_model=List[AlertResponse],
    summary="List Event Alerts",
)
async def list_event_alerts(
    event_id: str,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    return AlertService.list_alerts_for_event(event_id)


@router.post(
    "/alerts/{alert_id}/approve",
    response_model=AlertResponse,
    summary="Two-Person Rule Approval",
    description="Approves a critical emergency alert. Approver must be distinct from the alert creator.",
)
async def approve_alert(
    alert_id: str,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return AlertService.approve_alert(alert_id, approver_id=user["id"])
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/alerts/{alert_id}/dispatch",
    response_model=AlertDispatchResponse,
    summary="Dispatch Targeted SMS Alert",
    description="Atomically freezes checked-in recipient pool for the exact event and dispatches via SMS.",
)
async def dispatch_alert(
    alert_id: str,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return AlertService.dispatch_alert(alert_id, dispatcher_id=user["id"])
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "/alerts/{alert_id}/deliveries",
    response_model=AlertDeliveriesResponse,
    summary="Inspect SMS Delivery Outcomes",
    description="Provides real-time delivery telemetry breakdown (queued, accepted, delivered, failed).",
)
async def get_alert_deliveries(
    alert_id: str,
    user: Dict[str, Any] = Depends(require_role(ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    return AlertService.get_alert_deliveries(alert_id)
