"""Persistence helpers for cloud workspace creation."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
    WorkspacePostReadyPhase,
)
from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing import (
    acquire_billing_subject_repo_limit_lock,
    cloud_repo_slot_exists,
    count_active_cloud_repo_environments,
)
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.cloud_runtime_environments import ensure_runtime_environment_for_repo
from proliferate.utils.time import utcnow


class CloudRepoLimitExceededError(RuntimeError):
    def __init__(self, *, active_repo_count: int, cloud_repo_limit: int) -> None:
        super().__init__("Cloud repo limit exceeded.")
        self.active_repo_count = active_repo_count
        self.cloud_repo_limit = cloud_repo_limit


class CloudWorkspaceUniqueConflictError(RuntimeError):
    """Raised when a workspace create races an active unique constraint."""


def normalized_repo_key(
    *,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> str:
    return (
        f"{git_provider.strip().lower()}/"
        f"{git_owner.strip().lower()}/"
        f"{git_repo_name.strip().lower()}"
    )


async def _enforce_cloud_repo_limit(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    cloud_repo_limit: int | None,
) -> None:
    if cloud_repo_limit is None:
        return
    await acquire_billing_subject_repo_limit_lock(db, billing_subject_id)
    if await cloud_repo_slot_exists(
        db,
        billing_subject_id=billing_subject_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    ):
        return
    active_repo_count = await count_active_cloud_repo_environments(
        db,
        billing_subject_id,
    )
    if active_repo_count >= cloud_repo_limit:
        raise CloudRepoLimitExceededError(
            active_repo_count=active_repo_count,
            cloud_repo_limit=cloud_repo_limit,
        )


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
    origin: str = "manual_desktop",
    repo_env_vars_ciphertext: str | None = None,
    cloud_repo_limit: int | None = None,
) -> CloudWorkspace:
    now = utcnow()
    billing_subject = await ensure_personal_billing_subject(db, user_id)
    await _enforce_cloud_repo_limit(
        db,
        billing_subject_id=billing_subject.id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        cloud_repo_limit=cloud_repo_limit,
    )
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
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        billing_subject_id=runtime_environment.billing_subject_id or billing_subject.id,
        runtime_environment_id=runtime_environment.id,
        display_name=display_name,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
        git_base_branch=git_base_branch,
        origin=origin,
        origin_json=origin_json,
        status=CloudWorkspaceStatus.pending.value,
        status_detail="Pending",
        last_error=None,
        template_version=template_version,
        runtime_generation=0,
        repo_env_vars_ciphertext=repo_env_vars_ciphertext,
        repo_files_applied_version=0,
        repo_setup_applied_version=0,
        repo_post_ready_phase=WorkspacePostReadyPhase.idle.value,
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        repo_post_ready_apply_token=None,
        repo_files_last_failed_path=None,
        repo_files_last_error=None,
        cleanup_state=CloudWorkspaceCleanupState.none.value,
        created_at=now,
        updated_at=now,
    )
    db.add(workspace)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise CloudWorkspaceUniqueConflictError("Cloud workspace already exists.") from exc
    await db.refresh(workspace)
    return workspace


async def create_managed_cloud_workspace_for_profile(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    created_by_user_id: UUID,
    display_name: str | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    git_base_branch: str | None,
    worktree_path: str | None,
    origin_json: str | None,
    template_version: str,
    origin: str = "manual_desktop",
    repo_env_vars_ciphertext: str | None = None,
) -> CloudWorkspace:
    raise NotImplementedError(
        "Managed sandbox-profile cloud workspaces were removed with the "
        "agent-auth gateway teardown."
    )


async def create_direct_target_cloud_workspace(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
    billing_subject_id: UUID,
    created_by_user_id: UUID,
    display_name: str | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    git_base_branch: str | None,
    worktree_path: str | None,
    origin_json: str | None,
    template_version: str,
    origin: str = "manual_mobile",
) -> CloudWorkspace:
    now = utcnow()
    workspace = CloudWorkspace(
        user_id=user_id,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=created_by_user_id,
        billing_subject_id=billing_subject_id,
        runtime_environment_id=None,
        sandbox_profile_id=None,
        target_id=target_id,
        display_name=display_name,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        normalized_repo_key=normalized_repo_key(
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        ),
        git_branch=git_branch,
        git_base_branch=git_base_branch,
        worktree_path=worktree_path,
        origin=origin,
        origin_json=origin_json,
        status=CloudWorkspaceStatus.pending.value,
        status_detail="Preparing target workspace",
        last_error=None,
        template_version=template_version,
        runtime_generation=0,
        materialized_target_id=None,
        required_runtime_config_sequence=0,
        required_runtime_config_revision_id=None,
        repo_env_vars_ciphertext=None,
        repo_files_applied_version=0,
        repo_setup_applied_version=0,
        repo_post_ready_phase=WorkspacePostReadyPhase.idle.value,
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        repo_post_ready_apply_token=None,
        repo_files_last_failed_path=None,
        repo_files_last_error=None,
        cleanup_state=CloudWorkspaceCleanupState.none.value,
        created_at=now,
        updated_at=now,
    )
    db.add(workspace)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise CloudWorkspaceUniqueConflictError("Cloud workspace already exists.") from exc
    db.add(
        CloudWorkspaceExposure(
            target_id=target_id,
            cloud_workspace_id=workspace.id,
            anyharness_workspace_id=None,
            owner_scope="personal",
            owner_user_id=user_id,
            organization_id=None,
            visibility="private",
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
    return workspace


async def create_cloud_workspace_for_user(
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
    origin: str = "manual_desktop",
    repo_env_vars_ciphertext: str | None = None,
    cloud_repo_limit: int | None = None,
) -> CloudWorkspace:
    return await create_cloud_workspace_record(
        db,
        user_id=user_id,
        display_name=display_name,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
        git_base_branch=git_base_branch,
        origin=origin,
        origin_json=origin_json,
        template_version=template_version,
        repo_env_vars_ciphertext=repo_env_vars_ciphertext,
        cloud_repo_limit=cloud_repo_limit,
    )
