"""HTTP routes for cloud compute targets (minimal direct-runtime slice).

Enrollment mints the per-runtime AnyHarness bearer; it surfaces exactly
twice — in the enrollment response (once, for the Desktop installer flow)
and via the owner-gated runtime-access endpoint (direct attach). List and
detail payloads never carry it.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.targets.models import (
    CloudTargetDetail,
    CloudTargetEnrollmentRequest,
    CloudTargetEnrollmentResponse,
    CloudTargetExistingEnrollmentRequest,
    CloudTargetRuntimeAccessResponse,
    CloudTargetSummary,
    target_detail_payload,
    target_summary_payload,
)
from proliferate.server.cloud.targets.service import (
    create_target_enrollment,
    create_target_enrollment_for_existing_target,
    get_target_detail,
    get_target_runtime_access,
    list_targets,
)

router = APIRouter(prefix="/targets", tags=["cloud-targets"])


@router.post("", response_model=CloudTargetEnrollmentResponse)
async def create_target_enrollment_endpoint(
    body: CloudTargetEnrollmentRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudTargetEnrollmentResponse:
    try:
        return await create_target_enrollment(db, user=user, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/{target_id}/enrollments", response_model=CloudTargetEnrollmentResponse)
async def create_existing_target_enrollment_endpoint(
    target_id: UUID,
    body: CloudTargetExistingEnrollmentRequest | None = None,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudTargetEnrollmentResponse:
    try:
        return await create_target_enrollment_for_existing_target(
            db,
            target_id=target_id,
            user=user,
            body=body or CloudTargetExistingEnrollmentRequest(),
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("", response_model=list[CloudTargetSummary])
async def list_targets_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> list[CloudTargetSummary]:
    values = await list_targets(db, user_id=user.id)
    return [target_summary_payload(value) for value in values]


@router.get("/{target_id}", response_model=CloudTargetDetail)
async def get_target_endpoint(
    target_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudTargetDetail:
    try:
        value = await get_target_detail(db, target_id=target_id, user_id=user.id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return target_detail_payload(value)


@router.get("/{target_id}/runtime-access", response_model=CloudTargetRuntimeAccessResponse)
async def get_target_runtime_access_endpoint(
    target_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudTargetRuntimeAccessResponse:
    try:
        bearer = await get_target_runtime_access(db, target_id=target_id, user_id=user.id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return CloudTargetRuntimeAccessResponse(anyharness_bearer_token=bearer)
