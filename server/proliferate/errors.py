from __future__ import annotations

from typing import ClassVar


class ProliferateError(Exception):
    code: ClassVar[str] = "internal_error"
    status_code: ClassVar[int] = 500

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


class NotFoundError(ProliferateError):
    code = "not_found"
    status_code = 404


class PermissionDenied(ProliferateError):
    code = "permission_denied"
    status_code = 403


class Conflict(ProliferateError):
    code = "conflict"
    status_code = 409


class InvalidRequest(ProliferateError):
    code = "invalid_request"
    status_code = 400
