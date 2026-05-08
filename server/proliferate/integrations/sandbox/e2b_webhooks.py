"""E2B webhook integration helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
from typing import Literal

from proliferate.config import settings

type E2BWebhookSignatureFailureReason = Literal[
    "unconfigured",
    "missing_signature",
    "invalid_signature",
]


class E2BWebhookSignatureError(RuntimeError):
    def __init__(self, reason: E2BWebhookSignatureFailureReason, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


def verify_e2b_webhook_signature(raw_body: bytes, signature: str | None) -> None:
    secret = settings.e2b_webhook_signature_secret.strip()
    if not secret:
        raise E2BWebhookSignatureError(
            "unconfigured",
            "E2B webhook verification is not configured.",
        )
    if not signature:
        raise E2BWebhookSignatureError(
            "missing_signature",
            "E2B webhook signature is required.",
        )

    digest = hashlib.sha256(secret.encode("utf-8") + raw_body).digest()
    expected = base64.b64encode(digest).decode("utf-8").rstrip("=")
    legacy_expected = expected.replace("+", "-").replace("/", "_")
    if not any(
        hmac.compare_digest(signature, expected_signature)
        for expected_signature in {expected, legacy_expected}
    ):
        raise E2BWebhookSignatureError(
            "invalid_signature",
            "E2B webhook signature is invalid.",
        )
