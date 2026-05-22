from __future__ import annotations

import pytest
from fastapi import HTTPException

from proliferate.auth.identity.service import validate_redirect_uri
from proliferate.config import settings


def test_web_redirect_uri_allows_configured_loopback_alias(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "http://localhost:5175")

    validate_redirect_uri("web", "http://localhost:5175/auth/callback")
    validate_redirect_uri("web", "http://127.0.0.1:5175/auth/callback")

    with pytest.raises(HTTPException) as exc_info:
        validate_redirect_uri("web", "http://127.0.0.1:5176/auth/callback")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Web redirect URI origin is not allowed."
