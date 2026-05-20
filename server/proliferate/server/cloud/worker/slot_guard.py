"""Shared active-slot fencing for worker-authenticated Cloud routes."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_profile_target_guard import managed_profile_target_requires_slot
from proliferate.db.store.cloud_sandboxes import load_active_slot_for_profile_target
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext


def target_requires_worker_slot(target: targets_store.CloudTargetSnapshot) -> bool:
    return managed_profile_target_requires_slot(
        kind=target.kind,
        sandbox_profile_id=target.sandbox_profile_id,
        profile_target_role=target.profile_target_role,
    )


async def require_current_managed_worker_slot(
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
    if not target_requires_worker_slot(current_target):
        return current_target
    if (
        current_target.sandbox_profile_id is None
        or auth.cloud_sandbox_id is None
        or auth.slot_generation is None
    ):
        raise CloudApiError(
            "cloud_worker_slot_identity_required",
            "Managed cloud worker is missing sandbox slot identity.",
            status_code=409,
        )
    active_slot = await load_active_slot_for_profile_target(
        db,
        sandbox_profile_id=current_target.sandbox_profile_id,
        target_id=current_target.id,
    )
    if (
        active_slot is None
        or active_slot.id != auth.cloud_sandbox_id
        or active_slot.slot_generation != auth.slot_generation
    ):
        raise CloudApiError(
            "cloud_worker_slot_stale",
            "Worker slot identity is no longer the active sandbox slot.",
            status_code=409,
        )
    return current_target
