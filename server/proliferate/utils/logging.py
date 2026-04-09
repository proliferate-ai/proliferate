"""Shared server logging configuration helpers."""

from __future__ import annotations

import logging

_APP_LOGGER_NAME = "proliferate"
_UVICORN_ERROR_LOGGER_NAME = "uvicorn.error"
_FALLBACK_FORMAT = "%(levelname)s:%(name)s:%(message)s"


def configure_server_logging() -> None:
    """Ensure application logs are visible in dev and under Uvicorn."""
    app_logger = logging.getLogger(_APP_LOGGER_NAME)
    if getattr(app_logger, "_proliferate_configured", False):
        return

    app_logger.setLevel(logging.INFO)

    uvicorn_error_logger = logging.getLogger(_UVICORN_ERROR_LOGGER_NAME)
    uvicorn_handlers = list(uvicorn_error_logger.handlers)
    if uvicorn_handlers:
        app_logger.handlers.clear()
        for handler in uvicorn_handlers:
            app_logger.addHandler(handler)
        app_logger.propagate = False
    elif not app_logger.handlers:
        fallback_handler = logging.StreamHandler()
        fallback_handler.setFormatter(logging.Formatter(_FALLBACK_FORMAT))
        app_logger.addHandler(fallback_handler)
        app_logger.propagate = False

    app_logger._proliferate_configured = True  # type: ignore[attr-defined]
