"""HTTP routes for cloud compute targets."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.targets.models import (
    ArchiveCloudTargetResponse,
    CloudTargetDetail,
    CloudTargetEnrollmentRequest,
    CloudTargetEnrollmentResponse,
    CloudTargetSummary,
    target_detail_payload,
    target_summary_payload,
)
from proliferate.server.cloud.targets.service import (
    archive_target,
    create_target_enrollment,
    get_target_detail,
    list_targets,
)

router = APIRouter(prefix="/targets", tags=["cloud-targets"])


@router.post("/enrollments", response_model=CloudTargetEnrollmentResponse)
async def create_target_enrollment_endpoint(
    body: CloudTargetEnrollmentRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudTargetEnrollmentResponse:
    try:
        return await create_target_enrollment(db, user=user, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("", response_model=list[CloudTargetSummary])
async def list_targets_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> list[CloudTargetSummary]:
    values = await list_targets(db, user_id=user.id)
    return [target_summary_payload(value) for value in values]


@router.get("/{target_id}", response_model=CloudTargetDetail)
async def get_target_endpoint(
    target_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudTargetDetail:
    try:
        value = await get_target_detail(db, target_id=target_id, user_id=user.id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return target_detail_payload(value)


@router.post("/{target_id}/archive", response_model=ArchiveCloudTargetResponse)
async def archive_target_endpoint(
    target_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> ArchiveCloudTargetResponse:
    try:
        value = await archive_target(db, target_id=target_id, user=user)
    except CloudApiError as error:
        raise_cloud_error(error)
    return ArchiveCloudTargetResponse(target=target_detail_payload(value))
