"""Minimal outbound MCP client (streamable-HTTP JSON-RPC).

Used to talk to remote MCP servers (``tools/list`` + ``tools/call``) when an
integration account is materialized for a user. This is the outbound client
half of the integrations subsystem; the inbound catalog/config lives under
``proliferate.server.cloud.integrations``.
"""

from __future__ import annotations

from proliferate.integrations.mcp_remote.client import (
    McpRemoteError,
    call_tool,
    list_tools,
)

__all__ = ["McpRemoteError", "call_tool", "list_tools"]
