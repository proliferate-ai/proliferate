"""HTTP routes for cloud compute operations."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.compute.models import (
    RevokeWorkersResponse,
    SafeStopCheckResponse,
    SetDesiredVersionsRequest,
    SetDesiredVersionsResponse,
)
from proliferate.server.cloud.compute.service import (
    check_safe_stop,
    revoke_workers_for_target,
    set_desired_versions,
)
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error

router = APIRouter(prefix="/compute", tags=["cloud-compute"])


@router.post(
    "/targets/{target_id}/desired-versions",
    response_model=SetDesiredVersionsResponse,
)
async def set_target_desired_versions_endpoint(
    target_id: UUID,
    body: SetDesiredVersionsRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> SetDesiredVersionsResponse:
    try:
        return await set_desired_versions(db, target_id=target_id, user=user, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/targets/{target_id}/safe-stop-check",
    response_model=SafeStopCheckResponse,
)
async def safe_stop_check_endpoint(
    target_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> SafeStopCheckResponse:
    try:
        return await check_safe_stop(db, target_id=target_id, user=user)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/targets/{target_id}/revoke-workers",
    response_model=RevokeWorkersResponse,
)
async def revoke_workers_endpoint(
    target_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> RevokeWorkersResponse:
    try:
        return await revoke_workers_for_target(db, target_id=target_id, user=user)
    except CloudApiError as error:
        raise_cloud_error(error)
