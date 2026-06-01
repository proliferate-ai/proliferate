"""Error types for the Stripe integration."""

from __future__ import annotations


class StripeIntegrationError(RuntimeError):
    """Raised on failures talking to or verifying Stripe."""

    def __init__(self, code: str, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


StripeBillingError = StripeIntegrationError
