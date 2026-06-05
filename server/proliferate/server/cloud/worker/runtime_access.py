"""Worker-managed runtime access updates."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError


async def update_runtime_access_for_managed_worker(
    db: AsyncSession,
    *,
    target_id: UUID,
    sandbox_profile_id: UUID,
    worker_id: UUID,
    now: datetime,
) -> None:
    runtime_access = await targets_store.update_target_runtime_access(
        db,
        target_id=target_id,
        sandbox_profile_id=sandbox_profile_id,
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        worker_id=worker_id,
        heartbeat_at=now,
    )
    if runtime_access is None:
        raise CloudApiError(
            "cloud_worker_target_stale",
            "Worker target is no longer the active managed target.",
            status_code=409,
        )
