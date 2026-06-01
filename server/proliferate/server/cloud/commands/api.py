"""HTTP routes for cloud commands."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.commands.models import (
    CloudCommandResponse,
    CreateCloudCommandRequest,
    command_response_payload,
)
from proliferate.server.cloud.commands.service import get_command_status
from proliferate.server.cloud.commands.transactions import enqueue_command_and_commit
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.event_logging import log_cloud_event

router = APIRouter(prefix="/commands", tags=["cloud-commands"])


@router.post("", response_model=CloudCommandResponse)
async def enqueue_command_endpoint(
    body: CreateCloudCommandRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudCommandResponse:
    try:
        command = await enqueue_command_and_commit(db, user=user, body=body)
    except CloudApiError as error:
        log_cloud_event(
            "cloud command enqueue rejected",
            error_code=error.code,
            status_code=error.status_code,
            target_id=body.target_id,
            kind=body.kind,
            source=body.source,
            workspace_id=body.workspace_id,
            cloud_workspace_id=body.cloud_workspace_id,
            session_id=body.session_id,
        )
        raise_cloud_error(error)
    return command_response_payload(command)


@router.get("/{command_id}", response_model=CloudCommandResponse)
async def get_command_status_endpoint(
    command_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudCommandResponse:
    try:
        command = await get_command_status(db, command_id=command_id, user_id=user.id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return command_response_payload(command)
