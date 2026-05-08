from __future__ import annotations

from proliferate.errors import ProliferateError


class AutomationServiceError(ProliferateError):
    """Raised when an automation operation fails with a client-facing error."""

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message=message, code=code, status_code=status_code)
