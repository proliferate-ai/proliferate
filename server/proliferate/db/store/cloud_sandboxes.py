"""Persistence helpers for managed cloud target sandboxes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_profile_target_guard import require_primary_managed_profile_target
from proliferate.utils.time import utcnow

ACTIVE_MANAGED_SANDBOX_STATUSES: tuple[str, ...] = (
    "creating",
    "provisioning",
    "running",
    "paused",
    "blocked",
)


@dataclass(frozen=True)
class CloudSandboxSnapshot:
    id: UUID
    sandbox_profile_id: UUID | None
    target_id: UUID | None
    billing_subject_id: UUID | None
    provider: str
    external_sandbox_id: str | None
    status: str
    template_version: str
    started_at: datetime | None
    stopped_at: datetime | None
    last_heartbeat_at: datetime | None
    lifecycle_on_timeout: str
    lifecycle_auto_resume: bool
    provider_timeout_seconds: int | None
    blocked_reason: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudSandboxOwnerSnapshot:
    id: UUID
    billing_subject_id: UUID
    user_id: UUID


@dataclass(frozen=True)
class CloudSandboxRuntimeOwnerSnapshot:
    runtime_environment: CloudSandboxOwnerSnapshot | None
    workspace: CloudSandboxOwnerSnapshot | None


def _sandbox_snapshot(row: CloudSandbox) -> CloudSandboxSnapshot:
    return CloudSandboxSnapshot(
        id=row.id,
        sandbox_profile_id=row.sandbox_profile_id,
        target_id=row.target_id,
        billing_subject_id=row.billing_subject_id,
        provider=row.provider,
        external_sandbox_id=row.external_sandbox_id,
        status=row.status,
        template_version=row.template_version,
        started_at=row.started_at,
        stopped_at=row.stopped_at,
        last_heartbeat_at=row.last_heartbeat_at,
        lifecycle_on_timeout=row.lifecycle_on_timeout,
        lifecycle_auto_resume=row.lifecycle_auto_resume,
        provider_timeout_seconds=row.provider_timeout_seconds,
        blocked_reason=row.blocked_reason,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _runtime_owner_snapshot(
    row: tuple[UUID, UUID, UUID] | None,
) -> CloudSandboxOwnerSnapshot | None:
    if row is None:
        return None
    owner_id, billing_subject_id, user_id = row
    return CloudSandboxOwnerSnapshot(
        id=owner_id,
        billing_subject_id=billing_subject_id,
        user_id=user_id,
    )


async def load_sandbox_runtime_owner(
    db: AsyncSession,
    sandbox_id: UUID,
) -> CloudSandboxRuntimeOwnerSnapshot:
    runtime_environment = (
        await db.execute(
            select(
                CloudRuntimeEnvironment.id,
                CloudRuntimeEnvironment.billing_subject_id,
                CloudRuntimeEnvironment.user_id,
            )
            .where(CloudRuntimeEnvironment.active_sandbox_id == sandbox_id)
            .limit(1)
        )
    ).one_or_none()
    workspace = (
        await db.execute(
            select(
                CloudWorkspace.id,
                CloudWorkspace.billing_subject_id,
                CloudWorkspace.user_id,
            )
            .where(CloudWorkspace.active_sandbox_id == sandbox_id)
            .limit(1)
        )
    ).one_or_none()
    return CloudSandboxRuntimeOwnerSnapshot(
        runtime_environment=_runtime_owner_snapshot(runtime_environment),
        workspace=_runtime_owner_snapshot(workspace),
    )


async def load_active_sandbox_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> CloudSandboxSnapshot | None:
    row = (
        await db.execute(
            select(CloudSandbox).where(
                CloudSandbox.target_id == target_id,
                CloudSandbox.status.in_(ACTIVE_MANAGED_SANDBOX_STATUSES),
            )
        )
    ).scalar_one_or_none()
    return _sandbox_snapshot(row) if row is not None else None


async def load_active_sandbox_for_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> CloudSandboxSnapshot | None:
    row = (
        await db.execute(
            select(CloudSandbox).where(
                CloudSandbox.sandbox_profile_id == sandbox_profile_id,
                CloudSandbox.target_id == target_id,
                CloudSandbox.status.in_(ACTIVE_MANAGED_SANDBOX_STATUSES),
            )
        )
    ).scalar_one_or_none()
    return _sandbox_snapshot(row) if row is not None else None


async def ensure_managed_sandbox_for_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    billing_subject_id: UUID,
    provider: str = "e2b",
    template_version: str = "managed-cloud-v1",
    status: str = "creating",
    provider_timeout_seconds: int | None = None,
) -> CloudSandboxSnapshot:
    profile, _target = await require_primary_managed_profile_target(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        lock_rows=True,
    )
    if profile.billing_subject_id != billing_subject_id:
        raise ValueError("Managed sandbox billing subject must match sandbox profile.")
    existing = await load_active_sandbox_for_profile_target(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if existing is not None:
        return existing
    now = utcnow()
    row = CloudSandbox(
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        billing_subject_id=billing_subject_id,
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
    return _sandbox_snapshot(row)


async def mark_managed_sandbox_terminal(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    status: str = "killed",
) -> CloudSandboxSnapshot | None:
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None:
        return None
    now = utcnow()
    if row.status in ACTIVE_MANAGED_SANDBOX_STATUSES:
        row.status = status
        row.stopped_at = row.stopped_at or now
    row.updated_at = now
    await db.flush()
    return _sandbox_snapshot(row)
