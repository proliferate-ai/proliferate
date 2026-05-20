"""Protocol facade routes for the agent model gateway."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.engine import get_async_session
from proliferate.server.agent_gateway.errors import AgentGatewayError
from proliferate.server.agent_gateway.models import (
    GatewayForwardResponse,
    GatewayForwardStream,
)
from proliferate.server.agent_gateway.service import (
    forward_gateway_request,
    list_gateway_models,
)

router = APIRouter(tags=["agent_gateway"])

_PROTOCOL_HEADER_ALLOWLIST = frozenset(
    {
        "anthropic-version",
        "anthropic-beta",
        "openai-beta",
    }
)


@router.get("/agent-gateway/health")
async def agent_gateway_health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/anthropic/v1/models", include_in_schema=False)
async def anthropic_models(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> JSONResponse:
    result = await list_gateway_models(
        db,
        raw_token=_bearer_token(request),
        gateway_path=request.url.path,
    )
    return JSONResponse(
        {
            "data": [
                {
                    "id": model_id,
                    "type": "model",
                    "display_name": model_id,
                }
                for model_id in result.model_ids
            ],
            "has_more": False,
        }
    )


@router.get("/openai/v1/models", include_in_schema=False)
async def openai_models(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> JSONResponse:
    result = await list_gateway_models(
        db,
        raw_token=_bearer_token(request),
        gateway_path=request.url.path,
    )
    return JSONResponse(
        {
            "object": "list",
            "data": [
                {
                    "id": model_id,
                    "object": "model",
                    "owned_by": "proliferate",
                }
                for model_id in result.model_ids
            ],
        }
    )


@router.post("/anthropic/v1/messages", include_in_schema=False)
@router.post("/anthropic/v1/messages/count_tokens", include_in_schema=False)
@router.post("/openai/v1/responses", include_in_schema=False)
@router.post("/openai/v1/chat/completions", include_in_schema=False)
async def forward_protocol_request(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    result = await forward_gateway_request(
        db,
        raw_token=_bearer_token(request),
        gateway_path=request.url.path,
        query_string=request.url.query,
        method=request.method,
        body=await _limited_request_body(request),
        content_type=request.headers.get("content-type"),
        protocol_headers=_protocol_headers(request),
    )
    if isinstance(result, GatewayForwardStream):
        return StreamingResponse(
            result.chunks,
            status_code=result.status_code,
            headers=result.headers,
            media_type=result.headers.get("content-type", "text/event-stream"),
        )
    if isinstance(result, GatewayForwardResponse):
        return Response(
            content=result.content,
            status_code=result.status_code,
            headers=result.headers,
            media_type=result.headers.get("content-type", "application/json"),
        )
    raise AssertionError("Unexpected gateway response type.")


def _bearer_token(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return ""
    return authorization[len(prefix) :].strip()


def _protocol_headers(request: Request) -> dict[str, str]:
    return {
        key.lower(): value
        for key, value in request.headers.items()
        if key.lower() in _PROTOCOL_HEADER_ALLOWLIST
    }


async def _limited_request_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > settings.agent_gateway_max_request_bytes:
            raise AgentGatewayError(
                "Gateway request body is too large.",
                code="gateway_request_too_large",
                status_code=413,
            )
    return bytes(body)
