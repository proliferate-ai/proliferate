from __future__ import annotations

from proliferate.errors import ProliferateError


class OrganizationServiceError(ProliferateError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        extra_detail: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message=message, code=code, status_code=status_code)
        self.extra_detail = dict(extra_detail or {})
