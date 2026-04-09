"""Shared logging helpers for cloud services."""

from __future__ import annotations

import logging

_logger = logging.getLogger("proliferate.cloud")


def log_cloud_event(message: str, *, level: int = logging.INFO, **fields: object) -> None:
    suffix = " ".join(f"{key}={value}" for key, value in fields.items() if value is not None)
    _logger.log(level, f"{message}{f' {suffix}' if suffix else ''}")


def format_exception_message(error: BaseException) -> str:
    message = str(error).strip()
    if message:
        return message
    return error.__class__.__name__
