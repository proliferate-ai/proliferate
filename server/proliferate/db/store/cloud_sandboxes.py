"""Persistence helpers for managed cloud sandbox slots."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import ACTIVE_MANAGED_CLOUD_SLOT_STATUSES
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store.cloud_profile_target_guard import require_primary_managed_profile_target
from proliferate.db.store.cloud_sync.sandbox_profile_target_state import (
    invalidate_applied_on_slot_replacement,
)
from proliferate.utils.time import utcnow

@dataclass(frozen=True)
class SlotSnapshot:
    id: UUID
    sandbox_profile_id: UUID | None
    target_id: UUID | None
    billing_subject_id: UUID | None
    slot_generation: int | None
    provider: str
    external_sandbox_id: str | None
    status: str
    template_version: str
    superseded_by_sandbox_id: UUID | None
    superseded_at: datetime | None
    lifecycle_on_timeout: str
    lifecycle_auto_resume: bool
    provider_timeout_seconds: int | None
    blocked_reason: str | None
    created_at: datetime
    updated_at: datetime


def _slot_snapshot(row: CloudSandbox) -> SlotSnapshot:
    return SlotSnapshot(
        id=row.id,
        sandbox_profile_id=row.sandbox_profile_id,
        target_id=row.target_id,
        billing_subject_id=row.billing_subject_id,
        slot_generation=row.slot_generation,
        provider=row.provider,
        external_sandbox_id=row.external_sandbox_id,
        status=row.status,
        template_version=row.template_version,
        superseded_by_sandbox_id=row.superseded_by_sandbox_id,
        superseded_at=row.superseded_at,
        lifecycle_on_timeout=row.lifecycle_on_timeout,
        lifecycle_auto_resume=row.lifecycle_auto_resume,
        provider_timeout_seconds=row.provider_timeout_seconds,
        blocked_reason=row.blocked_reason,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def load_active_slot_for_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> SlotSnapshot | None:
    row = (
        await db.execute(
            select(CloudSandbox).where(
                CloudSandbox.sandbox_profile_id == sandbox_profile_id,
                CloudSandbox.target_id == target_id,
                CloudSandbox.superseded_at.is_(None),
                CloudSandbox.status.in_(ACTIVE_MANAGED_CLOUD_SLOT_STATUSES),
            )
        )
    ).scalar_one_or_none()
    return _slot_snapshot(row) if row is not None else None


async def ensure_profile_slot(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    provider: str = "e2b",
    template_version: str = "managed-cloud-v1",
    status: str = "creating",
    provider_timeout_seconds: int | None = None,
) -> SlotSnapshot:
    profile, _target = await require_primary_managed_profile_target(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        lock_rows=True,
    )
    existing = await load_active_slot_for_profile_target(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if existing is not None:
        return existing
    max_generation = (
        await db.scalar(
            select(func.max(CloudSandbox.slot_generation)).where(
                CloudSandbox.sandbox_profile_id == sandbox_profile_id,
                CloudSandbox.target_id == target_id,
            )
        )
        or 0
    )
    now = utcnow()
    row = CloudSandbox(
        runtime_environment_id=None,
        cloud_workspace_id=None,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        billing_subject_id=profile.billing_subject_id,
        slot_generation=int(max_generation) + 1,
        provider=provider,
        external_sandbox_id=None,
        status=status,
        template_version=template_version,
        lifecycle_on_timeout="pause",
        lifecycle_auto_resume=True,
        provider_timeout_seconds=provider_timeout_seconds,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _slot_snapshot(row)


async def supersede_slot(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    superseded_by_sandbox_id: UUID | None = None,
    status: str = "killed",
) -> SlotSnapshot | None:
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None:
        return None
    row.superseded_at = row.superseded_at or utcnow()
    row.superseded_by_sandbox_id = superseded_by_sandbox_id
    if row.status in ACTIVE_MANAGED_CLOUD_SLOT_STATUSES:
        row.status = status
    row.updated_at = utcnow()
    await db.flush()
    if row.sandbox_profile_id is not None and row.target_id is not None:
        await invalidate_applied_on_slot_replacement(
            db,
            sandbox_profile_id=row.sandbox_profile_id,
            target_id=row.target_id,
        )
    return _slot_snapshot(row)
