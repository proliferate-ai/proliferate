"""Persistence helpers for per-org integration policies.

A policy row records an organization's enable/disable decision for a single
integration definition, one row per (organization_id, definition_id).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationPolicy
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class IntegrationPolicyRecord:
    id: UUID
    organization_id: UUID
    definition_id: UUID
    enabled: bool
    updated_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


def _record(policy: CloudIntegrationPolicy) -> IntegrationPolicyRecord:
    return IntegrationPolicyRecord(
        id=policy.id,
        organization_id=policy.organization_id,
        definition_id=policy.definition_id,
        enabled=policy.enabled,
        updated_by_user_id=policy.updated_by_user_id,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


async def list_policies_for_org(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[IntegrationPolicyRecord, ...]:
    policies = (
        (
            await db.execute(
                select(CloudIntegrationPolicy)
                .where(CloudIntegrationPolicy.organization_id == organization_id)
                .order_by(CloudIntegrationPolicy.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_record(policy) for policy in policies)


async def get_policy(
    db: AsyncSession,
    organization_id: UUID,
    definition_id: UUID,
) -> IntegrationPolicyRecord | None:
    policy = (
        await db.execute(
            select(CloudIntegrationPolicy).where(
                CloudIntegrationPolicy.organization_id == organization_id,
                CloudIntegrationPolicy.definition_id == definition_id,
            )
        )
    ).scalar_one_or_none()
    return _record(policy) if policy is not None else None


async def upsert_policy(
    db: AsyncSession,
    *,
    organization_id: UUID,
    definition_id: UUID,
    enabled: bool,
    updated_by_user_id: UUID,
) -> IntegrationPolicyRecord:
    policy = (
        await db.execute(
            select(CloudIntegrationPolicy)
            .where(
                CloudIntegrationPolicy.organization_id == organization_id,
                CloudIntegrationPolicy.definition_id == definition_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if policy is None:
        policy = CloudIntegrationPolicy(
            organization_id=organization_id,
            definition_id=definition_id,
            enabled=enabled,
            updated_by_user_id=updated_by_user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(policy)
    else:
        policy.enabled = enabled
        policy.updated_by_user_id = updated_by_user_id
        policy.updated_at = now
    await db.flush()
    await db.refresh(policy)
    return _record(policy)
