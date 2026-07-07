"""Shared server logging configuration helpers."""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime

from proliferate.config import settings
from proliferate.middleware.request_context import get_correlation_context
from proliferate.server.version import server_version

_APP_LOGGER_NAME = "proliferate"
_UVICORN_ERROR_LOGGER_NAME = "uvicorn.error"
_FALLBACK_FORMAT = "%(levelname)s:%(name)s:%(message)s"
_STANDARD_RECORD_KEYS = frozenset(logging.makeLogRecord({}).__dict__)

# Computed once at import/configure time — not per-record.
_SERVER_VERSION: str | None = None
_SERVER_GIT_SHA: str | None = None


class CorrelationLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in get_correlation_context().items():
            if not hasattr(record, key):
                setattr(record, key, value)
        return True


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if _SERVER_VERSION:
            payload["version"] = _SERVER_VERSION
        if _SERVER_GIT_SHA:
            payload["git_sha"] = _SERVER_GIT_SHA
        for key, value in get_correlation_context().items():
            payload[key] = value
        for key, value in record.__dict__.items():
            if key in _STANDARD_RECORD_KEYS or key in payload or key.startswith("_"):
                continue
            payload[key] = value if _is_json_scalar(value) else str(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


def configure_server_logging() -> None:
    """Ensure application logs are visible in dev and under Uvicorn."""
    global _SERVER_VERSION, _SERVER_GIT_SHA
    _SERVER_VERSION = server_version()
    _SERVER_GIT_SHA = os.getenv("SERVER_GIT_SHA") or None

    app_logger = logging.getLogger(_APP_LOGGER_NAME)
    if getattr(app_logger, "_proliferate_configured", False):
        return

    app_logger.setLevel(logging.INFO)

    uvicorn_error_logger = logging.getLogger(_UVICORN_ERROR_LOGGER_NAME)
    uvicorn_handlers = list(uvicorn_error_logger.handlers)
    if uvicorn_handlers:
        app_logger.handlers.clear()
        for handler in uvicorn_handlers:
            _configure_handler(handler)
            app_logger.addHandler(handler)
        app_logger.propagate = False
    elif not app_logger.handlers:
        fallback_handler = logging.StreamHandler()
        _configure_handler(fallback_handler)
        app_logger.addHandler(fallback_handler)
        app_logger.propagate = False

    app_logger._proliferate_configured = True  # type: ignore[attr-defined]


def _configure_handler(handler: logging.Handler) -> None:
    if not any(isinstance(item, CorrelationLogFilter) for item in handler.filters):
        handler.addFilter(CorrelationLogFilter())
    if settings.debug:
        if handler.formatter is None:
            handler.setFormatter(logging.Formatter(_FALLBACK_FORMAT))
        return
    handler.setFormatter(JsonLogFormatter())


def _is_json_scalar(value: object) -> bool:
    return value is None or isinstance(value, str | int | float | bool)
