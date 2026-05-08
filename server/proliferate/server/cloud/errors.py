"""Domain exception classes for cloud workspace services."""

from __future__ import annotations

from typing import NoReturn

from fastapi import HTTPException

from proliferate.errors import ProliferateError


class CloudApiError(ProliferateError):
    """Raised when a cloud workspace operation fails with a client-facing error."""

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message=message, code=code, status_code=status_code)


def raise_cloud_error(error: CloudApiError) -> NoReturn:
    """Transitional route helper for cloud APIs that have not migrated yet."""

    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    )
