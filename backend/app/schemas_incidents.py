"""
Darshini - Safety Incident Management & Reporting Schemas
Pydantic data models for incident lifecycle, status transitions, timeline audit, and analytics.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class IncidentCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=150)
    description: str = Field(default="", max_length=3000)
    severity: str = Field(..., description="CRITICAL | WARNING | ADVISORY | INFO")
    category: str = Field(..., description="CROWD_DENSITY | PERIMETER_BREACH | MEDICAL | FIRE_HAZARD | INFRASTRUCTURE | LOST_PERSON | OPERATIONAL")
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    camera_id: Optional[str] = None
    event_id: Optional[str] = None
    related_edge_id: Optional[str] = None
    source: str = Field(default="OPERATOR_REPORTED", description="OPERATOR_REPORTED | CAMERA_ASSISTED | SIMULATION_TRIGGERED")


class IncidentUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=3, max_length=150)
    description: Optional[str] = Field(None, max_length=3000)
    severity: Optional[str] = None
    category: Optional[str] = None
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None


class IncidentStatusTransitionRequest(BaseModel):
    status: str = Field(..., description="OPEN | ACKNOWLEDGED | IN_PROGRESS | RESOLVED | CLOSED")
    note: Optional[str] = Field(None, max_length=1000, description="Audit note documenting operational action taken")


class IncidentAddNoteRequest(BaseModel):
    note: str = Field(..., min_length=2, max_length=1000)


class IncidentAssignRequest(BaseModel):
    assigned_to: str = Field(..., min_length=2, max_length=100, description="Operator user ID or username")
    assigned_to_name: Optional[str] = Field(None, max_length=150, description="Full name or display title")
    note: Optional[str] = Field(None, max_length=1000, description="Assignment rationale or dispatch tasking")


class IncidentHistoryRecord(BaseModel):
    id: str
    incident_id: str
    action: str
    previous_status: Optional[str] = None
    new_status: Optional[str] = None
    operator_id: Optional[str] = None
    operator_username: Optional[str] = None
    note: Optional[str] = None
    timestamp: str


class IncidentRecord(BaseModel):
    id: str
    incident_number: str
    title: str
    description: str
    severity: str
    category: str
    status: str
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    camera_id: Optional[str] = None
    event_id: Optional[str] = None
    related_edge_id: Optional[str] = None
    source: str
    reported_by: str
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None
    created_at: str
    updated_at: str
    resolved_at: Optional[str] = None
    closed_at: Optional[str] = None
    history: Optional[List[IncidentHistoryRecord]] = None


class IncidentSummaryMetrics(BaseModel):
    total_incidents: int
    active_incidents: int  # OPEN, ACKNOWLEDGED, IN_PROGRESS
    resolved_incidents: int  # RESOLVED, CLOSED
    severity_breakdown: Dict[str, int]
    category_breakdown: Dict[str, int]
    status_breakdown: Dict[str, int]
    avg_resolution_time_minutes: Optional[float] = None
    disclaimer: str = "DERIVED FROM PERSISTENT INCIDENT AUDIT REGISTER"
