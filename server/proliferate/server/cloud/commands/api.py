"""Cloud command queue routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.commands.models import EnqueueCommandRequest, CommandResponse
from proliferate.server.cloud.commands.service import enqueue_cloud_command, get_cloud_command
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error

router = APIRouter(prefix="/commands", tags=["cloud-commands"])


@router.post("", response_model=CommandResponse)
async def enqueue_cloud_command_endpoint(
    body: EnqueueCommandRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> CommandResponse:
    try:
        return await enqueue_cloud_command(
            db,
            user_id=user.id,
            idempotency_key=body.idempotency_key,
            source=body.source,
            target_id=body.target_id,
            workspace_id=body.workspace_id,
            session_id=body.session_id,
            kind=body.kind,
            payload=body.payload,
            observed_event_seq=body.observed_event_seq,
            preconditions=body.preconditions,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/{command_id}", response_model=CommandResponse)
async def get_cloud_command_endpoint(
    command_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> CommandResponse:
    try:
        return await get_cloud_command(db, user_id=user.id, command_id=command_id)
    except CloudApiError as error:
        raise_cloud_error(error)
