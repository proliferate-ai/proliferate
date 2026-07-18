"""Recovery-only compare-and-set writes for cloud sandbox materialization."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.utils.time import utcnow


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
