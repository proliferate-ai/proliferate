"""Bifrost integration errors."""

from __future__ import annotations


class BifrostIntegrationError(Exception):
    """Raised when the Bifrost control plane rejects or cannot process a request."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
