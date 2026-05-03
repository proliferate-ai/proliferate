from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.mcp_connections.models import OkResponse
from proliferate.server.cloud.mcp_custom_definitions.models import (
    CreateCustomMcpDefinitionRequest,
    CustomMcpDefinitionsResponse,
    CustomMcpDefinitionSummaryModel,
    PatchCustomMcpDefinitionRequest,
)
from proliferate.server.cloud.mcp_custom_definitions.service import (
    create_custom_mcp_definition,
    delete_custom_mcp_definition,
    list_custom_mcp_definitions,
    patch_custom_mcp_definition,
)

router = APIRouter(prefix="/mcp/custom-definitions", tags=["cloud_mcp_custom_definitions"])


@router.get("", response_model=CustomMcpDefinitionsResponse)
async def list_custom_mcp_definitions_endpoint(
    user: User = Depends(current_active_user),
) -> CustomMcpDefinitionsResponse:
    try:
        return await list_custom_mcp_definitions(user.id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("", response_model=CustomMcpDefinitionSummaryModel)
async def create_custom_mcp_definition_endpoint(
    body: CreateCustomMcpDefinitionRequest,
    user: User = Depends(current_active_user),
) -> CustomMcpDefinitionSummaryModel:
    try:
        return await create_custom_mcp_definition(user.id, body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.patch("/{definition_id}", response_model=CustomMcpDefinitionSummaryModel)
async def patch_custom_mcp_definition_endpoint(
    definition_id: str,
    body: PatchCustomMcpDefinitionRequest,
    user: User = Depends(current_active_user),
) -> CustomMcpDefinitionSummaryModel:
    try:
        return await patch_custom_mcp_definition(user.id, definition_id, body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.delete("/{definition_id}", response_model=OkResponse)
async def delete_custom_mcp_definition_endpoint(
    definition_id: str,
    user: User = Depends(current_active_user),
) -> OkResponse:
    try:
        await delete_custom_mcp_definition(user.id, definition_id)
        return OkResponse()
    except CloudApiError as error:
        raise_cloud_error(error)
