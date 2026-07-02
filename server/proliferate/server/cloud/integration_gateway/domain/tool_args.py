"""Argument parsing for the gateway virtual tools."""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.server.cloud.errors import CloudApiError


@dataclass(frozen=True)
class ListToolsArgs:
    provider: str


@dataclass(frozen=True)
class CallToolArgs:
    provider: str
    tool: str
    arguments: dict[str, object]


def _require_object(value: object, *, message: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise CloudApiError("integration_gateway_invalid_payload", message, status_code=400)
    return value


def _require_non_empty_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise CloudApiError(
            "integration_gateway_invalid_payload",
            f"'{key}' must be a non-empty string.",
            status_code=400,
        )
    return value


def parse_list_tools_args(arguments: object) -> ListToolsArgs:
    payload = _require_object(arguments, message="Arguments must be an object.")
    return ListToolsArgs(provider=_require_non_empty_string(payload, "provider"))


def parse_call_tool_args(arguments: object) -> CallToolArgs:
    payload = _require_object(arguments, message="Arguments must be an object.")
    provider = _require_non_empty_string(payload, "provider")
    tool = _require_non_empty_string(payload, "tool")
    raw_arguments = payload.get("arguments", {})
    if raw_arguments is None:
        raw_arguments = {}
    tool_arguments = _require_object(raw_arguments, message="'arguments' must be an object.")
    return CallToolArgs(provider=provider, tool=tool, arguments=tool_arguments)
