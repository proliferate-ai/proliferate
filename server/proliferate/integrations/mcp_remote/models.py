from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class McpRemoteTool:
    name: str
    description: str | None
    input_schema: dict[str, object]


@dataclass(frozen=True)
class McpRemoteCallResult:
    content: object
    is_error: bool
