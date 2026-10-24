"""
Darshini - SMS Provider Interface
Defines the standard contract for SMS delivery adapters, separating
simulated development environments from real carrier gateways.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class SmsMessage:
    """Represents an emergency alert SMS message payload."""
    recipient_phone_e164: str
    recipient_phone_masked: str
    message_body: str
    idempotency_key: str
    event_id: str
    alert_id: str
    severity: str


@dataclass
class SmsDeliveryResult:
    """Standardized outcome returned by an SMS provider."""
    status: str  # 'QUEUED' | 'PROVIDER_ACCEPTED' | 'DELIVERED' | 'FAILED'
    provider_name: str
    provider_message_id: Optional[str] = None
    error_message: Optional[str] = None
    is_simulated: bool = False


class SmsProviderInterface(ABC):
    """Abstract interface that all Darshini SMS adapters must implement."""

    @abstractmethod
    def send_sms(self, message: SmsMessage) -> SmsDeliveryResult:
        """
        Dispatches a single SMS message through the provider.
        Must be synchronous or thread-safe.
        """
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        """Returns the canonical provider identifier (e.g. 'mock', 'twilio')."""
        pass

    @abstractmethod
    def is_live_carrier(self) -> bool:
        """Returns True only if the provider communicates with a real mobile carrier."""
        pass
