from __future__ import annotations

import re

from proliferate.server.cloud.errors import CloudApiError

_SAFE_RE = re.compile(r"[^A-Za-z0-9_]+")
_CAMEL_WORD_RE = re.compile(r"([a-z0-9])([A-Z])")
_DISPLAY_WORD_RE = re.compile(r"[\s_-]+")
_ACRONYMS = {"api", "id", "mcp", "oidc", "sso", "ssh", "url", "vpc"}


def gateway_tool_name(namespace: str, upstream_tool_name: str) -> str:
    return f"{sanitize_tool_part(namespace)}__{sanitize_tool_part(upstream_tool_name)}"


def split_gateway_tool_name(name: str) -> tuple[str, str]:
    namespace, separator, upstream_name = name.partition("__")
    if not separator or not namespace or not upstream_name:
        raise CloudApiError(
            "integration_tool_not_found",
            "Integration tool was not found.",
            status_code=404,
        )
    return namespace, upstream_name


def sanitize_tool_part(value: str) -> str:
    cleaned = _SAFE_RE.sub("_", value.strip()).strip("_")
    return cleaned or "tool"


def integration_tool_display_name(namespace: str, upstream_tool_name: str) -> str:
    cleaned = upstream_tool_name.strip()
    namespace_prefix = f"{namespace.strip()}_"
    if cleaned.lower().startswith(namespace_prefix.lower()):
        cleaned = cleaned[len(namespace_prefix) :]
    cleaned = _CAMEL_WORD_RE.sub(r"\1 \2", cleaned)
    words = [word for word in _DISPLAY_WORD_RE.split(cleaned) if word]
    if not words:
        return "Tool"
    return " ".join(_display_word(word, index=index) for index, word in enumerate(words))


def _display_word(word: str, *, index: int) -> str:
    lowered = word.lower()
    if lowered in _ACRONYMS:
        return lowered.upper()
    if index == 0:
        return lowered.capitalize()
    return lowered
