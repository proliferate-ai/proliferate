"""Shared worker target validation helpers."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudTargetStatus
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext


def require_current_worker_target(target: targets_store.CloudTargetSnapshot) -> None:
    if target.archived_at is not None or target.status == CloudTargetStatus.archived.value:
        raise CloudApiError(
            "cloud_worker_target_archived",
            "Worker target is archived.",
            status_code=409,
        )


async def require_active_worker_target(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    target: targets_store.CloudTargetSnapshot | None = None,
) -> targets_store.CloudTargetSnapshot:
    current_target = target or await targets_store.get_target_by_id(db, auth.target_id)
    if current_target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    require_current_worker_target(current_target)
    return current_target


def require_enrollment_profile_for_target(
    *,
    enrollment: worker_auth_store.CloudTargetEnrollmentSnapshot,
    target: targets_store.CloudTargetSnapshot,
) -> None:
    if target.sandbox_profile_id is None:
        return
    if enrollment.sandbox_profile_id != target.sandbox_profile_id:
        raise CloudApiError(
            "cloud_worker_profile_identity_required",
            "Managed cloud worker enrollment does not match the target sandbox profile.",
            status_code=409,
        )


def _optional_uuid(value: str | None, *, field_name: str) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(value)
    except ValueError as exc:
        raise CloudApiError(
            "cloud_worker_invalid_uuid",
            f"{field_name} must be a UUID.",
            status_code=400,
        ) from exc


def worker_request_profile_id(
    *,
    target: targets_store.CloudTargetSnapshot,
    sandbox_profile_id: str | None,
) -> UUID | None:
    if target.sandbox_profile_id is None:
        return None
    if sandbox_profile_id is None:
        return target.sandbox_profile_id
    reported_profile_id = _optional_uuid(
        sandbox_profile_id,
        field_name="sandboxProfileId",
    )
    if reported_profile_id != target.sandbox_profile_id:
        raise CloudApiError(
            "cloud_worker_profile_identity_required",
            "Managed cloud worker request must match the target sandboxProfileId.",
            status_code=409,
        )
    return reported_profile_id
