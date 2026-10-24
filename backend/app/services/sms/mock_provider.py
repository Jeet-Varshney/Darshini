"""
Darshini - Mock SMS Development Provider
Simulates cellular SMS delivery for local testing, demonstrations, and staging.
Strictly labelled: SIMULATED — NO REAL SMS SENT.
"""

import logging
import secrets
import time
from typing import Any, Dict, List

from app.services.sms.provider_interface import (
    SmsDeliveryResult,
    SmsMessage,
    SmsProviderInterface,
)

logger = logging.getLogger("darshini.sms.mock")


class MockSmsProvider(SmsProviderInterface):
    """
    Simulated SMS gateway adapter.
    Explicitly tags all dispatches as simulated and logs activity for audit inspection.
    """

    def __init__(self, failure_rate: float = 0.0):
        self.failure_rate = max(0.0, min(1.0, failure_rate))
        self.sent_log: List[Dict[str, Any]] = []

    def get_provider_name(self) -> str:
        return "mock"

    def is_live_carrier(self) -> bool:
        return False

    def send_sms(self, message: SmsMessage) -> SmsDeliveryResult:
        """
        Simulates carrier transmission.
        Produces realistic provider message IDs and logs transmission.
        """
        mock_msg_id = f"SM_MOCK_{secrets.token_hex(8)}"
        now_ts = time.time()

        # Simulate rare carrier drop if failure_rate configured
        if self.failure_rate > 0 and secrets.randbelow(100) < int(self.failure_rate * 100):
            err = "Simulated carrier routing failure (Handset unreachable)"
            logger.warning(
                "[SIMULATED SMS FAILURE] Alert: %s -> %s | Body: '%.30s...' | Reason: %s",
                message.alert_id,
                message.recipient_phone_masked,
                message.message_body,
                err,
            )
            return SmsDeliveryResult(
                status="FAILED",
                provider_name="mock",
                provider_message_id=mock_msg_id,
                error_message=err,
                is_simulated=True,
            )

        # Log simulated dispatch
        logger.info(
            "[SIMULATED — NO REAL SMS SENT] Alert: %s -> %s | %s chars | Body: '%.40s...' | ID: %s",
            message.alert_id,
            message.recipient_phone_masked,
            len(message.message_body),
            message.message_body,
            mock_msg_id,
        )

        entry = {
            "mock_message_id": mock_msg_id,
            "recipient_masked": message.recipient_phone_masked,
            "event_id": message.event_id,
            "alert_id": message.alert_id,
            "severity": message.severity,
            "timestamp": now_ts,
            "is_simulated": True,
        }
        self.sent_log.append(entry)

        return SmsDeliveryResult(
            status="PROVIDER_ACCEPTED",
            provider_name="mock",
            provider_message_id=mock_msg_id,
            is_simulated=True,
        )

    def get_sent_log(self) -> List[Dict[str, Any]]:
        """Returns the in-memory log of simulated messages for testing."""
        return list(self.sent_log)

    def clear_log(self) -> None:
        """Clears the in-memory test log."""
        self.sent_log.clear()
