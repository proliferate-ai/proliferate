"""Error types for the LiteLLM integration."""

from __future__ import annotations


class LiteLLMIntegrationError(RuntimeError):
    """Raised on failures talking to the LiteLLM proxy admin API."""

    def __init__(self, code: str, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
