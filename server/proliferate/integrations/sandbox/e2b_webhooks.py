"""E2B webhook integration helpers."""

from __future__ import annotations

import base64
import hashlib

from proliferate.config import settings


class E2BWebhookSignatureError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def verify_e2b_webhook_signature(raw_body: bytes, signature: str | None) -> None:
    secret = settings.e2b_webhook_signature_secret.strip()
    if not secret:
        raise E2BWebhookSignatureError(
            "webhook_unavailable",
            "E2B webhook verification is not configured.",
            status_code=503,
        )
    if not signature:
        raise E2BWebhookSignatureError(
            "invalid_webhook_signature",
            "E2B webhook signature is required.",
            status_code=401,
        )

    digest = hashlib.sha256(secret.encode("utf-8") + raw_body).digest()
    expected = base64.b64encode(digest).decode("utf-8").rstrip("=")
    legacy_expected = expected.replace("+", "-").replace("/", "_")
    if signature not in {expected, legacy_expected}:
        raise E2BWebhookSignatureError(
            "invalid_webhook_signature",
            "E2B webhook signature is invalid.",
            status_code=401,
        )
