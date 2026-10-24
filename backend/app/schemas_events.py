"""
Darshini - Event Registration, QR Check-in, and SMS Schemas
Pydantic data models for request validation and response serialization.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------
# Authentication Schemas
# ---------------------------------------------------------

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, description="Username for login")
    password: str = Field(..., min_length=6, description="User password")


class UserProfile(BaseModel):
    id: str
    username: str
    full_name: str
    role: str
    is_active: int = 1


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile


class SetupAdminRequest(BaseModel):
    bootstrap_token: str = Field(..., description="One-time secret bootstrap token from .bootstrap_token")
    username: str = Field(..., min_length=3, description="Admin username")
    password: str = Field(..., min_length=8, description="Strong password")
    full_name: str = Field(default="System Administrator", description="Full name of administrator")


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=8)
    full_name: str
    role: str = Field(..., description="ADMIN | EVENT_MANAGER | CHECKIN_OPERATOR")


# ---------------------------------------------------------
# Event Management Schemas
# ---------------------------------------------------------

class EventCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    slug: Optional[str] = Field(None, max_length=80, description="Optional custom URL slug")
    description: str = Field(default="", max_length=2000)
    venue_name: str = Field(..., min_length=2, max_length=120)
    venue_zone_id: Optional[str] = None
    start_time: str = Field(..., description="ISO 8601 string (e.g. 2026-10-24T10:00:00Z)")
    end_time: str = Field(..., description="ISO 8601 string (e.g. 2026-10-24T18:00:00Z)")
    max_capacity: int = Field(default=0, ge=0, description="0 = unlimited capacity")


class EventUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    venue_name: Optional[str] = Field(None, min_length=2, max_length=120)
    venue_zone_id: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    max_capacity: Optional[int] = Field(None, ge=0)


class EventStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="DRAFT | PUBLISHED | CLOSED | ARCHIVED")


class EventResponse(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    venue_name: str
    venue_zone_id: Optional[str] = None
    start_time: str
    end_time: str
    max_capacity: int
    status: str
    qr_token: str
    registration_url: str
    qr_svg: Optional[str] = None
    created_by: str
    created_at: str
    registered_count: int = 0
    checked_in_count: int = 0


class PublicEventResponse(BaseModel):
    event_id: str
    slug: str
    name: str
    description: str
    venue_name: str
    start_time: str
    end_time: str
    status: str
    is_full: bool = False


# ---------------------------------------------------------
# Public Registration Schemas
# ---------------------------------------------------------

class PublicRegistrationRequest(BaseModel):
    attendee_name: str = Field(..., min_length=2, max_length=100)
    phone_number: str = Field(..., min_length=8, max_length=20)
    opt_out_sms: bool = False
    website_url: Optional[str] = Field(None, description="Honeypot field for bot trapping; must remain empty")


class PublicRegistrationResponse(BaseModel):
    registration_code: str
    attendee_name: str
    phone_masked: str
    event_name: str
    venue_name: str
    registered_at: str
    pass_qr_svg: str
    pass_url: str


class RegistrationAdminRecord(BaseModel):
    id: str
    event_id: str
    attendee_name: str
    phone_masked: str
    registration_code: str
    status: str
    opt_out_sms: int
    registered_at: str


# ---------------------------------------------------------
# Gate Check-in Schemas
# ---------------------------------------------------------

class CheckinRequest(BaseModel):
    registration_code: Optional[str] = Field(None, description="Alphanumeric pass code (e.g. REG-ABC12345)")
    registration_id: Optional[str] = Field(None, description="Internal registration UUID")
    gate_terminal: str = Field(default="GATE_1", max_length=50)


class CheckinResponse(BaseModel):
    checkin_id: str
    registration_id: str
    attendee_name: str
    event_id: str
    event_name: str
    status: str
    checked_in_at: str
    operator_name: str
    gate_terminal: str


class CheckinReverseRequest(BaseModel):
    reversal_reason: str = Field(..., min_length=3, max_length=500)


class CheckinReverseResponse(BaseModel):
    checkin_id: str
    status: str
    reversal_reason: str
    reversed_at: str


# ---------------------------------------------------------
# Alert & SMS Pipeline Schemas
# ---------------------------------------------------------

class AlertPreviewRequest(BaseModel):
    message_body: str = Field(..., min_length=5, max_length=1000)
    severity: str = Field(..., description="INFO | WARNING | CRITICAL")


class AlertPreviewResponse(BaseModel):
    event_id: str
    event_name: str
    currently_checked_in: int
    eligible_recipients: int
    opted_out_count: int
    already_alerted_count: int
    estimated_sms_segments: int


class AlertCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    message_body: str = Field(..., min_length=5, max_length=1000)
    severity: str = Field(..., description="INFO | WARNING | CRITICAL")
    alert_category: str = Field(default="SAFETY", description="SAFETY | EVACUATION | WEATHER | OPERATIONAL")


class AlertResponse(BaseModel):
    id: str
    event_id: str
    title: str
    message_body: str
    severity: str
    alert_category: str
    lifecycle_status: str
    created_by: str
    approved_by: Optional[str] = None
    created_at: str
    dispatched_at: Optional[str] = None
    completed_at: Optional[str] = None
    eligible_recipient_count: int = 0


class AlertDispatchResponse(BaseModel):
    alert_id: str
    event_id: str
    lifecycle_status: str
    eligible_recipients_queued: int
    provider: str
    is_simulated: bool
    dispatched_at: str


class DeliverySummary(BaseModel):
    queued: int
    accepted: int
    delivered: int
    failed: int
    unknown: int


class DeliveryRecord(BaseModel):
    id: str
    recipient_phone_masked: str
    status: str
    provider_name: str
    provider_message_id: Optional[str] = None
    attempt_count: int
    last_error: Optional[str] = None
    sent_at: Optional[str] = None
    delivered_at: Optional[str] = None


class AlertDeliveriesResponse(BaseModel):
    alert_id: str
    summary: DeliverySummary
    deliveries: List[DeliveryRecord]
