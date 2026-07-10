"""E2B / cloud provisioning configuration safety (T1).

Regression: a half-configured E2B (``E2B_API_KEY`` set, ``E2B_TEMPLATE_NAME``
empty) raised at FastAPI startup in non-debug mode, crash-looping the whole API
and taking auth + every other control-plane surface offline. Partial config now
disables only the optional cloud capability (a boot warning, not a crash) and
cloud-provisioning requests fail with a specific, actionable error.
"""

from __future__ import annotations

import pytest

from proliferate.config import Settings
from proliferate.integrations.sandbox import e2b as e2b_runtime
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.errors import CloudApiError


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "_env_file": None,
        "jwt_secret": "test-secret",
        "cloud_secret_key": "test-cloud-secret",
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_fully_configured_is_ready() -> None:
    settings = _settings(debug=False, e2b_api_key="e2b_key", e2b_template_name="tmpl")
    assert settings.cloud_provisioning_configured is True
    assert settings.cloud_provisioning_config_error is None


def test_no_api_key_is_disabled_not_an_error() -> None:
    # Base install with no cloud is a valid, healthy configuration.
    settings = _settings(debug=False, e2b_api_key="", e2b_template_name="")
    assert settings.cloud_provisioning_configured is False
    assert settings.cloud_provisioning_config_error is None


def test_api_key_without_template_is_a_named_error_in_production() -> None:
    settings = _settings(debug=False, e2b_api_key="e2b_key", e2b_template_name="")
    assert settings.cloud_provisioning_configured is False
    error = settings.cloud_provisioning_config_error
    assert error is not None
    assert "E2B_TEMPLATE_NAME" in error
    # The message names the requirement without echoing the secret value.
    assert "e2b_key" not in error


def test_debug_allows_missing_template() -> None:
    settings = _settings(debug=True, e2b_api_key="e2b_key", e2b_template_name="")
    assert settings.cloud_provisioning_configured is True
    assert settings.cloud_provisioning_config_error is None


def test_require_cloud_provisioning_configured_raises_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cloud_sandboxes_service.settings, "debug", False)
    monkeypatch.setattr(cloud_sandboxes_service.settings, "e2b_api_key", "e2b_key")
    monkeypatch.setattr(cloud_sandboxes_service.settings, "e2b_template_name", "")

    with pytest.raises(CloudApiError) as excinfo:
        cloud_sandboxes_service.require_cloud_provisioning_configured()

    assert excinfo.value.status_code == 503
    assert excinfo.value.code == "e2b_template_not_configured"


def test_require_cloud_provisioning_configured_passes_when_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cloud_sandboxes_service.settings, "debug", False)
    monkeypatch.setattr(cloud_sandboxes_service.settings, "e2b_api_key", "e2b_key")
    monkeypatch.setattr(cloud_sandboxes_service.settings, "e2b_template_name", "tmpl")

    # Does not raise.
    cloud_sandboxes_service.require_cloud_provisioning_configured()


def test_e2b_template_name_raises_in_production_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(e2b_runtime.settings, "debug", False)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_api_key", "e2b_key")
    monkeypatch.setattr(e2b_runtime.settings, "e2b_template_name", "")

    provider = e2b_runtime.E2BSandboxProvider()
    with pytest.raises(e2b_runtime.E2BRuntimeError) as excinfo:
        provider._template_name()
    assert "E2B_TEMPLATE_NAME" in str(excinfo.value)
