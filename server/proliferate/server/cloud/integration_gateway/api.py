"""Cloud-hosted MCP endpoint for the integration gateway.

AnyHarness connects here as an HTTP MCP server (authenticated by the runtime
gateway token) and drives the three virtual integration tools.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.integration_gateway.dependencies import (
    IntegrationGatewayGrant,
    require_integration_gateway_grant,
)
from proliferate.server.cloud.integration_gateway.domain import json_rpc
from proliferate.server.cloud.integration_gateway.service import (
    handle_integration_gateway_json_rpc,
)

router = APIRouter(prefix="/integration-gateway", tags=["integration-gateway"])


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
) -> dict[str, object] | None:
    if not isinstance(message, dict):
        return json_rpc.invalid_request(None)
    return await handle_integration_gateway_json_rpc(db, grant=grant, payload=message)


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

    if isinstance(body, list):
        responses = [
            response
            for message in body
            if (response := await _dispatch_one(db, grant=grant, message=message)) is not None
        ]
        if not responses:
            return Response(status_code=202)
        return JSONResponse(responses)

    response = await _dispatch_one(db, grant=grant, message=body)
    if response is None:
        return Response(status_code=202)
    return JSONResponse(response)
