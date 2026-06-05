"""Persistence helpers for managed cloud target sandboxes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import ACTIVE_SANDBOX_STATUSES
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_profile_target_guard import require_primary_managed_profile_target
from proliferate.db.store.cloud_workspaces import get_cloud_workspace_by_id
from proliferate.utils.time import utcnow

_UNSET: Final = object()

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


async def get_active_sandbox(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudSandbox | None:
    """Load the active sandbox for *workspace*, if one exists."""
    if workspace.active_sandbox_id:
        sandbox = (
            await db.execute(
                select(CloudSandbox).where(CloudSandbox.id == workspace.active_sandbox_id)
            )
        ).scalar_one_or_none()
        if sandbox is not None:
            return sandbox
    return await _get_active_profile_target_sandbox(db, workspace)


async def _get_active_profile_target_sandbox(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudSandbox | None:
    if workspace.sandbox_profile_id is None or workspace.target_id is None:
        return None
    return (
        await db.execute(
            select(CloudSandbox)
            .where(
                CloudSandbox.sandbox_profile_id == workspace.sandbox_profile_id,
                CloudSandbox.target_id == workspace.target_id,
                CloudSandbox.status.in_(ACTIVE_SANDBOX_STATUSES),
            )
            .order_by(CloudSandbox.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def get_cloud_sandbox_by_id(
    db: AsyncSession,
    sandbox_id: UUID,
) -> CloudSandbox | None:
    return await db.get(CloudSandbox, sandbox_id)


async def get_cloud_sandbox_by_external_id(
    db: AsyncSession,
    external_sandbox_id: str,
) -> CloudSandbox | None:
    return (
        await db.execute(
            select(CloudSandbox).where(CloudSandbox.external_sandbox_id == external_sandbox_id)
        )
    ).scalar_one_or_none()


async def list_cloud_sandbox_placeholders(
    db: AsyncSession,
) -> list[CloudSandbox]:
    return list(
        (await db.execute(select(CloudSandbox).where(CloudSandbox.external_sandbox_id.is_(None))))
        .scalars()
        .all()
    )


async def reserve_sandbox_for_workspace(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    external_sandbox_id: str | None,
    provider: str,
    template_version: str,
    status: str,
    started_at: datetime | None,
    concurrent_sandbox_limit: int | None,
) -> CloudSandbox | None:
    workspace = await get_cloud_workspace_by_id(db, workspace_id)
    if workspace is None:
        raise RuntimeError("Workspace disappeared before sandbox attachment.")

    if concurrent_sandbox_limit is not None:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
            {"lock_key": f"billing-subject:{workspace.billing_subject_id}"},
        )
        active_sandbox_count = int(
            await db.scalar(
                select(func.count(CloudSandbox.id))
                .join(CloudWorkspace, CloudWorkspace.active_sandbox_id == CloudSandbox.id)
                .where(
                    CloudWorkspace.billing_subject_id == workspace.billing_subject_id,
                    CloudSandbox.status.in_(ACTIVE_SANDBOX_STATUSES),
                )
            )
            or 0
        )
        if active_sandbox_count >= concurrent_sandbox_limit:
            return None

    now = utcnow()
    sandbox = CloudSandbox(
        provider=provider,
        external_sandbox_id=external_sandbox_id,
        status=status,
        template_version=template_version,
        started_at=started_at,
        created_at=now,
        updated_at=now,
    )
    db.add(sandbox)
    await db.flush()
    workspace.active_sandbox_id = sandbox.id
    workspace.updated_at = now
    await db.flush()
    await db.refresh(sandbox)
    return sandbox


async def persist_sandbox_status(
    db: AsyncSession,
    sandbox: CloudSandbox,
    status: str,
    *,
    stopped_at_now: bool = False,
    started_at: datetime | None = None,
) -> None:
    """Update sandbox status."""
    sandbox.status = status
    sandbox.updated_at = utcnow()
    if started_at is not None:
        sandbox.started_at = started_at
    if stopped_at_now:
        sandbox.stopped_at = utcnow()
    await db.flush()


async def persist_bound_sandbox(
    db: AsyncSession,
    sandbox: CloudSandbox,
    *,
    external_sandbox_id: str,
    status: str,
    started_at: datetime | None,
) -> CloudSandbox:
    sandbox.external_sandbox_id = external_sandbox_id
    sandbox.status = status
    sandbox.started_at = started_at
    sandbox.stopped_at = None
    sandbox.updated_at = utcnow()
    await db.flush()
    await db.refresh(sandbox)
    return sandbox


async def persist_sandbox_provider_state(
    db: AsyncSession,
    sandbox: CloudSandbox,
    *,
    external_sandbox_id: str | None | object = _UNSET,
    status: str | None | object = _UNSET,
    started_at: datetime | None | object = _UNSET,
    stopped_at: datetime | None | object = _UNSET,
    last_provider_event_at: datetime | None | object = _UNSET,
    last_provider_event_kind: str | None | object = _UNSET,
) -> CloudSandbox:
    if external_sandbox_id is not _UNSET:
        sandbox.external_sandbox_id = external_sandbox_id
    if status is not _UNSET:
        sandbox.status = status
    if started_at is not _UNSET:
        sandbox.started_at = started_at
    if stopped_at is not _UNSET:
        sandbox.stopped_at = stopped_at
    if last_provider_event_at is not _UNSET:
        sandbox.last_provider_event_at = last_provider_event_at
    if last_provider_event_kind is not _UNSET:
        sandbox.last_provider_event_kind = last_provider_event_kind
    sandbox.updated_at = utcnow()
    await db.flush()
    await db.refresh(sandbox)
    return sandbox


async def load_active_sandbox_for_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudSandbox | None:
    return await get_active_sandbox(db, workspace)


async def load_cloud_sandbox_by_id(
    db: AsyncSession,
    sandbox_id: UUID,
) -> CloudSandbox | None:
    return await get_cloud_sandbox_by_id(db, sandbox_id)


async def load_cloud_sandbox_by_external_id(
    db: AsyncSession,
    external_sandbox_id: str,
) -> CloudSandbox | None:
    return await get_cloud_sandbox_by_external_id(db, external_sandbox_id)


async def load_cloud_sandbox_placeholders(db: AsyncSession) -> list[CloudSandbox]:
    return await list_cloud_sandbox_placeholders(db)


async def reserve_and_attach_sandbox_for_workspace(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    external_sandbox_id: str | None,
    provider: str,
    template_version: str,
    status: str = "provisioning",
    started_at: datetime | None = None,
    concurrent_sandbox_limit: int | None,
) -> CloudSandbox | None:
    return await reserve_sandbox_for_workspace(
        db,
        workspace_id=workspace_id,
        external_sandbox_id=external_sandbox_id,
        provider=provider,
        template_version=template_version,
        status=status,
        started_at=started_at,
        concurrent_sandbox_limit=concurrent_sandbox_limit,
    )


async def bind_allocated_sandbox(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    external_sandbox_id: str,
    status: str = "provisioning",
    started_at: datetime | None,
) -> CloudSandbox:
    sandbox = await get_cloud_sandbox_by_id(db, sandbox_id)
    if sandbox is None:
        raise RuntimeError("Sandbox placeholder disappeared before provider allocation.")
    return await persist_bound_sandbox(
        db,
        sandbox,
        external_sandbox_id=external_sandbox_id,
        status=status,
        started_at=started_at,
    )


async def update_sandbox_status(
    db: AsyncSession,
    sandbox: CloudSandbox,
    status: str,
    *,
    stopped_at_now: bool = False,
    started_at: datetime | None = None,
) -> None:
    merged = await db.merge(sandbox)
    await persist_sandbox_status(
        db,
        merged,
        status,
        stopped_at_now=stopped_at_now,
        started_at=started_at,
    )


async def save_sandbox_provider_state(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    external_sandbox_id: str | None | object = _UNSET,
    status: str | None | object = _UNSET,
    started_at: datetime | None | object = _UNSET,
    stopped_at: datetime | None | object = _UNSET,
    last_provider_event_at: datetime | None | object = _UNSET,
    last_provider_event_kind: str | None | object = _UNSET,
) -> CloudSandbox:
    sandbox = await get_cloud_sandbox_by_id(db, sandbox_id)
    if sandbox is None:
        raise RuntimeError("Sandbox record not found.")
    return await persist_sandbox_provider_state(
        db,
        sandbox,
        external_sandbox_id=external_sandbox_id,
        status=status,
        started_at=started_at,
        stopped_at=stopped_at,
        last_provider_event_at=last_provider_event_at,
        last_provider_event_kind=last_provider_event_kind,
    )
