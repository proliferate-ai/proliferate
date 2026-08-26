"""The three virtual MCP tools the gateway advertises to AnyHarness.

The gateway exposes a fixed, tiny tool surface. The agent lists providers,
lists a provider's tools, then calls one — the gateway proxies the call to the
upstream MCP with Cloud-held credentials.
"""

from __future__ import annotations

LIST_PROVIDERS_TOOL = "integrations.list_providers"
LIST_TOOLS_TOOL = "integrations.list_tools"
CALL_TOOL_TOOL = "integrations.call_tool"

_GATEWAY_TOOL_NAMES = frozenset({LIST_PROVIDERS_TOOL, LIST_TOOLS_TOOL, CALL_TOOL_TOOL})


def is_gateway_tool_name(name: str) -> bool:
    return name in _GATEWAY_TOOL_NAMES


def _list_providers_definition() -> dict[str, object]:
    return {
        "name": LIST_PROVIDERS_TOOL,
        "description": (
            "List the integration providers connected and available to this "
            "session (e.g. linear, notion). Call this first to discover which "
            "integrations you can use."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    }


def _list_tools_definition() -> dict[str, object]:
    return {
        "name": LIST_TOOLS_TOOL,
        "description": (
            "List the tools a connected provider exposes, with their input "
            "schemas. Pass a provider returned by integrations.list_providers."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"provider": {"type": "string", "description": "Provider namespace."}},
            "required": ["provider"],
            "additionalProperties": False,
        },
    }


def _call_tool_definition() -> dict[str, object]:
    return {
        "name": CALL_TOOL_TOOL,
        "description": (
            "Invoke a provider tool by name with arguments matching the tool's "
            "input schema (from integrations.list_tools)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "provider": {"type": "string", "description": "Provider namespace."},
                "tool": {"type": "string", "description": "Upstream tool name."},
                "arguments": {
                    "type": "object",
                    "description": "Arguments for the tool.",
                },
            },
            "required": ["provider", "tool"],
            "additionalProperties": False,
        },
    }


def list_gateway_tools() -> list[dict[str, object]]:
    return [
        _list_providers_definition(),
        _list_tools_definition(),
        _call_tool_definition(),
    ]
