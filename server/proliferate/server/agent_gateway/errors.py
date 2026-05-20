"""Product errors for the agent model gateway."""

from __future__ import annotations

from proliferate.errors import ProliferateError


class AgentGatewayError(ProliferateError):
    """Stable gateway error returned to harness protocol clients."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        status_code: int,
    ) -> None:
        super().__init__(message, code=code, status_code=status_code)
