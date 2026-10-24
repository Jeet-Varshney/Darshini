"""
Darshini - SMS Provider Delivery Status Webhook
Receives asynchronous delivery reports from external telecom gateways.
"""

import logging
from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Request, status

from app.services.sms.alert_service import AlertService

logger = logging.getLogger("darshini.webhooks")

router = APIRouter(prefix="/api/v1/webhooks", tags=["Carrier Webhooks"])


@router.post(
    "/sms/{provider}",
    summary="Carrier Delivery Callback",
    description="Processes asynchronous SMS delivery status updates from carrier gateways.",
)
async def sms_delivery_webhook(provider: str, request: Request):
    try:
        # Support both form data (Twilio standard) and JSON payloads
        content_type = request.headers.get("content-type", "")
        if "application/x-www-form-urlencoded" in content_type:
            form = await request.form()
            payload = dict(form)
        else:
            payload = await request.json()
    except Exception:
        payload = {}

    logger.info("Received SMS delivery webhook from provider '%s': %s", provider, payload)

    # Standardize provider message ID and status
    message_id = payload.get("MessageSid") or payload.get("message_id") or payload.get("id")
    raw_status = (payload.get("MessageStatus") or payload.get("status") or "").lower()

    if not message_id:
        return {"status": "ignored", "reason": "No message identifier present"}

    # Map carrier status to Darshini delivery status
    status_map = {
        "delivered": "DELIVERED",
        "failed": "FAILED",
        "undelivered": "FAILED",
        "sent": "PROVIDER_ACCEPTED",
        "queued": "QUEUED",
    }
    normalized_status = status_map.get(raw_status, "UNKNOWN")
    error_msg = payload.get("ErrorMessage") or payload.get("error")

    updated = AlertService.handle_webhook_status_update(
        provider_name=provider,
        provider_message_id=message_id,
        new_status=normalized_status,
        error_message=error_msg,
    )

    return {"status": "processed", "matched": updated, "delivery_status": normalized_status}
