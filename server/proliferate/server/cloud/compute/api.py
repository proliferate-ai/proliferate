"""Cloud compute lifecycle routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.commands.models import CommandResponse
from proliferate.server.cloud.commands.service import enqueue_cloud_command
from proliferate.server.cloud.compute.models import WorkspaceComputeCommandRequest
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error

router = APIRouter(prefix="/compute", tags=["cloud-compute"])


async def _enqueue_compute_command(
    *,
    kind: str,
    workspace_id: UUID,
    body: WorkspaceComputeCommandRequest,
    user: User,
    db: AsyncSession,
) -> CommandResponse:
    return await enqueue_cloud_command(
        db,
        user_id=user.id,
        idempotency_key=body.idempotency_key,
        source="web",
        target_id=body.target_id,
        workspace_id=workspace_id,
        session_id=None,
        kind=kind,
        payload={"reason": body.reason, "force": body.force},
        observed_event_seq=None,
        preconditions={"force": body.force},
    )


@router.post("/workspaces/{workspace_id}/stop", response_model=CommandResponse)
async def stop_workspace_compute_endpoint(
    workspace_id: UUID,
    body: WorkspaceComputeCommandRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> CommandResponse:
    try:
        return await _enqueue_compute_command(
            kind="stop_workspace",
            workspace_id=workspace_id,
            body=body,
            user=user,
            db=db,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces/{workspace_id}/prune", response_model=CommandResponse)
async def prune_workspace_compute_endpoint(
    workspace_id: UUID,
    body: WorkspaceComputeCommandRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> CommandResponse:
    try:
        return await _enqueue_compute_command(
            kind="prune_workspace",
            workspace_id=workspace_id,
            body=body,
            user=user,
            db=db,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
