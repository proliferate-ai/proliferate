"""Minimal JSON-RPC 2.0 helpers for the integration gateway MCP endpoint."""

from __future__ import annotations

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


def json_rpc_result(*, request_id: object, result: object) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def json_rpc_error(
    *,
    request_id: object,
    code: int,
    message: str,
) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def invalid_request(request_id: object) -> dict[str, object]:
    return json_rpc_error(request_id=request_id, code=INVALID_REQUEST, message="Invalid request.")


def method_not_found(request_id: object, method: str) -> dict[str, object]:
    return json_rpc_error(
        request_id=request_id,
        code=METHOD_NOT_FOUND,
        message=f"Method not found: {method}",
    )
