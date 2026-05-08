import pytest

from proliferate.config import settings
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.webhooks.service import _verify_e2b_signature


def test_e2b_webhook_translates_signature_failure(monkeypatch) -> None:
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")

    with pytest.raises(CloudApiError) as exc_info:
        _verify_e2b_signature(b"{}", "bad-signature")

    assert exc_info.value.code == "invalid_webhook_signature"
    assert exc_info.value.message == "E2B webhook signature is invalid."
    assert exc_info.value.status_code == 401
