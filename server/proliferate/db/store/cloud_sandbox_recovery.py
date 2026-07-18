"""Recovery-only persistence for cloud sandbox materialization and cleanup."""

from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import func, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.utils.time import utcnow

# Session-scoped singleton for one provider-account orphan-reap pass. This is
# deliberately distinct from the billing reconciler lock so the two external-
# truth readers never suppress each other.
CLOUD_SANDBOX_ORPHAN_REAPER_LOCK_KEY: Final = 4_203_902


async def try_acquire_cloud_sandbox_orphan_reaper_lock(db: AsyncSession) -> bool:
    result = await db.scalar(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": CLOUD_SANDBOX_ORPHAN_REAPER_LOCK_KEY},
    )
    return bool(result)


async def release_cloud_sandbox_orphan_reaper_lock(db: AsyncSession) -> None:
    await db.execute(
        text("SELECT pg_advisory_unlock(:lock_key)"),
        {"lock_key": CLOUD_SANDBOX_ORPHAN_REAPER_LOCK_KEY},
    )


async def adopt_ambiguous_cloud_sandbox_provider_sandbox(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    e2b_sandbox_id: str,
    expected_materialization_attempt: int,
    expected_provider_observed_at: datetime,
) -> bool:
    """Adopt a candidate only when its pre-create row is still authoritative."""

    now = utcnow()
    adopted_id = (
        await db.execute(
            update(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                CloudSandbox.provider_sandbox_id.is_(None),
                CloudSandbox.status == CloudSandboxStatus.creating,
                CloudSandbox.materialization_attempt == expected_materialization_attempt,
                CloudSandbox.provider_observed_at == expected_provider_observed_at,
            )
            .values(
                provider_sandbox_id=e2b_sandbox_id,
                last_error=None,
                provider_observed_at=func.greatest(
                    CloudSandbox.provider_observed_at,
                    now,
                ),
                updated_at=now,
            )
            .returning(CloudSandbox.id)
        )
    ).scalar_one_or_none()
    return adopted_id is not None
