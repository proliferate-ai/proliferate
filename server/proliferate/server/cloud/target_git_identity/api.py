"""Worker routes for target-level Git identity materialization."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.target_git_identity.models import (
    TargetGitIdentityMaterializationPlan,
    WorkerTargetGitIdentityStatusRequest,
    WorkerTargetGitIdentityStatusResponse,
)
from proliferate.server.cloud.target_git_identity.service import (
    record_worker_target_git_identity_status,
    worker_target_git_identity_plan,
)
from proliferate.server.cloud.worker.auth import authenticate_worker

worker_router = APIRouter(
    prefix="/worker/target-git-identities",
    tags=["cloud-worker-target-git-identity"],
)


@worker_router.get(
    "/{identity_id}/materialization",
    response_model=TargetGitIdentityMaterializationPlan,
)
async def worker_target_git_identity_materialization_endpoint(
    identity_id: UUID,
    command_id: UUID,
    config_version: int,
    lease_id: str,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> TargetGitIdentityMaterializationPlan:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await worker_target_git_identity_plan(
            db,
            auth=auth,
            identity_id=identity_id,
            command_id=command_id,
            config_version=config_version,
            lease_id=lease_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@worker_router.post(
    "/{identity_id}/status",
    response_model=WorkerTargetGitIdentityStatusResponse,
)
async def worker_target_git_identity_status_endpoint(
    identity_id: UUID,
    body: WorkerTargetGitIdentityStatusRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerTargetGitIdentityStatusResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_worker_target_git_identity_status(
            db,
            auth=auth,
            identity_id=identity_id,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
