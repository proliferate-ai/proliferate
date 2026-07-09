"""Minimal outbound MCP client (streamable-HTTP JSON-RPC).

Used to talk to remote MCP servers (``tools/list`` + ``tools/call``) when an
integration account is materialized for a user. This is the outbound client
half of the integrations subsystem; the inbound catalog/config lives under
``proliferate.server.cloud.integrations``.

Speaks just enough of the MCP streamable-HTTP transport to enumerate and invoke
tools on a remote server:

    initialize  ->  notifications/initialized  ->  tools/list | tools/call

The transport is tolerant: servers may answer a POST with either a plain
``application/json`` JSON-RPC message or a ``text/event-stream`` (SSE) body
carrying one or more ``data:`` framed messages. Both are parsed here. Any
transport- or protocol-level failure surfaces as :class:`McpRemoteError`.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

# MCP protocol revision we advertise on initialize. Servers negotiate down.
_PROTOCOL_VERSION = "2025-06-18"
_CLIENT_INFO = {"name": "proliferate", "version": "1.0.0"}
_ACCEPT = "application/json, text/event-stream"
_SESSION_HEADER = "Mcp-Session-Id"

# Generous but bounded: remote MCP servers occasionally cold-start.
_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
# httpx's read timeout resets on every byte, so an endpoint that trickles SSE
# keepalives could hold a request open forever. Cap the whole operation.
_OVERALL_DEADLINE_SECONDS = 45.0


async def _with_deadline[T](op: str, coro_factory: Callable[[], Awaitable[T]]) -> T:
    try:
        async with asyncio.timeout(_OVERALL_DEADLINE_SECONDS):
            return await coro_factory()
    except TimeoutError as exc:
        raise McpRemoteError(
            f"MCP {op} exceeded {_OVERALL_DEADLINE_SECONDS:.0f}s deadline",
            code="deadline_exceeded",
        ) from exc


class McpRemoteError(RuntimeError):
    """Raised on any transport or JSON-RPC protocol failure."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


def _base_headers(headers: dict[str, str] | None) -> dict[str, str]:
    merged: dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": _ACCEPT,
    }
    for key, value in (headers or {}).items():
        merged[key] = value
    return merged


def _iter_json_messages(response: httpx.Response) -> list[dict[str, Any]]:
    """Extract JSON-RPC messages from a JSON or SSE response body."""
    content_type = response.headers.get("content-type", "")
    text = response.text
    messages: list[dict[str, Any]] = []
    if "text/event-stream" in content_type:
        # SSE frames: accumulate ``data:`` lines per event (blank line = flush).
        data_lines: list[str] = []

        def flush() -> None:
            if not data_lines:
                return
            payload = "\n".join(data_lines)
            data_lines.clear()
            stripped = payload.strip()
            if not stripped:
                return
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                return
            if isinstance(parsed, dict):
                messages.append(parsed)

        for raw_line in text.splitlines():
            line = raw_line.rstrip("\r")
            if line == "":
                flush()
                continue
            if line.startswith(":"):
                continue
            if line.startswith("data:"):
                data_lines.append(line[len("data:") :].lstrip())
        flush()
    else:
        stripped = text.strip()
        if stripped:
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise McpRemoteError(
                    f"MCP server returned invalid JSON: {exc}", code="protocol_error"
                ) from exc
            if isinstance(parsed, list):
                messages.extend(m for m in parsed if isinstance(m, dict))
            elif isinstance(parsed, dict):
                messages.append(parsed)
    return messages


def _find_response(messages: list[dict[str, Any]], request_id: int) -> dict[str, Any]:
    """Return the JSON-RPC response matching ``request_id``."""
    for message in messages:
        if message.get("id") == request_id and ("result" in message or "error" in message):
            return message
    # Fall back to the first message carrying a result/error, tolerating servers
    # that echo ids as strings or omit them.
    for message in messages:
        if "result" in message or "error" in message:
            return message
    raise McpRemoteError("MCP server did not return a JSON-RPC response", code="protocol_error")


def _result_or_raise(message: dict[str, Any]) -> dict[str, Any]:
    if "error" in message:
        error = message.get("error") or {}
        code = error.get("code")
        detail = error.get("message") or "unknown error"
        raise McpRemoteError(
            f"MCP server error: {detail}",
            code=str(code) if code is not None else "rpc_error",
        )
    result = message.get("result")
    if not isinstance(result, dict):
        raise McpRemoteError("MCP response missing a result object", code="protocol_error")
    return result


async def _notify(
    client: httpx.AsyncClient,
    *,
    url: str,
    headers: dict[str, str],
    method: str,
    query: dict[str, str] | None,
) -> None:
    payload = {"jsonrpc": "2.0", "method": method}
    try:
        await client.post(url, headers=headers, json=payload, params=query or None)
    except httpx.HTTPError:  # notifications are best-effort
        return


async def _open_session(
    client: httpx.AsyncClient,
    *,
    url: str,
    headers: dict[str, str],
    query: dict[str, str] | None,
) -> dict[str, str]:
    """Run initialize + notifications/initialized; return session headers."""
    init_params = {
        "protocolVersion": _PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": _CLIENT_INFO,
    }
    payload = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": init_params}
    try:
        response = await client.post(url, headers=headers, json=payload, params=query or None)
    except httpx.HTTPError as exc:  # pragma: no cover - network dependent
        raise McpRemoteError(f"MCP initialize failed: {exc}", code="transport_error") from exc
    if response.status_code >= 400:
        raise McpRemoteError(
            f"MCP server returned HTTP {response.status_code} on initialize",
            code=f"http_{response.status_code}",
        )
    _result_or_raise(_find_response(_iter_json_messages(response), 1))

    session_headers = dict(headers)
    session_id = response.headers.get(_SESSION_HEADER)
    if session_id:
        session_headers[_SESSION_HEADER] = session_id
    await _notify(
        client,
        url=url,
        headers=session_headers,
        method="notifications/initialized",
        query=query,
    )
    return session_headers


async def _session_request(
    *,
    url: str,
    headers: dict[str, str] | None,
    query: dict[str, str] | None,
    method: str,
    params: dict[str, Any],
    request_id: int,
) -> dict[str, Any]:
    """Open a session, POST one JSON-RPC request, and return its result."""
    base = _base_headers(headers)
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        session_headers = await _open_session(client, url=url, headers=base, query=query)
        payload = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        try:
            response = await client.post(
                url, headers=session_headers, json=payload, params=query or None
            )
        except httpx.HTTPError as exc:  # pragma: no cover - network dependent
            raise McpRemoteError(f"MCP {method} failed: {exc}", code="transport_error") from exc
        if response.status_code >= 400:
            raise McpRemoteError(
                f"MCP server returned HTTP {response.status_code} on {method}",
                code=f"http_{response.status_code}",
            )
        return _result_or_raise(_find_response(_iter_json_messages(response), request_id))


async def list_tools(
    *,
    url: str,
    headers: dict[str, str] | None = None,
    query: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Enumerate the remote server's tools via ``tools/list``.

    Returns the raw tool objects (each ``{name, description, inputSchema}``).
    """
    return await _with_deadline(
        "tools/list", lambda: _list_tools_impl(url=url, headers=headers, query=query)
    )


async def _list_tools_impl(
    *,
    url: str,
    headers: dict[str, str] | None,
    query: dict[str, str] | None,
) -> list[dict[str, Any]]:
    result = await _session_request(
        url=url,
        headers=headers,
        query=query,
        method="tools/list",
        params={},
        request_id=2,
    )
    tools = result.get("tools", [])
    if not isinstance(tools, list):
        raise McpRemoteError("MCP tools/list result was not a list", code="protocol_error")
    return [tool for tool in tools if isinstance(tool, dict)]


async def call_tool(
    *,
    url: str,
    headers: dict[str, str] | None = None,
    tool_name: str,
    arguments: dict[str, Any],
    query: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Invoke ``tool_name`` via ``tools/call``.

    Returns ``{"content": [...], "isError": bool}`` from the server result.
    """
    return await _with_deadline(
        "tools/call",
        lambda: _call_tool_impl(
            url=url,
            headers=headers,
            tool_name=tool_name,
            arguments=arguments,
            query=query,
        ),
    )


async def _call_tool_impl(
    *,
    url: str,
    headers: dict[str, str] | None,
    tool_name: str,
    arguments: dict[str, Any],
    query: dict[str, str] | None,
) -> dict[str, Any]:
    result = await _session_request(
        url=url,
        headers=headers,
        query=query,
        method="tools/call",
        params={"name": tool_name, "arguments": arguments},
        request_id=3,
    )
    return {
        "content": result.get("content", []),
        "isError": bool(result.get("isError", False)),
    }
