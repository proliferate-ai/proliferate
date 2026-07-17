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


class WorkflowRuntimeError(RuntimeError):
    """Closed, secret-safe failure from a managed Workflow runtime request."""

    def __init__(
        self,
        code: str,
        *,
        retryable: bool = False,
        authentication: bool = False,
        not_found: bool = False,
    ) -> None:
        super().__init__("Managed Workflow runtime operation failed.")
        self.code = code[:128]
        self.retryable = retryable
        self.authentication = authentication
        self.not_found = not_found
