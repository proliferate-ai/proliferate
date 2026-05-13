"""Cloud target registry routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.targets.models import (
    CreateEnrollmentRequest,
    EnrollmentResponse,
    TargetSummary,
)
from proliferate.server.cloud.targets.service import (
    create_target_enrollment,
    get_target_detail,
    list_targets,
)

router = APIRouter(prefix="/targets", tags=["cloud-targets"])


@router.post("/enrollments", response_model=EnrollmentResponse)
async def create_target_enrollment_endpoint(
    body: CreateEnrollmentRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> EnrollmentResponse:
    try:
        return await create_target_enrollment(
            db,
            user_id=user.id,
            target_kind=body.target_kind,
            display_name=body.display_name,
            access_scope=body.access_scope,
            ttl_minutes=body.ttl_minutes,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("", response_model=list[TargetSummary])
async def list_targets_endpoint(
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[TargetSummary]:
    try:
        return await list_targets(db, user_id=user.id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/{target_id}", response_model=TargetSummary)
async def get_target_endpoint(
    target_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> TargetSummary:
    try:
        return await get_target_detail(db, user_id=user.id, target_id=target_id)
    except CloudApiError as error:
        raise_cloud_error(error)
