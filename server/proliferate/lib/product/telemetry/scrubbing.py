from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEY_PATTERN = re.compile(
    r"(authorization|cookie|token|secret|password|api[_-]?key|credential|"
    r"prompt|content|stdout|stderr|request_body|body|env|file_path|path)",
    re.IGNORECASE,
)
ABSOLUTE_PATH_PATTERN = re.compile(r"(?:/Users/[^\s]+|/home/[^\s]+|[A-Za-z]:\\[^\s]+)")
BEARER_TOKEN_PATTERN = re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE)
JWT_PATTERN = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b")


def _scrub_string_patterns(value: str) -> str:
    return (
        BEARER_TOKEN_PATTERN.sub("[redacted-token]", value)
        .replace("\r\n", "\n")
        .replace("\r", "\n")
    )


def scrub_text(value: str) -> str:
    return JWT_PATTERN.sub(
        "[redacted-jwt]",
        ABSOLUTE_PATH_PATTERN.sub("[redacted-path]", _scrub_string_patterns(value)),
    )


def scrub_value(value: Any, key: str | None = None) -> Any:
    if value is None:
        return None

    if key and SENSITIVE_KEY_PATTERN.search(key):
        return "[redacted]"

    if isinstance(value, str):
        return scrub_text(value)

    if isinstance(value, list):
        return [scrub_value(item) for item in value]

    if isinstance(value, tuple):
        return tuple(scrub_value(item) for item in value)

    if isinstance(value, dict):
        return {
            entry_key: scrub_value(entry_value, entry_key)
            for entry_key, entry_value in value.items()
        }

    return value


def scrub_mapping(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return scrub_value(value)
