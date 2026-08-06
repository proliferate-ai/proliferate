"""Domain exception classes for cloud workspace services."""

from __future__ import annotations

from collections.abc import Mapping

from proliferate.errors import ProliferateError


class CloudApiError(ProliferateError):
    """Raised when a cloud workspace operation fails with a client-facing error."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        extra_detail: Mapping[str, object] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message=message, code=code, status_code=status_code)
        self.extra_detail = dict(extra_detail or {})
        self.headers = dict(headers or {})
