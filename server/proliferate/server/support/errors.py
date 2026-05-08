from __future__ import annotations

from proliferate.errors import InvalidRequest, ProliferateError


class SupportUnavailable(ProliferateError):
    code = "support_unavailable"
    status_code = 503

    def __init__(self) -> None:
        super().__init__("Support messaging is not configured for this environment.")


class SupportMessageEmpty(InvalidRequest):
    code = "support_message_empty"

    def __init__(self) -> None:
        super().__init__("Support message cannot be empty.")


class SupportDeliveryFailed(ProliferateError):
    code = "support_delivery_failed"
    status_code = 502

    def __init__(self) -> None:
        super().__init__("Support message could not be delivered.")
