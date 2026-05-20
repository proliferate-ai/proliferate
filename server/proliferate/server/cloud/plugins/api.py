from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.mcp_connections.models import OkResponse
from proliferate.server.cloud.plugins.models import (
    PatchPluginConfiguredItemRequest,
    PluginConfiguredItemResponse,
    PluginConfiguredItemsResponse,
    plugin_configured_item_payload,
)
from proliferate.server.cloud.plugins.service import (
    install_plugin,
    list_configured_plugins,
    patch_configured_plugin,
    uninstall_plugin,
)

router = APIRouter(prefix="/plugins", tags=["cloud-plugins"])


@router.get("", response_model=PluginConfiguredItemsResponse)
async def list_configured_plugins_endpoint(
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> PluginConfiguredItemsResponse:
    return PluginConfiguredItemsResponse(
        plugins=[
            plugin_configured_item_payload(item)
            for item in await list_configured_plugins(db, user_id=user.id)
        ]
    )


@router.post("/{plugin_id}/install", response_model=PluginConfiguredItemResponse)
async def install_plugin_endpoint(
    plugin_id: str,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> PluginConfiguredItemResponse:
    try:
        return plugin_configured_item_payload(
            await install_plugin(db, user_id=user.id, plugin_id=plugin_id)
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.patch("/{item_id}", response_model=PluginConfiguredItemResponse)
async def patch_configured_plugin_endpoint(
    item_id: UUID,
    body: PatchPluginConfiguredItemRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> PluginConfiguredItemResponse:
    try:
        return plugin_configured_item_payload(
            await patch_configured_plugin(db, user_id=user.id, item_id=item_id, body=body)
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.delete("/{item_id}", response_model=OkResponse)
async def uninstall_plugin_endpoint(
    item_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OkResponse:
    try:
        await uninstall_plugin(db, user_id=user.id, item_id=item_id)
        return OkResponse()
    except CloudApiError as error:
        raise_cloud_error(error)
