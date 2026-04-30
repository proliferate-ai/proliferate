"""Persistence helpers for cloud workspaces."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import ACTIVE_SANDBOX_STATUSES
from proliferate.constants.cloud import (
    WORKSPACE_REPO_APPLY_LOCK_SALT,
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
    WorkspaceStatus,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import (
    CloudSandbox,
    CloudWorkspace,
)
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_runtime_environments import (
    ensure_runtime_environment_for_repo,
)
from proliferate.utils.time import utcnow

_UNSET: Final = object()


def _workspace_repo_apply_lock_key(workspace_id: UUID) -> int:
    prefix = int.from_bytes(workspace_id.bytes[:8], byteorder="big", signed=False)
    return (prefix ^ WORKSPACE_REPO_APPLY_LOCK_SALT) & ((1 << 63) - 1)


async def list_cloud_workspaces(db: AsyncSession, user_id: UUID) -> list[CloudWorkspace]:
    return list(
        (
            await db.execute(
                select(CloudWorkspace)
                .where(CloudWorkspace.user_id == user_id, CloudWorkspace.archived_at.is_(None))
                .order_by(CloudWorkspace.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def get_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.id == workspace_id,
                CloudWorkspace.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def get_cloud_workspace_by_id(
    db: AsyncSession,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()


async def get_existing_cloud_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.user_id == user_id,
                CloudWorkspace.git_provider == git_provider,
                CloudWorkspace.git_owner == git_owner,
                CloudWorkspace.git_repo_name == git_repo_name,
                CloudWorkspace.git_branch == git_branch,
                CloudWorkspace.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def create_cloud_workspace_record(
    db: AsyncSession,
    *,
    user_id: UUID,
    display_name: str | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    git_base_branch: str,
    origin_json: str | None,
    template_version: str,
    repo_env_vars_ciphertext: str | None = None,
) -> CloudWorkspace:
    now = utcnow()
    billing_subject = await ensure_personal_billing_subject(db, user_id)
    runtime_environment = await ensure_runtime_environment_for_repo(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        created_by_user_id=user_id,
    )
    workspace = CloudWorkspace(
        user_id=user_id,
        billing_subject_id=runtime_environment.billing_subject_id or billing_subject.id,
        runtime_environment_id=runtime_environment.id,
        display_name=display_name,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
        git_base_branch=git_base_branch,
        origin_json=origin_json,
        status=CloudWorkspaceStatus.pending.value,
        status_detail="Pending",
        last_error=None,
        template_version=template_version,
        runtime_generation=0,
        repo_env_vars_ciphertext=repo_env_vars_ciphertext,
        repo_files_applied_version=0,
        repo_setup_applied_version=0,
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        repo_files_last_failed_path=None,
        repo_files_last_error=None,
        cleanup_state=CloudWorkspaceCleanupState.none.value,
        created_at=now,
        updated_at=now,
    )
    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def delete_cloud_workspace_records(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    workspace.archive_requested_at = workspace.archive_requested_at or utcnow()
    workspace.archived_at = utcnow()
    workspace.status = CloudWorkspaceStatus.archived.value
    workspace.status_detail = "Archived"
    workspace.cleanup_state = CloudWorkspaceCleanupState.pending.value
    workspace.updated_at = utcnow()
    await db.commit()


async def get_active_sandbox(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudSandbox | None:
    """Load the active sandbox for *workspace*, if one exists."""
    if not workspace.active_sandbox_id:
        return None
    return (
        await db.execute(
            select(CloudSandbox).where(CloudSandbox.id == workspace.active_sandbox_id)
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


async def reserve_sandbox_slot_for_workspace(
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
                .join(CloudWorkspace, CloudSandbox.cloud_workspace_id == CloudWorkspace.id)
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
        cloud_workspace_id=workspace_id,
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
    await db.commit()
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
    """Update sandbox status and commit."""
    sandbox.status = status
    sandbox.updated_at = utcnow()
    if started_at is not None:
        sandbox.started_at = started_at
    if stopped_at_now:
        sandbox.stopped_at = utcnow()
    await db.commit()


async def persist_workspace_record(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    workspace.updated_at = utcnow()
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def persist_workspace_stop(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    """Commit the workspace after the service has applied the ready transition."""
    await db.commit()


async def persist_workspace_destroy(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    """Clear runtime metadata and commit after the service has applied the stopped transition."""
    workspace.active_sandbox_id = None
    workspace.runtime_url = None
    workspace.runtime_token_ciphertext = None
    workspace.anyharness_workspace_id = None
    workspace.stopped_at = utcnow()
    await db.commit()


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
    await db.commit()
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
    await db.commit()
    await db.refresh(sandbox)
    return sandbox


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
    workspace.runtime_generation = workspace.runtime_generation + 1
    workspace.status = WorkspaceStatus.ready
    workspace.status_detail = "Ready"
    workspace.ready_at = utcnow()
    workspace.updated_at = utcnow()
    await db.commit()
    await db.refresh(workspace)
    await db.refresh(sandbox)
    return workspace


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
    await db.commit()
    await db.refresh(workspace)
    await db.refresh(sandbox)
    return sandbox


async def persist_workspace_status(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    return await persist_workspace_record(db, workspace)


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
    await db.commit()


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
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def update_workspace_status_by_id(
    workspace_id: UUID,
    status: CloudWorkspaceStatus | WorkspaceStatus | str,
    status_detail: str,
) -> None:
    async with db_engine.async_session_factory() as db:
        await update_workspace_status(db, workspace_id, status, status_detail)


@asynccontextmanager
async def workspace_repo_apply_lock(workspace_id: UUID) -> AsyncIterator[bool]:
    async with db_engine.async_session_factory() as db:
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
    await db.commit()


async def list_cloud_workspaces_for_user(user_id: UUID) -> list[CloudWorkspace]:
    async with db_engine.async_session_factory() as db:
        return await list_cloud_workspaces(db, user_id)


async def load_cloud_workspace_for_user(
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        return await get_cloud_workspace_for_user(db, user_id, workspace_id)


async def load_cloud_workspace_by_id(
    workspace_id: UUID,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        return await get_cloud_workspace_by_id(db, workspace_id)


async def load_existing_cloud_workspace(
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        return await get_existing_cloud_workspace(
            db,
            user_id=user_id,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
        )


async def load_any_cloud_workspace_for_repo(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        return (
            await db.execute(
                select(CloudWorkspace)
                .where(
                    CloudWorkspace.user_id == user_id,
                    CloudWorkspace.git_owner == git_owner,
                    CloudWorkspace.git_repo_name == git_repo_name,
                )
                .order_by(CloudWorkspace.updated_at.desc())
            )
        ).scalar_one_or_none()


async def create_cloud_workspace_for_user(
    *,
    user_id: UUID,
    display_name: str | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    git_base_branch: str,
    origin_json: str | None,
    template_version: str,
    repo_env_vars_ciphertext: str | None = None,
) -> CloudWorkspace:
    async with db_engine.async_session_factory() as db:
        return await create_cloud_workspace_record(
            db,
            user_id=user_id,
            display_name=display_name,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
            git_base_branch=git_base_branch,
            origin_json=origin_json,
            template_version=template_version,
            repo_env_vars_ciphertext=repo_env_vars_ciphertext,
        )


async def load_active_sandbox_for_workspace(
    workspace: CloudWorkspace,
) -> CloudSandbox | None:
    if not workspace.active_sandbox_id:
        return None
    async with db_engine.async_session_factory() as db:
        return await db.get(CloudSandbox, workspace.active_sandbox_id)


async def load_cloud_sandbox_by_id(
    sandbox_id: UUID,
) -> CloudSandbox | None:
    async with db_engine.async_session_factory() as db:
        return await get_cloud_sandbox_by_id(db, sandbox_id)


async def load_cloud_sandbox_by_external_id(
    external_sandbox_id: str,
) -> CloudSandbox | None:
    async with db_engine.async_session_factory() as db:
        return await get_cloud_sandbox_by_external_id(db, external_sandbox_id)


async def load_cloud_sandbox_placeholders() -> list[CloudSandbox]:
    async with db_engine.async_session_factory() as db:
        return await list_cloud_sandbox_placeholders(db)


async def save_workspace(
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    async with db_engine.async_session_factory() as db:
        merged = await db.merge(workspace)
        return await persist_workspace_record(db, merged)


async def save_workspace_branch_for_user(
    *,
    user_id: UUID,
    workspace_id: UUID,
    branch_name: str,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        workspace = await get_cloud_workspace_for_user(db, user_id, workspace_id)
        if workspace is None:
            return None
        workspace.git_branch = branch_name
        workspace.updated_at = utcnow()
        await db.commit()
        await db.refresh(workspace)
        return workspace


async def save_workspace_display_name_for_user(
    *,
    user_id: UUID,
    workspace_id: UUID,
    display_name: str | None,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        workspace = await get_cloud_workspace_for_user(db, user_id, workspace_id)
        if workspace is None:
            return None
        workspace.display_name = display_name
        workspace.updated_at = utcnow()
        await db.commit()
        await db.refresh(workspace)
        return workspace


async def reserve_and_attach_sandbox_for_workspace(
    workspace_id: UUID,
    *,
    external_sandbox_id: str | None,
    provider: str,
    template_version: str,
    status: str = "provisioning",
    started_at: datetime | None = None,
    concurrent_sandbox_limit: int | None,
) -> CloudSandbox | None:
    async with db_engine.async_session_factory() as db:
        return await reserve_sandbox_slot_for_workspace(
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
    sandbox_id: UUID,
    *,
    external_sandbox_id: str,
    status: str = "provisioning",
    started_at: datetime | None,
) -> CloudSandbox:
    async with db_engine.async_session_factory() as db:
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


async def finalize_workspace_provision_for_ids(
    workspace_id: UUID,
    sandbox_record_id: UUID,
    *,
    runtime_url: str,
    runtime_token_ciphertext: str,
    anyharness_workspace_id: str,
    template_version: str,
) -> CloudWorkspace:
    async with db_engine.async_session_factory() as db:
        workspace = await get_cloud_workspace_by_id(db, workspace_id)
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
    workspace_id: UUID,
    *,
    repo_files_applied_version: int | object = _UNSET,
    repo_files_applied_at: datetime | None | object = _UNSET,
    repo_post_ready_phase: str | object = _UNSET,
    repo_post_ready_files_total: int | object = _UNSET,
    repo_post_ready_files_applied: int | object = _UNSET,
    repo_post_ready_started_at: datetime | None | object = _UNSET,
    repo_post_ready_completed_at: datetime | None | object = _UNSET,
    repo_files_last_failed_path: str | None | object = _UNSET,
    repo_files_last_error: str | None | object = _UNSET,
    status_detail: str | None | object = _UNSET,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        return await update_workspace_repo_apply_status(
            db,
            workspace_id,
            repo_files_applied_version=repo_files_applied_version,
            repo_files_applied_at=repo_files_applied_at,
            repo_post_ready_phase=repo_post_ready_phase,
            repo_post_ready_files_total=repo_post_ready_files_total,
            repo_post_ready_files_applied=repo_post_ready_files_applied,
            repo_post_ready_started_at=repo_post_ready_started_at,
            repo_post_ready_completed_at=repo_post_ready_completed_at,
            repo_files_last_failed_path=repo_files_last_failed_path,
            repo_files_last_error=repo_files_last_error,
            status_detail=status_detail,
        )


async def persist_workspace_stop_state(
    workspace: CloudWorkspace,
) -> None:
    async with db_engine.async_session_factory() as db:
        merged = await db.merge(workspace)
        await persist_workspace_stop(db, merged)


async def persist_workspace_destroy_state(
    workspace: CloudWorkspace,
) -> None:
    async with db_engine.async_session_factory() as db:
        merged = await db.merge(workspace)
        await persist_workspace_destroy(db, merged)


async def update_sandbox_status(
    sandbox: CloudSandbox,
    status: str,
    *,
    stopped_at_now: bool = False,
    started_at: datetime | None = None,
) -> None:
    async with db_engine.async_session_factory() as db:
        merged = await db.merge(sandbox)
        await persist_sandbox_status(
            db,
            merged,
            status,
            stopped_at_now=stopped_at_now,
            started_at=started_at,
        )


async def persist_runtime_reconnect_state_for_workspace(
    workspace: CloudWorkspace,
    sandbox: CloudSandbox,
    *,
    restarted_runtime: bool,
    runtime_url: str | None = None,
) -> CloudSandbox:
    async with db_engine.async_session_factory() as db:
        merged_workspace = await db.merge(workspace)
        merged_sandbox = await db.merge(sandbox)
        return await persist_runtime_reconnect_state(
            db,
            merged_workspace,
            merged_sandbox,
            restarted_runtime=restarted_runtime,
            runtime_url=runtime_url,
        )


async def delete_cloud_workspace_records_for_workspace(
    workspace: CloudWorkspace,
) -> None:
    async with db_engine.async_session_factory() as db:
        merged = await db.merge(workspace)
        await delete_cloud_workspace_records(db, merged)


async def mark_workspace_error_by_id(
    workspace_id: UUID,
    message: str,
    *,
    status_detail: str = "Provisioning failed",
    clear_runtime_metadata: bool = True,
    clear_active_sandbox: bool = False,
) -> None:
    async with db_engine.async_session_factory() as db:
        await mark_workspace_error(
            db,
            workspace_id,
            message,
            status_detail=status_detail,
            clear_runtime_metadata=clear_runtime_metadata,
            clear_active_sandbox=clear_active_sandbox,
        )


async def save_sandbox_provider_state(
    sandbox_id: UUID,
    *,
    external_sandbox_id: str | None | object = _UNSET,
    status: str | None | object = _UNSET,
    started_at: datetime | None | object = _UNSET,
    stopped_at: datetime | None | object = _UNSET,
    last_provider_event_at: datetime | None | object = _UNSET,
    last_provider_event_kind: str | None | object = _UNSET,
) -> CloudSandbox:
    async with db_engine.async_session_factory() as db:
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
