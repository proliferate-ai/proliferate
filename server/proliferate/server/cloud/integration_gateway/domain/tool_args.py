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
    # WS3c (feature spec §7.3): the trusted MCP/proxy layer's activation context
    # for a required invocation — a SIBLING of the agent-supplied ``arguments``
    # envelope, never nested inside it. ``None`` for every ordinary (non-required
    # -invocation) call; legacy runs never send it.
    activation_id: str | None = None


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
    activation_id = payload.get("activationId")
    if activation_id is not None and not (
        isinstance(activation_id, str) and activation_id.strip()
    ):
        raise CloudApiError(
            "integration_gateway_invalid_payload",
            "'activationId' must be a non-empty string when present.",
            status_code=400,
        )
    return CallToolArgs(
        provider=provider, tool=tool, arguments=tool_arguments, activation_id=activation_id
    )
