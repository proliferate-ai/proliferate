import base64
import hashlib

import pytest

from proliferate.config import settings
from proliferate.integrations.sandbox import (
    E2BWebhookSignatureError,
    verify_e2b_webhook_signature,
)


def _sign_webhook(secret: str, body: bytes) -> str:
    digest = hashlib.sha256(secret.encode("utf-8") + body).digest()
    return base64.b64encode(digest).decode("utf-8").rstrip("=")


def test_verify_e2b_webhook_signature_accepts_signed_payload(monkeypatch) -> None:
    body = b'{"id":"evt-test"}'
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")

    verify_e2b_webhook_signature(body, _sign_webhook("test-secret", body))


def test_verify_e2b_webhook_signature_accepts_legacy_url_safe_signature(monkeypatch) -> None:
    body = b"\x01\x02find-plus-and-slash"
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")
    signature = _sign_webhook("test-secret", body).replace("+", "-").replace("/", "_")

    verify_e2b_webhook_signature(body, signature)


@pytest.mark.parametrize(
    ("secret", "signature", "expected_code", "expected_message", "expected_status"),
    [
        (
            "",
            "signature",
            "webhook_unavailable",
            "E2B webhook verification is not configured.",
            503,
        ),
        (
            "test-secret",
            None,
            "invalid_webhook_signature",
            "E2B webhook signature is required.",
            401,
        ),
        (
            "test-secret",
            "bad-signature",
            "invalid_webhook_signature",
            "E2B webhook signature is invalid.",
            401,
        ),
    ],
)
def test_verify_e2b_webhook_signature_reports_failures(
    monkeypatch,
    secret: str,
    signature: str | None,
    expected_code: str,
    expected_message: str,
    expected_status: int,
) -> None:
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", secret)

    with pytest.raises(E2BWebhookSignatureError) as exc_info:
        verify_e2b_webhook_signature(b"{}", signature)

    assert exc_info.value.code == expected_code
    assert exc_info.value.message == expected_message
    assert exc_info.value.status_code == expected_status
