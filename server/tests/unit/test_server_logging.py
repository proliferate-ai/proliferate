from __future__ import annotations

import json
import logging
import logging.handlers
import sys
from collections.abc import Iterator

import pytest

from proliferate.config import settings
from proliferate.middleware.logging import (
    CorrelationLogFilter,
    JsonLogFormatter,
    _configure_handler,
    _RELEASE_ID as _ORIGINAL_RELEASE_ID,
    _SERVER_GIT_SHA as _ORIGINAL_SERVER_GIT_SHA,
    _SERVER_VERSION as _ORIGINAL_SERVER_VERSION,
    configure_server_logging,
)
from proliferate.middleware.request_context import with_correlation_context

_MISSING = object()


@pytest.fixture(autouse=True)
def _restore_logging_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    loggers = [logging.getLogger("proliferate"), logging.getLogger("uvicorn.error")]
    logger_state = [
        (
            logger,
            list(logger.handlers),
            logger.level,
            logger.propagate,
            getattr(logger, "_proliferate_configured", _MISSING),
        )
        for logger in loggers
    ]
    monkeypatch.setattr(
        "proliferate.middleware.logging._SERVER_VERSION",
        _ORIGINAL_SERVER_VERSION,
    )
    monkeypatch.setattr(
        "proliferate.middleware.logging._SERVER_GIT_SHA",
        _ORIGINAL_SERVER_GIT_SHA,
    )
    monkeypatch.setattr(
        "proliferate.middleware.logging._RELEASE_ID",
        _ORIGINAL_RELEASE_ID,
    )
    yield
    for logger, handlers, level, propagate, configured in logger_state:
        logger.handlers[:] = handlers
        logger.setLevel(level)
        logger.propagate = propagate
        if configured is _MISSING:
            if hasattr(logger, "_proliferate_configured"):
                delattr(logger, "_proliferate_configured")
        else:
            logger._proliferate_configured = configured  # type: ignore[attr-defined]


def _reset_logger(logger_name: str) -> logging.Logger:
    logger = logging.getLogger(logger_name)
    logger.handlers.clear()
    logger.setLevel(logging.NOTSET)
    logger.propagate = True
    if hasattr(logger, "_proliferate_configured"):
        delattr(logger, "_proliferate_configured")
    return logger


def test_configure_server_logging_reuses_uvicorn_error_handlers(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("PROLIFERATE_LOGS_HOME", str(tmp_path))
    app_logger = _reset_logger("proliferate")
    uvicorn_logger = _reset_logger("uvicorn.error")
    handler = logging.StreamHandler()
    uvicorn_logger.addHandler(handler)

    configure_server_logging()

    assert app_logger.level == logging.INFO
    stream_handlers = [
        item
        for item in app_logger.handlers
        if not isinstance(item, logging.handlers.RotatingFileHandler)
    ]
    assert stream_handlers == [handler]
    assert app_logger.propagate is False


def test_configure_server_logging_falls_back_to_stream_handler_without_uvicorn(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setenv("PROLIFERATE_LOGS_HOME", str(tmp_path))
    app_logger = _reset_logger("proliferate")
    _reset_logger("uvicorn.error")

    configure_server_logging()

    assert app_logger.level == logging.INFO
    stream_handlers = [
        handler
        for handler in app_logger.handlers
        if not isinstance(handler, logging.handlers.RotatingFileHandler)
    ]
    assert len(stream_handlers) == 1
    assert isinstance(stream_handlers[0], logging.StreamHandler)
    assert app_logger.propagate is False


def test_local_dev_gains_a_json_file_sink_beside_the_console(monkeypatch, tmp_path) -> None:
    """The local tail's server source: debug mode writes server.log as JSON
    records whatever the console shows (observability README §2: JSON when a
    machine reads)."""
    monkeypatch.setenv("PROLIFERATE_LOGS_HOME", str(tmp_path))
    app_logger = _reset_logger("proliferate")
    _reset_logger("uvicorn.error")

    configure_server_logging()

    file_handlers = [
        handler
        for handler in app_logger.handlers
        if isinstance(handler, logging.handlers.RotatingFileHandler)
    ]
    if not file_handlers:  # debug=False runs keep prod stdout-only behavior
        from proliferate.config import settings

        assert settings.debug is False
        return
    assert len(file_handlers) == 1
    assert file_handlers[0].baseFilename == str(tmp_path / "server" / "logs" / "server.log")
    from proliferate.middleware.logging import JsonLogFormatter

    assert isinstance(file_handlers[0].formatter, JsonLogFormatter)


def test_correlation_filter_adds_missing_context_without_overwriting_record() -> None:
    record = logging.LogRecord("test", logging.INFO, "", 0, "hello", (), None)
    record.request_id = "record-owned"

    with with_correlation_context(request_id="context-owned", organization_id="org-123"):
        accepted = CorrelationLogFilter().filter(record)

    assert accepted is True
    assert record.request_id == "record-owned"
    assert record.organization_id == "org-123"


def test_handler_configuration_selects_format_and_deduplicates_filter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    structured_handler = logging.StreamHandler()
    monkeypatch.setattr(settings, "debug", False)

    _configure_handler(structured_handler)
    _configure_handler(structured_handler)

    assert isinstance(structured_handler.formatter, JsonLogFormatter)
    assert sum(isinstance(item, CorrelationLogFilter) for item in structured_handler.filters) == 1

    debug_handler = logging.StreamHandler()
    existing_formatter = logging.Formatter("custom:%(message)s")
    debug_handler.setFormatter(existing_formatter)
    monkeypatch.setattr(settings, "debug", True)

    _configure_handler(debug_handler)

    assert debug_handler.formatter is existing_formatter
    fallback_handler = logging.StreamHandler()
    _configure_handler(fallback_handler)
    assert fallback_handler.formatter is not None
    assert fallback_handler.formatter._fmt == "%(levelname)s:%(name)s:%(message)s"


def test_json_formatter_preserves_schema_context_extras_and_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("proliferate.middleware.logging._SERVER_VERSION", "1.2.3")
    monkeypatch.setattr("proliferate.middleware.logging._SERVER_GIT_SHA", "abc123")
    monkeypatch.setattr(
        "proliferate.middleware.logging._RELEASE_ID",
        "proliferate-server@1.2.3+abc123",
    )
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        exc_info = sys.exc_info()

    record = logging.LogRecord(
        "test.logger",
        logging.ERROR,
        "",
        0,
        "failed %s",
        ("request",),
        exc_info,
    )
    record.scalar = 7
    record.complex_value = [1, 2]
    record._private_value = "hidden"
    record.message = "must-not-collide"

    with with_correlation_context(request_id="req-1", organization_id="org-1"):
        parsed = json.loads(JsonLogFormatter().format(record))

    assert parsed["timestamp"].endswith("+00:00")
    assert parsed["level"] == "ERROR"
    assert parsed["logger"] == "test.logger"
    assert parsed["message"] == "failed request"
    assert parsed["release_id"] == "proliferate-server@1.2.3+abc123"
    assert parsed["version"] == "1.2.3"
    assert parsed["git_sha"] == "abc123"
    assert parsed["request_id"] == "req-1"
    assert parsed["organization_id"] == "org-1"
    assert parsed["scalar"] == 7
    assert parsed["complex_value"] == "[1, 2]"
    assert "_private_value" not in parsed
    assert "RuntimeError: boom" in parsed["exception"]


def test_configured_marker_keeps_handlers_but_refreshes_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_logger = _reset_logger("proliferate")
    existing_handler = logging.StreamHandler()
    app_logger.addHandler(existing_handler)
    app_logger.setLevel(logging.WARNING)
    app_logger._proliferate_configured = True  # type: ignore[attr-defined]
    monkeypatch.setattr("proliferate.middleware.logging.server_version", lambda: "9.8.7")
    monkeypatch.setattr(
        "proliferate.middleware.logging.server_release_id",
        lambda: "proliferate-server@9.8.7+abcdef123456",
    )
    monkeypatch.setenv("SERVER_GIT_SHA", "abcdef1234567890")

    configure_server_logging()

    assert app_logger.handlers == [existing_handler]
    assert app_logger.level == logging.WARNING
    parsed = json.loads(JsonLogFormatter().format(logging.makeLogRecord({"msg": "identity"})))
    assert parsed["version"] == "9.8.7"
    assert parsed["git_sha"] == "abcdef1234567890"
    assert parsed["release_id"] == "proliferate-server@9.8.7+abcdef123456"
