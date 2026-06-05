"""Shared worker target validation helpers."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudTargetStatus
from proliferate.db.store.cloud_sync import targets as targets_store
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
