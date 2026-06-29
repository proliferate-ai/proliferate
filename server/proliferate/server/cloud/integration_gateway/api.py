from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway.dependencies import (
    integration_gateway_grant_from_request,
)
from proliferate.server.cloud.integration_gateway.service import (
    handle_integration_gateway_json_rpc,
)

router = APIRouter(prefix="/integration-gateway", tags=["integration-gateway"])


@router.get("/mcp", include_in_schema=False)
async def integration_gateway_mcp_get() -> Response:
    return Response(status_code=204)


@router.post("/mcp")
async def integration_gateway_mcp_post(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> object:
    grant = integration_gateway_grant_from_request(request)
    payload = await request.json()
    if isinstance(payload, list):
        responses = []
        for item in payload:
            if not isinstance(item, dict):
                responses.append(
                    {
                        "jsonrpc": "2.0",
                        "id": None,
                        "error": {"code": -32600, "message": "Invalid request."},
                    }
                )
                continue
            response = await handle_integration_gateway_json_rpc(db, grant=grant, payload=item)
            if response is not None:
                responses.append(response)
        return responses
    if not isinstance(payload, dict):
        raise CloudApiError(
            "invalid_payload", "MCP request must be a JSON object.", status_code=400
        )
    response = await handle_integration_gateway_json_rpc(db, grant=grant, payload=payload)
    if response is None:
        return Response(status_code=202)
    return response
