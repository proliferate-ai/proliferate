# D-003 workflows launch flag: derivation + the API dark-hold.
#
# The flag mirrors single_org_mode's shape — derived from telemetry_mode
# (hosted production holds, everything else gets workflows) with an explicit
# WORKFLOWS_ENABLED / PROLIFERATE_WORKFLOWS_ENABLED override winning in both
# directions. The router guard 404s the whole workflows surface (and the
# function-invocations surface, which exists for workflows) while dark, with
# the enumerated `workflows_disabled` code.

from __future__ import annotations

import pytest

from proliferate.config import Settings, settings
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.access import require_workflows_enabled


def _settings(**kwargs: object) -> Settings:
    return Settings(
        _env_file=None,
        debug=True,
        jwt_secret="test-secret",
        cloud_secret_key="test-cloud-secret",
        **kwargs,
    )


def test_hosted_product_holds_workflows_dark_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("WORKFLOWS_ENABLED", raising=False)
    monkeypatch.delenv("PROLIFERATE_WORKFLOWS_ENABLED", raising=False)
    monkeypatch.setenv("TELEMETRY_MODE", "hosted_product")
    assert _settings().workflows_enabled is False


@pytest.mark.parametrize("mode", ["self_managed", "local_dev"])
def test_non_hosted_postures_get_workflows_on(monkeypatch: pytest.MonkeyPatch, mode: str) -> None:
    monkeypatch.delenv("WORKFLOWS_ENABLED", raising=False)
    monkeypatch.delenv("PROLIFERATE_WORKFLOWS_ENABLED", raising=False)
    monkeypatch.setenv("TELEMETRY_MODE", mode)
    assert _settings().workflows_enabled is True


@pytest.mark.parametrize("env_var", ["WORKFLOWS_ENABLED", "PROLIFERATE_WORKFLOWS_ENABLED"])
def test_override_wins_in_both_directions(monkeypatch: pytest.MonkeyPatch, env_var: str) -> None:
    monkeypatch.delenv("WORKFLOWS_ENABLED", raising=False)
    monkeypatch.delenv("PROLIFERATE_WORKFLOWS_ENABLED", raising=False)

    # Hosted production flipped ON (the staging/production-launch posture).
    monkeypatch.setenv("TELEMETRY_MODE", "hosted_product")
    monkeypatch.setenv(env_var, "true")
    assert _settings().workflows_enabled is True

    # Self-hosted explicitly held OFF.
    monkeypatch.setenv("TELEMETRY_MODE", "self_managed")
    monkeypatch.setenv(env_var, "false")
    assert _settings().workflows_enabled is False


def test_router_guard_404s_with_enumerated_code_when_dark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflows_enabled_override", False)
    monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
    with pytest.raises(CloudApiError) as excinfo:
        require_workflows_enabled()
    assert excinfo.value.status_code == 404
    assert excinfo.value.code == "workflows_disabled"


def test_router_guard_passes_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "workflows_enabled_override", True)
    require_workflows_enabled()
