"""Persistence for organization integration catalog policy."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudOrganizationIntegrationPolicy
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudOrganizationIntegrationPolicyRecord:
    id: UUID
    organization_id: UUID
    catalog_entry_id: str
    enabled: bool
    updated_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime


def _record(
    row: CloudOrganizationIntegrationPolicy,
) -> CloudOrganizationIntegrationPolicyRecord:
    return CloudOrganizationIntegrationPolicyRecord(
        id=row.id,
        organization_id=row.organization_id,
        catalog_entry_id=row.catalog_entry_id,
        enabled=row.enabled,
        updated_by_user_id=row.updated_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_organization_integration_policy(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[CloudOrganizationIntegrationPolicyRecord, ...]:
    rows = (
        (
            await db.execute(
                select(CloudOrganizationIntegrationPolicy)
                .where(CloudOrganizationIntegrationPolicy.organization_id == organization_id)
                .order_by(CloudOrganizationIntegrationPolicy.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_record(row) for row in rows)


async def upsert_organization_integration_policy(
    db: AsyncSession,
    *,
    organization_id: UUID,
    catalog_entry_id: str,
    enabled: bool,
    updated_by_user_id: UUID,
) -> CloudOrganizationIntegrationPolicyRecord:
    now = utcnow()
    await db.execute(
        pg_insert(CloudOrganizationIntegrationPolicy)
        .values(
            organization_id=organization_id,
            catalog_entry_id=catalog_entry_id,
            enabled=enabled,
            updated_by_user_id=updated_by_user_id,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_cloud_org_integration_policy_entry",
            set_={
                "enabled": enabled,
                "updated_by_user_id": updated_by_user_id,
                "updated_at": now,
            },
        )
    )
    row = (
        await db.execute(
            select(CloudOrganizationIntegrationPolicy).where(
                CloudOrganizationIntegrationPolicy.organization_id == organization_id,
                CloudOrganizationIntegrationPolicy.catalog_entry_id == catalog_entry_id,
            )
        )
    ).scalar_one()
    return _record(row)
