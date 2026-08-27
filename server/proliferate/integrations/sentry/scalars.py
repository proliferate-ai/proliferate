"""Generic text scrubbers and closed scalar validators for the Sentry policy.

The text-level layer under :mod:`.privacy`: pattern scrubbers that redact
paths, tokens, and JWTs, plus the bounded scalar validators (UUIDs, releases,
qualnames, timestamps, catalog builders) that every catalog row is built from.
It imports no product or server layer and knows nothing about events.
"""

from __future__ import annotations

import datetime as _datetime
import re
import uuid
from typing import Any

SENSITIVE_KEY_PATTERN = re.compile(
    r"(authorization|cookie|token|secret|password|api[_-]?key|credential|"
    r"prompt|content|stdout|stderr|request_body|body|env|file_path|path)",
    re.IGNORECASE,
)
ABSOLUTE_PATH_PATTERN = re.compile(r"(?:/Users/[^\s]+|/home/[^\s]+|[A-Za-z]:\\[^\s]+)")
BEARER_TOKEN_PATTERN = re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE)
JWT_PATTERN = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b")


def _set(text: str) -> frozenset[str]:
    """Split a space-separated closed catalog into its exact values."""
    return frozenset(text.split())


REDACTED = "[redacted]"


def _scrub_string_patterns(value: str) -> str:
    tokens = BEARER_TOKEN_PATTERN.sub("[redacted-token]", value)
    return tokens.replace("\r\n", "\n").replace("\r", "\n")


def scrub_text(value: str) -> str:
    paths = ABSOLUTE_PATH_PATTERN.sub("[redacted-path]", _scrub_string_patterns(value))
    return JWT_PATTERN.sub("[redacted-jwt]", paths)


def scrub_value(value: Any, key: str | None = None) -> Any:
    if value is None:
        return None
    if key and SENSITIVE_KEY_PATTERN.search(key):
        return REDACTED
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, list):
        return [scrub_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(scrub_value(item) for item in value)
    if isinstance(value, dict):
        return {inner: scrub_value(item, inner) for inner, item in value.items()}
    return value


def scrub_mapping(value: dict[str, Any] | None) -> dict[str, Any] | None:
    return None if value is None else scrub_value(value)


# --- closed scalar validators -------------------------------------------------

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_PY_NAME = re.compile(r"\A[A-Za-z_][A-Za-z0-9_]*\Z")
_ANGLE_NAMES = _set("<module> <locals> <lambda> <genexpr> <listcomp> <dictcomp> <setcomp>")
_FILE_SEGMENT = re.compile(r"\A[A-Za-z0-9_.-]+\Z")
_RFC3339 = re.compile(r"\A\d{4}-\d\d-\d\d[Tt ]\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)\Z")


def _clean_str(value: Any, limit: int) -> str | None:
    """Return ``value`` only when it is an exact, control-free, scrub-stable ``str``."""
    if type(value) is not str:
        return None
    if _CONTROL.search(value) or scrub_text(value) != value:
        return None
    return value if len(value.encode("utf-8")) <= limit else None


def _exact(value: Any, allowed: frozenset[str], limit: int = 128) -> str | None:
    cleaned = _clean_str(value, limit)
    return cleaned if cleaned is not None and cleaned in allowed else None


def _pattern(regex: str, limit: int) -> Any:
    """Build a validator admitting only a clean string fully matching ``regex``."""
    compiled = re.compile(regex)

    def _check(value: Any) -> str | None:
        cleaned = _clean_str(value, limit)
        return cleaned if cleaned is not None and compiled.match(cleaned) else None

    return _check


hex32 = _pattern(r"\A[0-9a-fA-F]{32}\Z", 32)
hex16 = _pattern(r"\A[0-9a-fA-F]{16}\Z", 16)
_RELEASE = r"\Aproliferate-server@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9a-f]{12})?\Z"
release_value = _pattern(_RELEASE, 128)
_uuid_shape = _pattern(r"\A[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z", 36)
_uuid4_hex_shape = _pattern(r"\A[0-9a-f]{32}\Z", 32)


def _parsed_uuid(cleaned: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(cleaned)
    except ValueError:
        return None


def canonical_uuid(value: Any) -> str | None:
    cleaned = _uuid_shape(value)
    if cleaned is None:
        return None
    parsed = _parsed_uuid(cleaned)
    return cleaned if parsed is not None and str(parsed) == cleaned.lower() else None


def uuid4_value(value: Any) -> str | None:
    cleaned = canonical_uuid(value)
    if cleaned is None:
        return None
    parsed = _parsed_uuid(cleaned)
    return cleaned if parsed is not None and parsed.version == 4 else None


def uuid4_hex(value: Any) -> str | None:
    cleaned = _uuid4_hex_shape(value)
    if cleaned is None:
        return None
    parsed = _parsed_uuid(cleaned)
    return cleaned if parsed is not None and parsed.version == 4 else None


def _qualname_ok(cleaned: str) -> bool:
    if any(ch in cleaned for ch in ("/", "\\", ":")) or re.search(r"\s", cleaned):
        return False
    return all(seg in _ANGLE_NAMES or bool(_PY_NAME.match(seg)) for seg in cleaned.split("."))


def python_qualname(value: Any) -> str | None:
    cleaned = _clean_str(value, 256)
    return cleaned if cleaned is not None and _qualname_ok(cleaned) else None


def exception_qualname(value: Any) -> str | None:
    cleaned = python_qualname(value)
    if cleaned is None:
        return None
    return cleaned if _PY_NAME.match(cleaned.rsplit(".", 1)[-1]) else None


def app_qualname(value: Any) -> str | None:
    cleaned = python_qualname(value)
    return cleaned if cleaned is not None and cleaned.startswith("proliferate.") else None


def app_logger_name(value: Any) -> str | None:
    return value if _clean_str(value, 11) == "proliferate" else app_qualname(value)


def app_relative_file(value: Any) -> str | None:
    cleaned = _clean_str(value, 512)
    if cleaned is None:
        return None
    if not cleaned.startswith(("proliferate/", "server/proliferate/")):
        return None
    segments = cleaned.split("/")
    if any(seg in ("", ".", "..") or not _FILE_SEGMENT.match(seg) for seg in segments):
        return None
    return cleaned


def timestamp(value: Any) -> Any | None:
    """Admit an epoch number, an RFC 3339 string, or a timezone-aware ``datetime``."""
    if type(value) is bool:
        return None
    if type(value) in (int, float):
        return value if 0 <= value <= 253402300799 else None
    if type(value) is str:
        cleaned = _clean_str(value, 40)
        return cleaned if cleaned is not None and _RFC3339.match(cleaned) else None
    if type(value) is _datetime.datetime and value.utcoffset() is not None:
        try:
            epoch = value.timestamp()
        except (OverflowError, OSError, ValueError):  # pragma: no cover - fail closed
            return None
        return value if 0 <= epoch <= 253402300799 else None
    return None


def _bool(value: Any) -> bool | None:
    return value if type(value) is bool else None


def _int_in(value: Any, low: int, high: int) -> int | None:
    if type(value) is not int or type(value) is bool:
        return None
    return value if low <= value <= high else None


def _catalog(allowed: str, limit: int) -> Any:
    """Build a validator admitting only the exact space-separated catalog values."""
    values = frozenset(allowed.split())
    return lambda value: _exact(value, values, limit)


def _catalog_of(allowed: frozenset[str], limit: int) -> Any:
    return lambda value: _exact(value, allowed, limit)
