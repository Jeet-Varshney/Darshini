"""
Darshini - Incident Management & Operational Reporting API Routes
Endpoints for reporting safety incidents, tracking status transitions, analytics, and CSV exports.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.auth import (
    ROLE_ADMIN,
    ROLE_CHECKIN_OPERATOR,
    ROLE_EVENT_MANAGER,
    get_current_user,
    require_role,
)
from app.schemas_incidents import (
    IncidentAddNoteRequest,
    IncidentAssignRequest,
    IncidentCreateRequest,
    IncidentRecord,
    IncidentStatusTransitionRequest,
    IncidentSummaryMetrics,
)
from app.services.incident_service import IncidentService

router = APIRouter(prefix="/api/v1/incidents", tags=["Safety Incidents & Operational Reports"])


@router.get(
    "/analytics/summary",
    response_model=IncidentSummaryMetrics,
    summary="Incident Summary Metrics",
    description="Returns aggregate KPI counts derived directly from persistent database records.",
)
async def get_summary_metrics(
    start_time: Optional[str] = Query(None, description="ISO timestamp start filter"),
    end_time: Optional[str] = Query(None, description="ISO timestamp end filter"),
):
    return IncidentService.get_summary_metrics(start_time=start_time, end_time=end_time)


@router.get(
    "/export/csv",
    summary="Export Filtered Incidents to CSV",
    description="Generates a downloadable CSV with CWE-1236 Formula Injection sanitization.",
)
async def export_incidents_csv(
    status_filter: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    csv_data = IncidentService.export_csv(
        status=status_filter,
        severity=severity,
        category=category,
        source=source,
        start_time=start_time,
        end_time=end_time,
        search=search,
    )
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=darshini_incidents_audit_report.csv",
        },
    )


@router.get(
    "",
    response_model=List[IncidentRecord],
    summary="List Safety Incidents",
    description="Retrieves chronological incidents register with optional filtering by status, severity, category, source, or time range.",
)
async def list_incidents(
    status_filter: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    zone_id: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    return IncidentService.list_incidents(
        status=status_filter,
        severity=severity,
        category=category,
        zone_id=zone_id,
        source=source,
        start_time=start_time,
        end_time=end_time,
        search=search,
    )


@router.post(
    "",
    response_model=IncidentRecord,
    status_code=status.HTTP_201_CREATED,
    summary="Report New Safety Incident",
    description="Logs a new safety incident into the operational audit register.",
)
async def create_incident(
    req: IncidentCreateRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return IncidentService.create_incident(
            data=req,
            reported_by=user["username"],
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "/{incident_id}",
    response_model=IncidentRecord,
    summary="Get Incident Details & History",
    description="Returns detailed incident record including its complete chronological audit timeline.",
)
async def get_incident(incident_id: str):
    inc = IncidentService.get_incident_by_id(incident_id)
    if not inc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found.")
    return inc


@router.patch(
    "/{incident_id}/status",
    response_model=IncidentRecord,
    summary="Transition Incident Status",
    description="Updates lifecycle state (OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED) and logs action.",
)
async def transition_incident_status(
    incident_id: str,
    req: IncidentStatusTransitionRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return IncidentService.transition_status(
            incident_id=incident_id,
            new_status=req.status,
            operator_username=user["username"],
            operator_id=user["id"],
            note=req.note,
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/{incident_id}/notes",
    response_model=IncidentRecord,
    summary="Add Operator Note to Incident",
    description="Appends an operational note to the incident timeline.",
)
async def add_incident_note(
    incident_id: str,
    req: IncidentAddNoteRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return IncidentService.add_operator_note(
            incident_id=incident_id,
            note=req.note,
            operator_username=user["username"],
            operator_id=user["id"],
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.patch(
    "/{incident_id}/assign",
    response_model=IncidentRecord,
    summary="Assign Incident Responsibility",
    description="Assigns or reassigns an incident to an operator/staff and appends an audit event to the timeline.",
)
async def assign_incident(
    incident_id: str,
    req: IncidentAssignRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return IncidentService.assign_incident(
            incident_id=incident_id,
            assigned_to=req.assigned_to,
            assigned_to_name=req.assigned_to_name,
            operator_username=user["username"],
            operator_id=user["id"],
            note=req.note,
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
