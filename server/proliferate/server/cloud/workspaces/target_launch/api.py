from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.workspaces.target_launch.models import (
    LaunchWorkspaceOnTargetRequest,
    WorkspaceTargetLaunchResponse,
)
from proliferate.server.cloud.workspaces.target_launch.service import launch_workspace_on_target

router = APIRouter()


@router.post("/workspaces/target-launch", response_model=WorkspaceTargetLaunchResponse)
async def launch_workspace_on_target_endpoint(
    body: LaunchWorkspaceOnTargetRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceTargetLaunchResponse:
    try:
        return await launch_workspace_on_target(db, user, body)
    except CloudApiError as error:
        log_cloud_event(
            "cloud workspace target launch rejected",
            error_code=error.code,
            status_code=error.status_code,
            target_id=body.target_id,
        )
        raise_cloud_error(error)
