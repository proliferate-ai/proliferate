"""Persistence helpers for cloud workspace runtime state."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudWorkspaceCleanupState,
    WORKSPACE_REPO_APPLY_LOCK_SALT,
    CloudWorkspaceStatus,
    WorkspaceStatus,
)
from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow

_UNSET: Final = object()


def _workspace_repo_apply_lock_key(workspace_id: UUID) -> int:
    prefix = int.from_bytes(workspace_id.bytes[:8], byteorder="big", signed=False)
    return (prefix ^ WORKSPACE_REPO_APPLY_LOCK_SALT) & ((1 << 63) - 1)


async def _get_cloud_workspace_by_id(
    db: AsyncSession,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()


async def persist_workspace_record(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    workspace.updated_at = utcnow()
    await db.flush()
    await db.refresh(workspace)
    return workspace


async def persist_workspace_stop(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    await db.flush()


async def persist_workspace_destroy(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    """Clear runtime metadata after the service has applied the stopped transition."""
    workspace.active_sandbox_id = None
    workspace.runtime_url = None
    workspace.runtime_token_ciphertext = None
    workspace.anyharness_workspace_id = None
    workspace.stopped_at = utcnow()
    await db.flush()


async def finalize_workspace_provision(
    db: AsyncSession,
    workspace: CloudWorkspace,
    sandbox: CloudSandbox,
    *,
    runtime_url: str,
    runtime_token_ciphertext: str,
    anyharness_workspace_id: str,
    template_version: str,
) -> CloudWorkspace:
    sandbox.status = "running"
    sandbox.last_heartbeat_at = utcnow()
    sandbox.updated_at = utcnow()
    sandbox.template_version = template_version
    workspace.runtime_url = runtime_url
    workspace.runtime_token_ciphertext = runtime_token_ciphertext
    workspace.anyharness_workspace_id = anyharness_workspace_id
    workspace.template_version = template_version
    workspace.materialized_target_id = sandbox.target_id
    workspace.runtime_generation = workspace.runtime_generation + 1
    workspace.status = WorkspaceStatus.ready
    workspace.status_detail = "Ready"
    workspace.ready_at = utcnow()
    workspace.updated_at = utcnow()
    await _ensure_ready_workspace_exposure(
        db,
        workspace=workspace,
        anyharness_workspace_id=anyharness_workspace_id,
    )
    await db.flush()
    await db.refresh(workspace)
    await db.refresh(sandbox)
    return workspace


async def _ensure_ready_workspace_exposure(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
    anyharness_workspace_id: str,
) -> None:
    if workspace.target_id is None:
        return
    if workspace.owner_scope == "personal":
        if workspace.owner_user_id is None:
            raise RuntimeError("Personal cloud workspace is missing owner_user_id.")
        owner_user_id = workspace.owner_user_id
        organization_id = None
        visibility = "private"
    elif workspace.owner_scope == "organization":
        if workspace.organization_id is None:
            raise RuntimeError("Organization cloud workspace is missing organization_id.")
        owner_user_id = None
        organization_id = workspace.organization_id
        visibility = "shared_unclaimed"
    else:
        raise RuntimeError(f"Unsupported cloud workspace owner_scope: {workspace.owner_scope}")

    now = utcnow()
    exposure = (
        await db.execute(
            select(CloudWorkspaceExposure)
            .where(CloudWorkspaceExposure.target_id == workspace.target_id)
            .where(CloudWorkspaceExposure.cloud_workspace_id == workspace.id)
            .where(CloudWorkspaceExposure.archived_at.is_(None))
            .with_for_update()
            .limit(1)
        )
    ).scalar_one_or_none()
    if exposure is None:
        db.add(
            CloudWorkspaceExposure(
                target_id=workspace.target_id,
                cloud_workspace_id=workspace.id,
                anyharness_workspace_id=anyharness_workspace_id,
                owner_scope=workspace.owner_scope,
                owner_user_id=owner_user_id,
                organization_id=organization_id,
                visibility=visibility,
                claimed_by_user_id=None,
                default_projection_level="live",
                commandable=True,
                status="active",
                revision=1,
                origin=workspace.origin,
                created_at=now,
                updated_at=now,
            )
        )
        await db.flush()
        return

    changed = False
    for attr, value in (
        ("anyharness_workspace_id", anyharness_workspace_id),
        ("owner_scope", workspace.owner_scope),
        ("owner_user_id", owner_user_id),
        ("organization_id", organization_id),
        ("origin", workspace.origin),
    ):
        if getattr(exposure, attr) != value:
            setattr(exposure, attr, value)
            changed = True
    if exposure.status != "active":
        exposure.status = "active"
        changed = True
    if not exposure.commandable:
        exposure.commandable = True
        changed = True
    if changed:
        exposure.revision += 1
        exposure.updated_at = now
    await db.flush()


async def persist_runtime_reconnect_state(
    db: AsyncSession,
    workspace: CloudWorkspace,
    sandbox: CloudSandbox,
    *,
    restarted_runtime: bool,
    runtime_url: str | None = None,
) -> CloudSandbox:
    sandbox.status = "running"
    sandbox.last_heartbeat_at = utcnow()
    sandbox.updated_at = utcnow()
    workspace.status = WorkspaceStatus.ready
    workspace.status_detail = "Ready"
    workspace.last_error = None
    if runtime_url is not None:
        workspace.runtime_url = runtime_url
    workspace.updated_at = utcnow()
    if restarted_runtime:
        workspace.runtime_generation = workspace.runtime_generation + 1
    await db.flush()
    await db.refresh(workspace)
    await db.refresh(sandbox)
    return sandbox


async def update_workspace_status(
    db: AsyncSession,
    workspace_id: UUID,
    status: CloudWorkspaceStatus | WorkspaceStatus | str,
    status_detail: str,
) -> None:
    """Update workspace status by ID without requiring an attached ORM object."""
    workspace = (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()
    if workspace is None:
        return
    workspace.status = status.value if hasattr(status, "value") else str(status)
    workspace.status_detail = status_detail
    workspace.updated_at = utcnow()
    await db.flush()


async def attach_anyharness_workspace_id(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    anyharness_workspace_id: str,
    status: CloudWorkspaceStatus | WorkspaceStatus | str = CloudWorkspaceStatus.ready,
    status_detail: str = "Ready",
    worktree_path: str | None | object = _UNSET,
    runtime_generation: int | object = _UNSET,
) -> CloudWorkspace | None:
    workspace = (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()
    if workspace is None:
        return None
    workspace.anyharness_workspace_id = anyharness_workspace_id
    workspace.materialized_target_id = workspace.target_id
    if worktree_path is not _UNSET:
        workspace.worktree_path = worktree_path
    if runtime_generation is not _UNSET:
        workspace.runtime_generation = int(runtime_generation)
    workspace.status = status.value if hasattr(status, "value") else str(status)
    workspace.status_detail = status_detail
    workspace.last_error = None
    workspace.ready_at = workspace.ready_at or utcnow()
    workspace.updated_at = utcnow()
    await _ensure_ready_workspace_exposure(
        db,
        workspace=workspace,
        anyharness_workspace_id=anyharness_workspace_id,
    )
    await db.flush()
    return workspace


async def attach_anyharness_workspace_id_to_managed_repo_workspaces(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    anyharness_workspace_id: str,
    preferred_branch: str | None = None,
) -> int:
    workspaces = list(
        (
            await db.execute(
                select(CloudWorkspace)
                .where(CloudWorkspace.owner_scope == "personal")
                .where(CloudWorkspace.owner_user_id == user_id)
                .where(CloudWorkspace.git_owner == git_owner)
                .where(CloudWorkspace.git_repo_name == git_repo_name)
                .where(CloudWorkspace.sandbox_profile_id.is_not(None))
                .where(CloudWorkspace.target_id.is_not(None))
                .where(CloudWorkspace.archived_at.is_(None))
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    changed_count = 0
    now = utcnow()
    preferred = (preferred_branch or "").strip()
    canonical_workspaces = [
        workspace
        for workspace in workspaces
        if not preferred or workspace.git_branch == preferred
    ]

    for workspace in canonical_workspaces:
        changed = False
        if workspace.anyharness_workspace_id != anyharness_workspace_id:
            workspace.anyharness_workspace_id = anyharness_workspace_id
            changed = True
        if workspace.materialized_target_id != workspace.target_id:
            workspace.materialized_target_id = workspace.target_id
            changed = True
        if workspace.status != CloudWorkspaceStatus.ready.value:
            workspace.status = CloudWorkspaceStatus.ready.value
            changed = True
        if workspace.status_detail != "Ready":
            workspace.status_detail = "Ready"
            changed = True
        if workspace.last_error is not None:
            workspace.last_error = None
            changed = True
        if workspace.ready_at is None:
            workspace.ready_at = now
            changed = True
        if changed:
            workspace.updated_at = now
            changed_count += 1
        await _ensure_ready_workspace_exposure(
            db,
            workspace=workspace,
            anyharness_workspace_id=anyharness_workspace_id,
        )
    await db.flush()
    return changed_count


async def _archive_stale_managed_workspace_projection(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
    now: datetime,
) -> bool:
    changed = False
    if workspace.archive_requested_at is None:
        workspace.archive_requested_at = now
        changed = True
    if workspace.archived_at is None:
        workspace.archived_at = now
        changed = True
    if workspace.status != CloudWorkspaceStatus.archived.value:
        workspace.status = CloudWorkspaceStatus.archived.value
        changed = True
    if workspace.status_detail != "Archived":
        workspace.status_detail = "Archived"
        changed = True
    if workspace.cleanup_state != CloudWorkspaceCleanupState.complete.value:
        workspace.cleanup_state = CloudWorkspaceCleanupState.complete.value
        changed = True
    if changed:
        workspace.updated_at = now

    exposures = list(
        (
            await db.execute(
                select(CloudWorkspaceExposure)
                .where(CloudWorkspaceExposure.cloud_workspace_id == workspace.id)
                .where(CloudWorkspaceExposure.archived_at.is_(None))
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for exposure in exposures:
        exposure.visibility = "archived"
        exposure.status = "revoked"
        exposure.commandable = False
        exposure.revision += 1
        exposure.archived_at = now
        exposure.updated_at = now
        changed = True
    return changed


async def try_acquire_workspace_repo_apply_lock(
    db: AsyncSession,
    workspace_id: UUID,
) -> bool:
    result = await db.scalar(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": _workspace_repo_apply_lock_key(workspace_id)},
    )
    return bool(result)


async def release_workspace_repo_apply_lock(
    db: AsyncSession,
    workspace_id: UUID,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_unlock(:lock_key)"),
        {"lock_key": _workspace_repo_apply_lock_key(workspace_id)},
    )


async def update_workspace_repo_apply_status(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    repo_files_applied_version: int | object = _UNSET,
    repo_files_applied_at: datetime | None | object = _UNSET,
    repo_post_ready_phase: str | object = _UNSET,
    repo_post_ready_files_total: int | object = _UNSET,
    repo_post_ready_files_applied: int | object = _UNSET,
    repo_post_ready_apply_token: str | None | object = _UNSET,
    repo_post_ready_started_at: datetime | None | object = _UNSET,
    repo_post_ready_completed_at: datetime | None | object = _UNSET,
    repo_files_last_failed_path: str | None | object = _UNSET,
    repo_files_last_error: str | None | object = _UNSET,
    status_detail: str | None | object = _UNSET,
) -> CloudWorkspace | None:
    workspace = (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()
    if workspace is None:
        return None
    if repo_files_applied_version is not _UNSET:
        workspace.repo_files_applied_version = repo_files_applied_version
    if repo_files_applied_at is not _UNSET:
        workspace.repo_files_applied_at = repo_files_applied_at
    if repo_post_ready_phase is not _UNSET:
        workspace.repo_post_ready_phase = repo_post_ready_phase
    if repo_post_ready_files_total is not _UNSET:
        workspace.repo_post_ready_files_total = repo_post_ready_files_total
    if repo_post_ready_files_applied is not _UNSET:
        workspace.repo_post_ready_files_applied = repo_post_ready_files_applied
    if repo_post_ready_apply_token is not _UNSET:
        workspace.repo_post_ready_apply_token = repo_post_ready_apply_token
    if repo_post_ready_started_at is not _UNSET:
        workspace.repo_post_ready_started_at = repo_post_ready_started_at
    if repo_post_ready_completed_at is not _UNSET:
        workspace.repo_post_ready_completed_at = repo_post_ready_completed_at
    if repo_files_last_failed_path is not _UNSET:
        workspace.repo_files_last_failed_path = repo_files_last_failed_path
    if repo_files_last_error is not _UNSET:
        workspace.repo_files_last_error = (
            repo_files_last_error[:2000] if isinstance(repo_files_last_error, str) else None
        )
    if status_detail is not _UNSET:
        workspace.status_detail = status_detail
    workspace.updated_at = utcnow()
    await db.flush()
    await db.refresh(workspace)
    return workspace


async def update_workspace_status_by_id(
    db: AsyncSession,
    workspace_id: UUID,
    status: CloudWorkspaceStatus | WorkspaceStatus | str,
    status_detail: str,
) -> None:
    await update_workspace_status(db, workspace_id, status, status_detail)


@asynccontextmanager
async def workspace_repo_apply_lock(
    db: AsyncSession,
    workspace_id: UUID,
) -> AsyncIterator[bool]:
    acquired = await try_acquire_workspace_repo_apply_lock(db, workspace_id)
    try:
        yield acquired
    finally:
        if acquired:
            await release_workspace_repo_apply_lock(db, workspace_id)


async def mark_workspace_error(
    db: AsyncSession,
    workspace_id: UUID,
    message: str,
    *,
    status_detail: str = "Provisioning failed",
    clear_runtime_metadata: bool = True,
    clear_active_sandbox: bool = False,
) -> None:
    """Persist an error status on the workspace and its active sandbox."""
    workspace = (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()
    if workspace is None:
        return
    workspace.status = WorkspaceStatus.error
    workspace.status_detail = status_detail
    workspace.last_error = message[:2000]
    workspace.updated_at = utcnow()
    if clear_runtime_metadata:
        workspace.runtime_url = None
        workspace.runtime_token_ciphertext = None
        workspace.anyharness_workspace_id = None
    if clear_active_sandbox:
        workspace.active_sandbox_id = None

    if workspace.active_sandbox_id:
        sandbox = (
            await db.execute(
                select(CloudSandbox).where(CloudSandbox.id == workspace.active_sandbox_id)
            )
        ).scalar_one_or_none()
        if sandbox is not None:
            sandbox.status = "error"
            sandbox.updated_at = utcnow()
    await db.flush()


async def save_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    merged = await db.merge(workspace)
    return await persist_workspace_record(db, merged)


async def finalize_workspace_provision_for_ids(
    db: AsyncSession,
    workspace_id: UUID,
    sandbox_record_id: UUID,
    *,
    runtime_url: str,
    runtime_token_ciphertext: str,
    anyharness_workspace_id: str,
    template_version: str,
) -> CloudWorkspace:
    workspace = await _get_cloud_workspace_by_id(db, workspace_id)
    sandbox = await db.get(CloudSandbox, sandbox_record_id)
    if workspace is None or sandbox is None:
        raise RuntimeError("Workspace or sandbox record disappeared before finalization.")
    return await finalize_workspace_provision(
        db,
        workspace,
        sandbox,
        runtime_url=runtime_url,
        runtime_token_ciphertext=runtime_token_ciphertext,
        anyharness_workspace_id=anyharness_workspace_id,
        template_version=template_version,
    )


async def update_workspace_repo_apply_status_by_id(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    repo_files_applied_version: int | object = _UNSET,
    repo_files_applied_at: datetime | None | object = _UNSET,
    repo_post_ready_phase: str | object = _UNSET,
    repo_post_ready_files_total: int | object = _UNSET,
    repo_post_ready_files_applied: int | object = _UNSET,
    repo_post_ready_apply_token: str | None | object = _UNSET,
    repo_post_ready_started_at: datetime | None | object = _UNSET,
    repo_post_ready_completed_at: datetime | None | object = _UNSET,
    repo_files_last_failed_path: str | None | object = _UNSET,
    repo_files_last_error: str | None | object = _UNSET,
    status_detail: str | None | object = _UNSET,
) -> CloudWorkspace | None:
    return await update_workspace_repo_apply_status(
        db,
        workspace_id,
        repo_files_applied_version=repo_files_applied_version,
        repo_files_applied_at=repo_files_applied_at,
        repo_post_ready_phase=repo_post_ready_phase,
        repo_post_ready_files_total=repo_post_ready_files_total,
        repo_post_ready_files_applied=repo_post_ready_files_applied,
        repo_post_ready_apply_token=repo_post_ready_apply_token,
        repo_post_ready_started_at=repo_post_ready_started_at,
        repo_post_ready_completed_at=repo_post_ready_completed_at,
        repo_files_last_failed_path=repo_files_last_failed_path,
        repo_files_last_error=repo_files_last_error,
        status_detail=status_detail,
    )


async def persist_runtime_reconnect_state_for_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
    sandbox: CloudSandbox,
    *,
    restarted_runtime: bool,
    runtime_url: str | None = None,
) -> CloudSandbox:
    merged_workspace = await db.merge(workspace)
    merged_sandbox = await db.merge(sandbox)
    return await persist_runtime_reconnect_state(
        db,
        merged_workspace,
        merged_sandbox,
        restarted_runtime=restarted_runtime,
        runtime_url=runtime_url,
    )


async def mark_workspace_error_by_id(
    db: AsyncSession,
    workspace_id: UUID,
    message: str,
    *,
    status_detail: str = "Provisioning failed",
    clear_runtime_metadata: bool = True,
    clear_active_sandbox: bool = False,
) -> None:
    await mark_workspace_error(
        db,
        workspace_id,
        message,
        status_detail=status_detail,
        clear_runtime_metadata=clear_runtime_metadata,
        clear_active_sandbox=clear_active_sandbox,
    )
