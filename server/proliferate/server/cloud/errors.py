"""Domain exception classes for cloud workspace services."""

from __future__ import annotations

from typing import NoReturn

from fastapi import HTTPException


class CloudApiError(RuntimeError):
    """Raised when a cloud workspace operation fails with a client-facing error."""

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def raise_cloud_error(error: CloudApiError) -> NoReturn:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    )
