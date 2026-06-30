from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationPolicy
from proliferate.db.store.cloud_integrations.types import IntegrationPolicyRecord
from proliferate.utils.time import utcnow


def _policy_record(row: CloudIntegrationPolicy) -> IntegrationPolicyRecord:
    return IntegrationPolicyRecord(
        id=row.id,
        organization_id=row.organization_id,
        definition_id=row.definition_id,
        enabled=row.enabled,
        updated_by_user_id=row.updated_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_organization_policies(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[IntegrationPolicyRecord, ...]:
    rows = (
        (
            await db.execute(
                select(CloudIntegrationPolicy).where(
                    CloudIntegrationPolicy.organization_id == organization_id
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(_policy_record(row) for row in rows)


async def upsert_organization_policy(
    db: AsyncSession,
    *,
    organization_id: UUID,
    definition_id: UUID,
    enabled: bool,
    updated_by_user_id: UUID,
) -> IntegrationPolicyRecord:
    row = (
        await db.execute(
            select(CloudIntegrationPolicy).where(
                CloudIntegrationPolicy.organization_id == organization_id,
                CloudIntegrationPolicy.definition_id == definition_id,
            )
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = CloudIntegrationPolicy(
            organization_id=organization_id,
            definition_id=definition_id,
            enabled=enabled,
            updated_by_user_id=updated_by_user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.enabled = enabled
        row.updated_by_user_id = updated_by_user_id
        row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _policy_record(row)
