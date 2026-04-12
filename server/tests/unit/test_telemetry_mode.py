from __future__ import annotations

import pytest

from proliferate.config import Settings, settings
from proliferate.utils.telemetry_mode import (
    get_server_telemetry_mode,
    is_anonymous_telemetry_enabled,
    is_vendor_telemetry_enabled,
)


def test_settings_accept_prefixed_telemetry_env_vars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PROLIFERATE_TELEMETRY_MODE", "self_managed")
    monkeypatch.setenv(
        "PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT",
        "https://collector.example/v1/telemetry/anonymous",
    )
    monkeypatch.setenv("PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED", "true")

    resolved = Settings(
        _env_file=None,
        debug=True,
        jwt_secret="test-secret",
        cloud_secret_key="test-cloud-secret",
    )

    assert resolved.telemetry_mode == "self_managed"
    assert (
        resolved.anonymous_telemetry_endpoint == "https://collector.example/v1/telemetry/anonymous"
    )
    assert resolved.anonymous_telemetry_disabled is True


def test_hosted_product_enables_vendor_but_not_anonymous_disable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
    monkeypatch.setattr(settings, "anonymous_telemetry_disabled", False)

    assert get_server_telemetry_mode() == "hosted_product"
    assert is_vendor_telemetry_enabled() is True
    assert is_anonymous_telemetry_enabled() is True


def test_invalid_mode_raises() -> None:
    original_mode = settings.telemetry_mode
    try:
        settings.telemetry_mode = "wrong"  # type: ignore[assignment]
        with pytest.raises(RuntimeError, match="Invalid telemetry_mode"):
            get_server_telemetry_mode()
    finally:
        settings.telemetry_mode = original_mode
