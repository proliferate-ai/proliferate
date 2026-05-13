"""Cloud target registry orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync.targets import (
    create_enrollment_token,
    get_target,
    get_target_inventory,
    get_target_status,
    list_targets_for_org,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.targets.models import (
    EnrollmentResponse,
    TargetSummary,
    target_summary_payload,
)


async def create_target_enrollment(
    db: AsyncSession,
    *,
    user_id: UUID,
    target_kind: str,
    display_name: str,
    access_scope: str,
    ttl_minutes: int,
) -> EnrollmentResponse:
    token = await create_enrollment_token(
        db,
        org_id=user_id,
        created_by_user_id=user_id,
        target_kind=target_kind,
        display_name=display_name,
        access_scope=access_scope,
        ttl_minutes=ttl_minutes,
    )
    return EnrollmentResponse(
        enrollment_id=token.id,
        target_id=token.target_id,
        token=token.token,
        expires_at=token.expires_at,
    )


async def list_targets(db: AsyncSession, *, user_id: UUID) -> list[TargetSummary]:
    targets = await list_targets_for_org(db, user_id)
    payloads: list[TargetSummary] = []
    for target in targets:
        payloads.append(
            target_summary_payload(
                target,
                status=await get_target_status(db, target.id),
                inventory=await get_target_inventory(db, target.id),
            )
        )
    return payloads


async def get_target_detail(
    db: AsyncSession,
    *,
    user_id: UUID,
    target_id: UUID,
) -> TargetSummary:
    target = await get_target(db, target_id)
    if target is None or target.org_id != user_id:
        raise CloudApiError("target_not_found", "Target not found.", status_code=404)
    return target_summary_payload(
        target,
        status=await get_target_status(db, target.id),
        inventory=await get_target_inventory(db, target.id),
    )
