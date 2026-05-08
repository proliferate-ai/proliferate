"""Error types for the AnyHarness runtime integration."""

from __future__ import annotations


class CloudRuntimeReconnectError(RuntimeError):
    """Raised when a persistent sandbox cannot be reused safely."""


class CloudRuntimeRequestRejectedError(CloudRuntimeReconnectError):
    """Runtime definitively rejected a session API request."""


class CloudRuntimePromptDeliveryUncertainError(CloudRuntimeReconnectError):
    """Prompt request was sent but the delivery outcome is unknown."""


class CloudRuntimeOperationError(RuntimeError):
    """Raised when a runtime-backed file or setup operation fails."""
