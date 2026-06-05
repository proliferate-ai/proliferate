"""Persistence helpers for cloud workspaces."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Final, Literal
from uuid import UUID

from sqlalchemy import Select, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    WORKSPACE_REPO_APPLY_LOCK_SALT,
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
    WorkspacePostReadyPhase,
    WorkspaceStatus,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.db.store.billing import (
    acquire_billing_subject_repo_limit_lock,
    cloud_repo_slot_exists,
    count_active_cloud_repo_environments,
    ensure_personal_billing_subject,
)
from proliferate.db.store.cloud_profile_target_guard import require_primary_managed_profile_target
from proliferate.db.store.cloud_runtime_environments import ensure_runtime_environment_for_repo
from proliferate.utils.time import utcnow

_UNSET: Final = object()

CloudWorkspaceLifecycle = Literal["active", "archived", "all"]


class CloudRepoLimitExceededError(RuntimeError):
    def __init__(self, *, active_repo_count: int, cloud_repo_limit: int) -> None:
        super().__init__("Cloud repo limit exceeded.")
        self.active_repo_count = active_repo_count
        self.cloud_repo_limit = cloud_repo_limit


def _workspace_repo_apply_lock_key(workspace_id: UUID) -> int:
    prefix = int.from_bytes(workspace_id.bytes[:8], byteorder="big", signed=False)
    return (prefix ^ WORKSPACE_REPO_APPLY_LOCK_SALT) & ((1 << 63) - 1)


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


def _apply_workspace_lifecycle_filter(
    statement: Select[tuple[CloudWorkspace]],
    lifecycle: CloudWorkspaceLifecycle,
) -> Select[tuple[CloudWorkspace]]:
    if lifecycle == "active":
        return statement.where(CloudWorkspace.archived_at.is_(None))
    if lifecycle == "archived":
        return statement.where(CloudWorkspace.archived_at.is_not(None))
    return statement


async def list_cloud_workspaces(
    db: AsyncSession,
    user_id: UUID,
    *,
    lifecycle: CloudWorkspaceLifecycle = "active",
) -> list[CloudWorkspace]:
    statement = (
        select(CloudWorkspace)
        .where(
            CloudWorkspace.owner_scope == "personal",
            CloudWorkspace.owner_user_id == user_id,
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    statement = _apply_workspace_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def list_claimed_organization_workspaces_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    lifecycle: CloudWorkspaceLifecycle = "active",
) -> list[CloudWorkspace]:
    statement = (
        select(CloudWorkspace)
        .join(
            CloudWorkspaceExposure,
            CloudWorkspaceExposure.cloud_workspace_id == CloudWorkspace.id,
        )
        .join(
            OrganizationMembership,
            OrganizationMembership.organization_id == CloudWorkspace.organization_id,
        )
        .where(
            CloudWorkspace.owner_scope == "organization",
            CloudWorkspaceExposure.visibility == "claimed",
            CloudWorkspaceExposure.claimed_by_user_id == user_id,
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            CloudWorkspaceExposure.archived_at.is_(None),
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    statement = _apply_workspace_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def list_exposed_cloud_workspaces_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID | None = None,
    lifecycle: CloudWorkspaceLifecycle = "active",
) -> list[CloudWorkspace]:
    personal_query = (
        select(CloudWorkspace)
        .join(
            CloudWorkspaceExposure,
            CloudWorkspaceExposure.cloud_workspace_id == CloudWorkspace.id,
        )
        .where(
            CloudWorkspace.owner_scope == "personal",
            CloudWorkspace.owner_user_id == user_id,
            CloudWorkspaceExposure.owner_scope == "personal",
            CloudWorkspaceExposure.owner_user_id == user_id,
            CloudWorkspaceExposure.archived_at.is_(None),
            CloudWorkspaceExposure.status == "active",
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    personal_query = _apply_workspace_lifecycle_filter(personal_query, lifecycle)
    if organization_id is not None:
        personal_rows: list[CloudWorkspace] = []
    else:
        personal_rows = list((await db.execute(personal_query)).scalars().all())

    organization_query = (
        select(CloudWorkspace)
        .join(
            CloudWorkspaceExposure,
            CloudWorkspaceExposure.cloud_workspace_id == CloudWorkspace.id,
        )
        .join(
            OrganizationMembership,
            OrganizationMembership.organization_id == CloudWorkspace.organization_id,
        )
        .where(
            CloudWorkspace.owner_scope == "organization",
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            CloudWorkspaceExposure.owner_scope == "organization",
            CloudWorkspaceExposure.archived_at.is_(None),
            CloudWorkspaceExposure.status == "active",
            (
                (CloudWorkspaceExposure.visibility == "shared_unclaimed")
                | (CloudWorkspaceExposure.claimed_by_user_id == user_id)
                | (
                    OrganizationMembership.role.in_(
                        (ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN),
                    )
                )
            ),
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    organization_query = _apply_workspace_lifecycle_filter(organization_query, lifecycle)
    if organization_id is not None:
        organization_query = organization_query.where(
            CloudWorkspace.organization_id == organization_id,
        )
    organization_rows = list((await db.execute(organization_query)).scalars().all())

    by_id: dict[UUID, CloudWorkspace] = {}
    for workspace in [*personal_rows, *organization_rows]:
        by_id[workspace.id] = workspace
    return sorted(by_id.values(), key=lambda workspace: workspace.updated_at, reverse=True)


async def list_unclaimed_organization_workspaces(
    db: AsyncSession,
    *,
    organization_id: UUID,
    lifecycle: CloudWorkspaceLifecycle = "active",
) -> list[CloudWorkspace]:
    statement = (
        select(CloudWorkspace)
        .join(
            CloudWorkspaceExposure,
            CloudWorkspaceExposure.cloud_workspace_id == CloudWorkspace.id,
        )
        .where(
            CloudWorkspace.owner_scope == "organization",
            CloudWorkspace.organization_id == organization_id,
            CloudWorkspaceExposure.visibility == "shared_unclaimed",
            CloudWorkspaceExposure.archived_at.is_(None),
        )
        .order_by(CloudWorkspace.created_at.desc())
    )
    statement = _apply_workspace_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def list_organization_workspaces_for_admin_audit(
    db: AsyncSession,
    *,
    organization_id: UUID,
    lifecycle: CloudWorkspaceLifecycle = "all",
) -> list[CloudWorkspace]:
    statement = (
        select(CloudWorkspace)
        .where(
            CloudWorkspace.owner_scope == "organization",
            CloudWorkspace.organization_id == organization_id,
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    statement = _apply_workspace_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def get_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.id == workspace_id,
                CloudWorkspace.owner_scope == "personal",
                CloudWorkspace.owner_user_id == user_id,
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
                CloudWorkspace.owner_scope == "personal",
                CloudWorkspace.owner_user_id == user_id,
                CloudWorkspace.git_provider == git_provider,
                CloudWorkspace.git_owner == git_owner,
                CloudWorkspace.git_repo_name == git_repo_name,
                CloudWorkspace.git_branch == git_branch,
                CloudWorkspace.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def get_existing_managed_cloud_workspace_for_profile(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.sandbox_profile_id == sandbox_profile_id,
                CloudWorkspace.target_id == target_id,
                CloudWorkspace.git_provider == git_provider,
                CloudWorkspace.git_owner == git_owner,
                CloudWorkspace.git_repo_name == git_repo_name,
                CloudWorkspace.git_branch == git_branch,
                CloudWorkspace.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def update_workspace_branch(
    db: AsyncSession,
    workspace: CloudWorkspace,
    branch_name: str,
) -> CloudWorkspace:
    workspace.git_branch = branch_name
    workspace.updated_at = utcnow()
    await db.flush()
    return workspace


async def update_workspace_display_name(
    db: AsyncSession,
    workspace: CloudWorkspace,
    display_name: str | None,
) -> CloudWorkspace:
    workspace.display_name = display_name
    workspace.updated_at = utcnow()
    await db.flush()
    return workspace


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
    await db.flush()
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
    profile, _target = await require_primary_managed_profile_target(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if profile.owner_scope == "personal":
        owner_user_id = profile.owner_user_id
        organization_id = None
        if owner_user_id is None:
            raise RuntimeError("Personal sandbox profile is missing owner_user_id.")
        user_id = owner_user_id
    else:
        owner_user_id = None
        organization_id = profile.organization_id
        if organization_id is None:
            raise RuntimeError("Organization sandbox profile is missing organization_id.")
        user_id = created_by_user_id
    now = utcnow()
    workspace = CloudWorkspace(
        user_id=user_id,
        owner_scope=profile.owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        billing_subject_id=profile.billing_subject_id,
        runtime_environment_id=None,
        sandbox_profile_id=sandbox_profile_id,
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
        status_detail="Pending",
        last_error=None,
        template_version=template_version,
        runtime_generation=0,
        materialized_target_id=None,
        required_runtime_config_sequence=0,
        required_runtime_config_revision_id=None,
        required_agent_auth_revision=profile.desired_agent_auth_revision,
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
    await db.flush()
    db.add(
        CloudWorkspaceExposure(
            target_id=target_id,
            cloud_workspace_id=workspace.id,
            anyharness_workspace_id=None,
            owner_scope=profile.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            visibility=(
                "shared_unclaimed" if profile.owner_scope == "organization" else "private"
            ),
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
        required_agent_auth_revision=None,
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
    await db.flush()
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
    await db.flush()


async def attach_anyharness_workspace_id(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    anyharness_workspace_id: str,
    status: CloudWorkspaceStatus | WorkspaceStatus | str = CloudWorkspaceStatus.ready,
    status_detail: str = "Ready",
) -> CloudWorkspace | None:
    workspace = (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()
    if workspace is None:
        return None
    workspace.anyharness_workspace_id = anyharness_workspace_id
    workspace.status = status.value if hasattr(status, "value") else str(status)
    workspace.status_detail = status_detail
    workspace.ready_at = workspace.ready_at or utcnow()
    workspace.updated_at = utcnow()
    await db.flush()
    return workspace


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


async def list_cloud_workspaces_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudWorkspace]:
    return await list_cloud_workspaces(db, user_id)


async def load_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return await get_cloud_workspace_for_user(db, user_id, workspace_id)


async def load_cloud_workspace_by_id(
    db: AsyncSession,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return await get_cloud_workspace_by_id(db, workspace_id)


async def load_existing_cloud_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> CloudWorkspace | None:
    return await get_existing_cloud_workspace(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
    )


async def load_any_cloud_workspace_for_repo(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace)
            .where(
                CloudWorkspace.owner_scope == "personal",
                CloudWorkspace.owner_user_id == user_id,
                CloudWorkspace.git_owner == git_owner,
                CloudWorkspace.git_repo_name == git_repo_name,
            )
            .order_by(CloudWorkspace.updated_at.desc())
        )
    ).scalar_one_or_none()


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
