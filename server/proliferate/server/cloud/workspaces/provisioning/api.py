from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import OwnerSelection
from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.workspaces.models import (
    CreateCloudWorkspaceRequest,
    WorkspaceDetail,
)
from proliferate.server.cloud.workspaces.provisioning.service import (
    create_cloud_workspace,
    start_cloud_workspace,
)

router = APIRouter()


@router.post("/workspaces", response_model=WorkspaceDetail)
async def create_cloud_workspace_endpoint(
    body: CreateCloudWorkspaceRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        payload = await create_cloud_workspace(
            user,
            db=db,
            git_provider=body.git_provider,
            git_owner=body.git_owner,
            git_repo_name=body.git_repo_name,
            base_branch=body.base_branch,
            branch_name=body.branch_name,
            display_name=body.display_name,
            generated_name=body.generated_name,
            required_agent_kind=body.required_agent_kind,
            source=body.source or "desktop",
            owner_selection=OwnerSelection(
                owner_scope=body.owner_scope,
                organization_id=body.organization_id,
            ),
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload


@router.post("/workspaces/{workspace_id}/start", response_model=WorkspaceDetail)
async def start_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        payload = await start_cloud_workspace(db, user, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload
