from __future__ import annotations

from typing import ClassVar

from proliferate.errors import InvalidRequest, ProliferateError


class SupportFeedUnauthorized(ProliferateError):
    code = "support_feed_unauthorized"
    status_code = 401
    headers: ClassVar[dict[str, str]] = {"WWW-Authenticate": "Bearer"}

    def __init__(self) -> None:
        super().__init__("A valid support feed bearer key is required.")


class SupportFeedInvalidCursor(InvalidRequest):
    code = "support_feed_invalid_cursor"

    def __init__(self) -> None:
        super().__init__("The support feed cursor is invalid.")
