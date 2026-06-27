from __future__ import annotations

import json
from itertools import count

import httpx

from proliferate.integrations.mcp_remote.errors import McpRemoteError
from proliferate.integrations.mcp_remote.models import McpRemoteCallResult, McpRemoteTool

_REQUEST_IDS = count(1)


async def list_tools(
    *,
    url: str,
    headers: dict[str, str],
) -> tuple[McpRemoteTool, ...]:
    payload = await _json_rpc_request(url=url, headers=headers, method="tools/list", params={})
    result = payload.get("result")
    if not isinstance(result, dict):
        raise McpRemoteError("invalid_mcp_response", "MCP tools/list response was invalid.")
    tools = result.get("tools")
    if not isinstance(tools, list):
        return ()
    return tuple(_tool_from_payload(tool) for tool in tools if isinstance(tool, dict))


async def call_tool(
    *,
    url: str,
    headers: dict[str, str],
    tool_name: str,
    arguments: dict[str, object],
) -> McpRemoteCallResult:
    payload = await _json_rpc_request(
        url=url,
        headers=headers,
        method="tools/call",
        params={"name": tool_name, "arguments": arguments},
    )
    result = payload.get("result")
    if not isinstance(result, dict):
        raise McpRemoteError("invalid_mcp_response", "MCP tools/call response was invalid.")
    return McpRemoteCallResult(
        content=result.get("content"),
        is_error=result.get("isError") is True,
    )


async def _json_rpc_request(
    *,
    url: str,
    headers: dict[str, str],
    method: str,
    params: dict[str, object],
) -> dict[str, object]:
    request_id = next(_REQUEST_IDS)
    request_headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        **headers,
    }
    body = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, headers=request_headers, json=body)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise McpRemoteError(
            "mcp_http_error",
            f"MCP server returned HTTP {response.status_code}.",
        ) from exc
    payload = _parse_response_payload(response)
    if payload.get("error") is not None:
        error = payload["error"]
        message = "MCP server returned an error."
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            message = str(error["message"])
        raise McpRemoteError("mcp_json_rpc_error", message)
    return payload


def _parse_response_payload(response: httpx.Response) -> dict[str, object]:
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        return _parse_sse_json(response.text)
    try:
        payload = response.json()
    except ValueError as exc:
        raise McpRemoteError("invalid_mcp_response", "MCP response was not JSON.") from exc
    if not isinstance(payload, dict):
        raise McpRemoteError("invalid_mcp_response", "MCP response was not an object.")
    return payload


def _parse_sse_json(text: str) -> dict[str, object]:
    data_lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("data:"):
            data_lines.append(line.removeprefix("data:").strip())
    if not data_lines:
        raise McpRemoteError("invalid_mcp_response", "MCP SSE response did not include data.")
    try:
        payload = json.loads("\n".join(data_lines))
    except json.JSONDecodeError as exc:
        raise McpRemoteError("invalid_mcp_response", "MCP SSE response was not JSON.") from exc
    if not isinstance(payload, dict):
        raise McpRemoteError("invalid_mcp_response", "MCP SSE response was not an object.")
    return payload


def _tool_from_payload(payload: dict[str, object]) -> McpRemoteTool:
    name = payload.get("name")
    if not isinstance(name, str) or not name:
        raise McpRemoteError("invalid_mcp_response", "MCP tool was missing a name.")
    input_schema = payload.get("inputSchema")
    if not isinstance(input_schema, dict):
        input_schema = {}
    description = payload.get("description")
    return McpRemoteTool(
        name=name,
        description=description if isinstance(description, str) else None,
        input_schema=input_schema,
    )
