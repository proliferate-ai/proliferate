"""Unit tests for the runtime version pin and its launch-env export.

The pin (`runtime_version_pin`) drives the sandbox worker's in-place AnyHarness
binary swap: an unstamped deployment must pin nothing, and the launched runtime
env must carry exactly what the pin advertises so heartbeats report what runs.
"""

from __future__ import annotations

import pytest

from proliferate.server.cloud.runtime.bootstrap import build_runtime_env
from proliferate.server.version import runtime_version_pin


class TestRuntimeVersionPin:
    def test_pin_is_the_stamped_runtime_version(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RUNTIME_VERSION", "3.4.5")
        assert runtime_version_pin() == "3.4.5"

    def test_pin_is_none_when_unstamped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # No server-version display fallback: an unstamped deployment pins
        # nothing so the worker never chases an unpublished artifact.
        monkeypatch.delenv("RUNTIME_VERSION", raising=False)
        monkeypatch.setenv("SERVER_VERSION", "9.9.9")
        assert runtime_version_pin() is None

    def test_pin_ignores_blank(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RUNTIME_VERSION", "   ")
        assert runtime_version_pin() is None


class TestRuntimeLaunchEnvExport:
    def test_exports_pin_when_stamped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RUNTIME_VERSION", "3.4.5")
        env = build_runtime_env("tok", anyharness_data_key="key")
        assert env["PROLIFERATE_ANYHARNESS_VERSION"] == "3.4.5"

    def test_omits_export_when_unstamped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("RUNTIME_VERSION", raising=False)
        monkeypatch.setenv("SERVER_VERSION", "9.9.9")
        env = build_runtime_env("tok", anyharness_data_key="key")
        # No pin, no export: the worker reports no anyharness version and the
        # server pins none, so the two stay consistent.
        assert "PROLIFERATE_ANYHARNESS_VERSION" not in env
