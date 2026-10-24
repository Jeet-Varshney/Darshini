"""
Darshini - Twilio SMS Provider Adapter
Provides live carrier SMS integration via Twilio REST API.
Enforces strict credential validation and never claims live delivery without real provider acceptance.
"""

import base64
import json
import logging
import urllib.parse
import urllib.request
from typing import Optional

from app.config import TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
from app.services.sms.provider_interface import (
    SmsDeliveryResult,
    SmsMessage,
    SmsProviderInterface,
)

logger = logging.getLogger("darshini.sms.twilio")


class TwilioSmsProvider(SmsProviderInterface):
    """Production carrier gateway adapter for Twilio."""

    def __init__(
        self,
        account_sid: Optional[str] = None,
        auth_token: Optional[str] = None,
        from_number: Optional[str] = None,
    ):
        self.account_sid = account_sid or TWILIO_ACCOUNT_SID
        self.auth_token = auth_token or TWILIO_AUTH_TOKEN
        self.from_number = from_number or TWILIO_FROM_NUMBER

    def get_provider_name(self) -> str:
        return "twilio"

    def is_live_carrier(self) -> bool:
        return True

    def is_configured(self) -> bool:
        """Verifies all required Twilio credentials are non-empty."""
        return bool(self.account_sid and self.auth_token and self.from_number)

    def send_sms(self, message: SmsMessage) -> SmsDeliveryResult:
        """
        Submits SMS to Twilio REST API.
        Never fabricates delivery: if credentials are missing or API fails, records FAILED.
        """
        if not self.is_configured():
            err_msg = "Twilio credentials missing. Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER."
            logger.error("[TWILIO SMS ERROR] Cannot dispatch alert %s: %s", message.alert_id, err_msg)
            return SmsDeliveryResult(
                status="FAILED",
                provider_name="twilio",
                error_message=err_msg,
                is_simulated=False,
            )

        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        form_data = {
            "To": message.recipient_phone_e164,
            "From": self.from_number,
            "Body": message.message_body,
        }
        encoded_data = urllib.parse.urlencode(form_data).encode("utf-8")

        auth_str = f"{self.account_sid}:{self.auth_token}"
        auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")

        req = urllib.request.Request(
            url,
            data=encoded_data,
            headers={
                "Authorization": f"Basic {auth_b64}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=10.0) as response:
                resp_bytes = response.read()
                data = json.loads(resp_bytes.decode("utf-8"))
                sid = data.get("sid")
                status = data.get("status", "queued")

                logger.info(
                    "[TWILIO LIVE SMS ACCEPTED] Alert %s -> %s | Twilio SID: %s | Status: %s",
                    message.alert_id,
                    message.recipient_phone_masked,
                    sid,
                    status,
                )

                return SmsDeliveryResult(
                    status="PROVIDER_ACCEPTED",
                    provider_name="twilio",
                    provider_message_id=sid,
                    is_simulated=False,
                )
        except Exception as e:
            err_msg = f"Twilio API request failed: {e}"
            logger.error("[TWILIO SMS FAILURE] Alert %s -> %s: %s", message.alert_id, message.recipient_phone_masked, err_msg)
            return SmsDeliveryResult(
                status="FAILED",
                provider_name="twilio",
                error_message=err_msg,
                is_simulated=False,
            )
