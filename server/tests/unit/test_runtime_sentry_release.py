"""Component-specific Sentry release overrides for cloud target processes.

The server must never stamp its own (or a mismatched) release onto a target
component. The shared PROLIFERATE_TARGET_SENTRY_RELEASE override was removed;
worker and supervisor now carry component-specific overrides, refused unless
they canonically name their own component.
"""

from __future__ import annotations

import pytest

from proliferate.config import settings
from proliferate.server.cloud.runtime import bootstrap

_SHA12 = "3c2bbf20e215"
_SERVER_RELEASE = f"proliferate-server@0.3.27+{_SHA12}"
_WORKER_RELEASE = f"proliferate-worker@0.3.27+{_SHA12}"
_SUPERVISOR_RELEASE = f"proliferate-supervisor@0.3.27+{_SHA12}"
_ANYHARNESS_RELEASE = f"anyharness@0.3.27+{_SHA12}"


@pytest.fixture(autouse=True)
def _vendor_telemetry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
    monkeypatch.setattr(settings, "cloud_target_sentry_dsn", "https://sentry.example/target")
    monkeypatch.setattr(settings, "cloud_runtime_sentry_dsn", "https://sentry.example/runtime")


def test_target_env_never_emits_shared_target_release(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_sentry_release", "")
    monkeypatch.setattr(settings, "cloud_supervisor_sentry_release", "")
    env = bootstrap._target_sentry_env()
    assert "PROLIFERATE_TARGET_SENTRY_RELEASE" not in env
    assert "PROLIFERATE_WORKER_SENTRY_RELEASE" not in env
    assert "PROLIFERATE_SUPERVISOR_SENTRY_RELEASE" not in env


def test_target_env_propagates_matching_component_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "cloud_worker_sentry_release", _WORKER_RELEASE)
    monkeypatch.setattr(settings, "cloud_supervisor_sentry_release", _SUPERVISOR_RELEASE)
    env = bootstrap._target_sentry_env()
    assert env["PROLIFERATE_WORKER_SENTRY_RELEASE"] == _WORKER_RELEASE
    assert env["PROLIFERATE_SUPERVISOR_SENTRY_RELEASE"] == _SUPERVISOR_RELEASE
    assert "PROLIFERATE_TARGET_SENTRY_RELEASE" not in env


def test_target_env_refuses_server_release_on_worker_and_supervisor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The exact live bug: the server release wired into the target override.
    monkeypatch.setattr(settings, "cloud_worker_sentry_release", _SERVER_RELEASE)
    monkeypatch.setattr(settings, "cloud_supervisor_sentry_release", _SERVER_RELEASE)
    env = bootstrap._target_sentry_env()
    assert "PROLIFERATE_WORKER_SENTRY_RELEASE" not in env
    assert "PROLIFERATE_SUPERVISOR_SENTRY_RELEASE" not in env


def test_runtime_env_refuses_server_release_as_anyharness_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "cloud_runtime_sentry_release", _SERVER_RELEASE)
    env = bootstrap.build_runtime_env("tok", anyharness_data_key="key")
    assert "ANYHARNESS_SENTRY_RELEASE" not in env


def test_runtime_env_accepts_matching_anyharness_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "cloud_runtime_sentry_release", _ANYHARNESS_RELEASE)
    env = bootstrap.build_runtime_env("tok", anyharness_data_key="key")
    assert env["ANYHARNESS_SENTRY_RELEASE"] == _ANYHARNESS_RELEASE
