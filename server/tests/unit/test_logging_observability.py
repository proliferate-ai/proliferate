"""Tests for observability enhancements: version fields on JSON logs and report_critical."""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import patch

import pytest

from proliferate.config import settings
from proliferate.integrations import sentry as sentry_integration
from proliferate.middleware.request_context import (
    bind_background_correlation_context,
    get_correlation_context,
    with_correlation_context,
)
from proliferate.utils import logging as logging_module
from proliferate.utils.logging import JsonLogFormatter, configure_server_logging


class TestJsonLogFormatterVersionFields:
    """JsonLogFormatter emits version and git_sha fields."""

    def test_version_field_present_when_set(self) -> None:
        with (
            patch.object(logging_module, "_SERVER_VERSION", "1.2.3"),
            patch.object(logging_module, "_SERVER_GIT_SHA", None),
        ):
            formatter = JsonLogFormatter()
            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg="hello",
                args=None,
                exc_info=None,
            )
            output = formatter.format(record)
            parsed = json.loads(output)
            assert parsed["version"] == "1.2.3"
            assert "git_sha" not in parsed

    def test_git_sha_field_present_when_set(self) -> None:
        with (
            patch.object(logging_module, "_SERVER_VERSION", "2.0.0"),
            patch.object(logging_module, "_SERVER_GIT_SHA", "abc1234"),
        ):
            formatter = JsonLogFormatter()
            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg="world",
                args=None,
                exc_info=None,
            )
            output = formatter.format(record)
            parsed = json.loads(output)
            assert parsed["version"] == "2.0.0"
            assert parsed["git_sha"] == "abc1234"

    def test_version_fields_absent_when_none(self) -> None:
        with (
            patch.object(logging_module, "_SERVER_VERSION", None),
            patch.object(logging_module, "_SERVER_GIT_SHA", None),
        ):
            formatter = JsonLogFormatter()
            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg="no version",
                args=None,
                exc_info=None,
            )
            output = formatter.format(record)
            parsed = json.loads(output)
            assert "version" not in parsed
            assert "git_sha" not in parsed

    def test_configure_server_logging_sets_version_globals(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(logging_module, "_SERVER_VERSION", None)
        monkeypatch.setattr(logging_module, "_SERVER_GIT_SHA", None)
        monkeypatch.setattr(logging_module, "_RELEASE_ID", None)
        monkeypatch.setenv("SERVER_GIT_SHA", "3c2bbf20e21599aa11bb22cc33dd44ee55ff6600")
        monkeypatch.setenv("SERVER_VERSION", "0.3.27")
        monkeypatch.delenv("PROLIFERATE_REQUIRE_RELEASE_IDENTITY", raising=False)
        # Reset configured flag so configure_server_logging runs fully
        app_logger = logging.getLogger("proliferate")
        app_logger._proliferate_configured = False  # type: ignore[attr-defined]

        configure_server_logging()

        assert logging_module._SERVER_VERSION is not None
        assert logging_module._SERVER_VERSION != ""
        assert logging_module._SERVER_GIT_SHA == "3c2bbf20e21599aa11bb22cc33dd44ee55ff6600"
        # release_id is the canonical <component>@<version>+<12-sha> form.
        assert logging_module._RELEASE_ID == "proliferate-server@0.3.27+3c2bbf20e215"


class TestJsonLogFormatterReleaseId:
    """The final serialized JSON log line carries a top-level release_id/user_id."""

    def _record(self) -> logging.LogRecord:
        return logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="hello",
            args=None,
            exc_info=None,
        )

    def test_release_id_present_when_set(self) -> None:
        with patch.object(logging_module, "_RELEASE_ID", "proliferate-server@0.3.27+3c2bbf20e215"):
            parsed = json.loads(JsonLogFormatter().format(self._record()))
            assert parsed["release_id"] == "proliferate-server@0.3.27+3c2bbf20e215"

    def test_release_id_absent_when_none(self) -> None:
        with patch.object(logging_module, "_RELEASE_ID", None):
            parsed = json.loads(JsonLogFormatter().format(self._record()))
            assert "release_id" not in parsed

    def test_user_id_serialized_top_level_from_context(self) -> None:
        with (
            patch.object(logging_module, "_RELEASE_ID", "proliferate-server@0.3.27+3c2bbf20e215"),
            with_correlation_context(user_id="user-123"),
        ):
            parsed = json.loads(JsonLogFormatter().format(self._record()))
            assert parsed["user_id"] == "user-123"
            assert parsed["release_id"] == "proliferate-server@0.3.27+3c2bbf20e215"

    def test_user_id_absent_for_anonymous_work(self) -> None:
        with patch.object(logging_module, "_RELEASE_ID", "proliferate-server@0.3.27+3c2bbf20e215"):
            parsed = json.loads(JsonLogFormatter().format(self._record()))
            assert "user_id" not in parsed


class _FakeScope:
    def __init__(self) -> None:
        self.level: str | None = None
        self.fingerprint: list[str] | None = None
        self.tags: dict[str, str] = {}
        self.extras: dict[str, object] = {}

    def set_tag(self, key: str, value: str) -> None:
        self.tags[key] = value

    def set_extra(self, key: str, value: object) -> None:
        self.extras[key] = value


class _TrackingSentrySdk:
    """Fake SDK that tracks the scope passed to capture_exception."""

    def __init__(self) -> None:
        self.captured: list[tuple[Exception, _FakeScope]] = []
        self._current_scope: _FakeScope | None = None

    def push_scope(self):
        from contextlib import contextmanager

        @contextmanager
        def _ctx():
            scope = _FakeScope()
            self._current_scope = scope
            try:
                yield scope
            finally:
                self._current_scope = None

        return _ctx()

    def capture_exception(self, error: Exception) -> None:
        self.captured.append((error, self._current_scope or _FakeScope()))


class TestReportCritical:
    """report_critical emits to Sentry with fatal level and logs with marker."""

    def test_captures_to_sentry_with_fatal_and_critical_tag(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_sdk = _TrackingSentrySdk()
        monkeypatch.setattr(settings, "sentry_dsn", "https://sentry.example/123")
        monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
        monkeypatch.setattr(sentry_integration, "sentry_sdk", fake_sdk)

        error = RuntimeError("disk full")
        sentry_integration.report_critical(
            error,
            tags={"domain": "billing"},
            extras={"detail": "safe value"},
        )

        assert len(fake_sdk.captured) == 1
        _captured_error, scope = fake_sdk.captured[0]
        assert scope.level == "fatal"
        assert scope.tags["critical_failure"] == "true"
        assert scope.tags["domain"] == "billing"

    def test_emits_logger_exception_with_marker_and_extra(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Disable Sentry to isolate log testing
        monkeypatch.setattr(settings, "sentry_dsn", "")

        calls: list[tuple[str, dict[str, Any]]] = []

        class _FakeLogger:
            def exception(self, msg: str, *args: object, **kwargs: object) -> None:
                calls.append((msg % args, dict(kwargs)))

        monkeypatch.setattr(sentry_integration, "_report_critical_logger", _FakeLogger())

        error = RuntimeError("bad state")
        sentry_integration.report_critical(
            error,
            tags={"worker": "scheduler"},
            extras={"count": 5},
            worker_name="test-worker",
        )

        assert len(calls) == 1
        message, kwargs = calls[0]
        assert "CRITICAL_FAILURE" in message
        assert "bad state" in message
        extra = kwargs["extra"]
        assert extra["critical_failure"] is True
        assert extra["count"] == 5
        assert extra["worker_name"] == "test-worker"

    def test_report_critical_noops_sentry_when_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Even when sentry is disabled, the log is still emitted."""
        monkeypatch.setattr(settings, "sentry_dsn", "")

        calls: list[tuple[str, dict[str, Any]]] = []

        class _FakeLogger:
            def exception(self, msg: str, *args: object, **kwargs: object) -> None:
                calls.append((msg % args, dict(kwargs)))

        monkeypatch.setattr(sentry_integration, "_report_critical_logger", _FakeLogger())

        error = RuntimeError("oops")
        sentry_integration.report_critical(error)

        assert len(calls) == 1
        assert "CRITICAL_FAILURE" in calls[0][0]


class TestCorrelationContextBackground:
    """bind_background_correlation_context sets context vars for background work."""

    def test_bind_sets_vars_and_returns_tokens(self) -> None:
        bind_background_correlation_context(
            organization_id="org-123",
            tenant_id="ten-456",
        )
        try:
            ctx = get_correlation_context()
            assert ctx["organization_id"] == "org-123"
            assert ctx["tenant_id"] == "ten-456"
        finally:
            from proliferate.middleware.request_context import _CORRELATION_VARS

            # Reset using with_correlation_context to clean up
            for var in _CORRELATION_VARS.values():
                var.set(None)

    def test_with_correlation_context_scoped(self) -> None:
        with with_correlation_context(worker_id="test-worker", organization_id="org-1"):
            ctx = get_correlation_context()
            assert ctx["worker_id"] == "test-worker"
            assert ctx["organization_id"] == "org-1"
        # After context manager, values should be reset
        ctx = get_correlation_context()
        assert "worker_id" not in ctx
