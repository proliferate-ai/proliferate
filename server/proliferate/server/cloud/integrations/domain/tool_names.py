from __future__ import annotations

import re

from proliferate.server.cloud.errors import CloudApiError

_SAFE_RE = re.compile(r"[^A-Za-z0-9_]+")


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
