"""SSO integration errors."""

from __future__ import annotations


class SsoIntegrationError(Exception):
    """Protocol or provider failure from an SSO integration."""

    def __init__(self, detail: str, *, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
