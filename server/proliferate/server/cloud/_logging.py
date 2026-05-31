"""Shared logging helpers for cloud services."""

from __future__ import annotations

import logging

from proliferate.middleware.request_context import get_correlation_context

_logger = logging.getLogger("proliferate.cloud")
_REDACTED_FIELD_FRAGMENTS = (
    "token",
    "secret",
    "password",
    "credential",
    "cookie",
    "authorization",
    "ciphertext",
)


def log_cloud_event(message: str, *, level: int = logging.INFO, **fields: object) -> None:
    merged = {
        **get_correlation_context(),
        **{key: value for key, value in fields.items() if value is not None},
    }
    safe_fields = {
        key: _safe_log_value(key, value) for key, value in merged.items() if value is not None
    }
    suffix = " ".join(f"{key}={value}" for key, value in safe_fields.items())
    _logger.log(level, f"{message}{f' {suffix}' if suffix else ''}", extra=safe_fields)


def format_exception_message(error: BaseException) -> str:
    message = str(error).strip()
    if message:
        return message
    return error.__class__.__name__


def _safe_log_value(key: str, value: object) -> object:
    lowered = key.lower()
    if any(fragment in lowered for fragment in _REDACTED_FIELD_FRAGMENTS):
        return "[REDACTED]"
    if isinstance(value, str) and len(value) > 500:
        return f"{value[:500]}..."
    return value
