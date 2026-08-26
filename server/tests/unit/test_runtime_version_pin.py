"""Unit tests for the runtime version pin and its launch-env export.

The pin (`runtime_version_pin`) drives the sandbox worker's in-place AnyHarness
binary swap: an unstamped deployment must pin nothing, and the launched runtime
env must carry exactly what the pin advertises so heartbeats report what runs.
"""

from __future__ import annotations


import pytest

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
