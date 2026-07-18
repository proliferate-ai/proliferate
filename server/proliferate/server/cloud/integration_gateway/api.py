"""Cloud-hosted MCP endpoint for the integration gateway.

AnyHarness connects here as an HTTP MCP server (authenticated by the runtime
gateway token) and drives the three virtual integration tools.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway.dependencies import (
    IntegrationGatewayGrant,
    require_integration_gateway_grant,
)
from proliferate.server.cloud.integration_gateway.domain import json_rpc
from proliferate.server.cloud.integration_gateway.domain.execution_session import (
    ExecutionSessionIdentity,
    mint_execution_session_token,
    verify_execution_session_token,
)
from proliferate.server.cloud.integration_gateway.service import (
    handle_integration_gateway_json_rpc,
)

router = APIRouter(prefix="/integration-gateway", tags=["integration-gateway"])
_MCP_SESSION_HEADER = "Mcp-Session-Id"
_WORKSPACE_HEADER = "Proliferate-Workspace-Id"
_ANYHARNESS_SESSION_HEADER = "Proliferate-Session-Id"


@router.get("/mcp")
async def integration_gateway_mcp_get() -> Response:
    # This server offers no GET event stream; the MCP streamable-HTTP
    # transport requires 405 here so clients stop re-opening the stream.
    return Response(status_code=405, headers={"Allow": "POST"})


async def _dispatch_one(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    message: object,
    execution_session: ExecutionSessionIdentity | None,
) -> dict[str, object] | None:
    if not isinstance(message, dict):
        return json_rpc.invalid_request(None)
    return await handle_integration_gateway_json_rpc(
        db,
        grant=grant,
        payload=message,
        execution_session=execution_session,
    )


def _verified_execution_session(
    request: Request,
    *,
    grant: IntegrationGatewayGrant,
) -> ExecutionSessionIdentity | None:
    token = request.headers.get(_MCP_SESSION_HEADER)
    if token is None:
        return None
    workspace_id = request.headers.get(_WORKSPACE_HEADER)
    anyharness_session_id = request.headers.get(_ANYHARNESS_SESSION_HEADER)
    session_id = verify_execution_session_token(
        secret=settings.cloud_secret_key,
        runtime_worker_id=grant.runtime_worker_id,
        token=token,
        workspace_id=workspace_id,
        anyharness_session_id=anyharness_session_id,
    )
    if session_id is None:
        raise CloudApiError(
            "integration_gateway_session_not_found",
            "Gateway session is invalid or no longer available; initialize again.",
            status_code=404,
        )
    return ExecutionSessionIdentity(
        gateway_session_id=session_id,
        workspace_id=workspace_id,
        anyharness_session_id=anyharness_session_id,
    )


def _contains_initialize(body: object) -> bool:
    messages = body if isinstance(body, list) else [body]
    return any(
        isinstance(message, dict) and message.get("method") == "initialize" for message in messages
    )


@router.post("/mcp")
async def integration_gateway_mcp_post(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    grant: IntegrationGatewayGrant = Depends(require_integration_gateway_grant),
) -> Response:
    try:
        body = await request.json()
    except Exception as error:  # noqa: BLE001 - malformed body -> JSON-RPC parse error
        del error
        return JSONResponse(
            json_rpc.json_rpc_error(
                request_id=None,
                code=json_rpc.PARSE_ERROR,
                message="Could not parse JSON body.",
            )
        )

    execution_session = _verified_execution_session(request, grant=grant)
    response_headers: dict[str, str] = {}
    if _contains_initialize(body):
        try:
            session_token = mint_execution_session_token(
                secret=settings.cloud_secret_key,
                runtime_worker_id=grant.runtime_worker_id,
                workspace_id=request.headers.get(_WORKSPACE_HEADER),
                anyharness_session_id=request.headers.get(_ANYHARNESS_SESSION_HEADER),
            )
        except ValueError as error:
            raise CloudApiError(
                "integration_gateway_launch_identity_invalid",
                "Gateway workspace/session identity is malformed.",
                status_code=400,
            ) from error
        response_headers[_MCP_SESSION_HEADER] = session_token

    if isinstance(body, list):
        responses = [
            response
            for message in body
            if (
                response := await _dispatch_one(
                    db,
                    grant=grant,
                    message=message,
                    execution_session=execution_session,
                )
            )
            is not None
        ]
        if not responses:
            return Response(status_code=202, headers=response_headers)
        return JSONResponse(responses, headers=response_headers)

    response = await _dispatch_one(
        db,
        grant=grant,
        message=body,
        execution_session=execution_session,
    )
    if response is None:
        return Response(status_code=202, headers=response_headers)
    return JSONResponse(response, headers=response_headers)
