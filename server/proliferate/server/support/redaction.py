"""Support diagnostics redaction helpers."""

from __future__ import annotations

import re
from collections.abc import Mapping

_SECRET_KEY_RE = re.compile(
    r"(token|secret|password|credential|cookie|authorization|ciphertext|apply_token|"
    r"apikey|api[_-]?key|accesskey|access[_-]?key|privatekey|private[_-]?key|^key$)",
    re.IGNORECASE,
)
_BEARER_RE = re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
_ENV_SECRET_RE = re.compile(
    r"\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*=\s*)[^\s,;]+",
    re.IGNORECASE,
)
_SIGNED_URL_QUERY_RE = re.compile(r"([?&](?:X-Amz|AWSAccessKeyId|Signature)[^=]*=)[^&\s]+")
_OPAQUE_TOKEN_RE = re.compile(r"\b[A-Za-z0-9_-]{48,}\b")


def redact_support_text(value: str, *, max_chars: int = 2000) -> str:
    scrubbed = _BEARER_RE.sub("Bearer [REDACTED]", value)
    scrubbed = _ENV_SECRET_RE.sub(r"\1[REDACTED]", scrubbed)
    scrubbed = _SIGNED_URL_QUERY_RE.sub(r"\1[REDACTED]", scrubbed)
    scrubbed = _OPAQUE_TOKEN_RE.sub("[REDACTED]", scrubbed)
    if len(scrubbed) > max_chars:
        return f"{scrubbed[:max_chars]}..."
    return scrubbed


def redact_mapping(value: Mapping[str, object]) -> dict[str, object]:
    redacted: dict[str, object] = {}
    for key, item in value.items():
        if _SECRET_KEY_RE.search(key):
            redacted[key] = "[REDACTED]"
        else:
            redacted[key] = _redact_value(item)
    return redacted


def _redact_value(value: object) -> object:
    if isinstance(value, str):
        return redact_support_text(value)
    if isinstance(value, Mapping):
        return redact_mapping(value)
    if isinstance(value, list):
        return [_redact_value(entry) for entry in value]
    return value
