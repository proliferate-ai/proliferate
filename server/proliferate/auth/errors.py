"""Typed product errors for authentication flows."""

from __future__ import annotations

from collections.abc import Mapping

from proliferate.errors import ProliferateError


class AuthFlowError(ProliferateError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message=message, code=code, status_code=status_code)
        self.headers: dict[str, str] = dict(headers or {})
