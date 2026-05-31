"""Cloud backfill persistence for worker-synced local workspaces."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
    WorkspacePostReadyPhase,
)
from proliferate.db.models.cloud.sync import CloudSyncedWorkspace
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class SyncedCloudWorkspaceSnapshot:
    id: UUID
    target_id: UUID
    anyharness_workspace_id: str
    display_name: str | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str | None
    status: str
    updated_at: datetime


def _workspace_snapshot(
    *,
    target_id: UUID,
    workspace: CloudWorkspace,
) -> SyncedCloudWorkspaceSnapshot:
    return SyncedCloudWorkspaceSnapshot(
        id=workspace.id,
        target_id=target_id,
        anyharness_workspace_id=workspace.anyharness_workspace_id or "",
        display_name=workspace.display_name,
        git_provider=workspace.git_provider,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        git_branch=workspace.git_branch,
        git_base_branch=workspace.git_base_branch,
        status=workspace.status,
        updated_at=workspace.updated_at,
    )


def _clean_display_name(
    display_name: str | None,
    *,
    anyharness_workspace_id: str,
) -> str | None:
    cleaned = display_name.strip() if display_name else None
    if not cleaned:
        return None
    if cleaned == anyharness_workspace_id.strip():
        return None
    return cleaned


async def upsert_synced_workspace(
    db: AsyncSession,
    *,
    target_id: UUID,
    anyharness_workspace_id: str,
    billing_subject_id: UUID,
    owner_scope: str,
    owner_user_id: UUID,
    organization_id: UUID | None,
    created_by_user_id: UUID,
    display_name: str | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    git_base_branch: str | None,
    origin_json: str | None,
    template_version: str,
) -> SyncedCloudWorkspaceSnapshot:
    workspace = await _find_workspace_by_anyharness_id(
        db,
        target_id=target_id,
        anyharness_workspace_id=anyharness_workspace_id,
    )
    now = utcnow()
    incoming_display_name = _clean_display_name(
        display_name,
        anyharness_workspace_id=anyharness_workspace_id,
    )
    if workspace is None:
        workspace = CloudWorkspace(
            user_id=owner_user_id,
            owner_scope=owner_scope,
            owner_user_id=owner_user_id if owner_scope == "personal" else None,
            organization_id=organization_id if owner_scope == "organization" else None,
            created_by_user_id=created_by_user_id,
            billing_subject_id=billing_subject_id,
            runtime_environment_id=None,
            target_id=target_id,
            display_name=incoming_display_name,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
            git_base_branch=git_base_branch,
            origin_json=origin_json,
            status=CloudWorkspaceStatus.ready.value,
            status_detail="Synced from target.",
            last_error=None,
            template_version=template_version,
            runtime_generation=0,
            anyharness_workspace_id=anyharness_workspace_id,
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
            ready_at=now,
        )
        db.add(workspace)
        await db.flush()
        mapping = CloudSyncedWorkspace(
            target_id=target_id,
            cloud_workspace_id=workspace.id,
            workspace_id=anyharness_workspace_id,
            created_at=now,
            updated_at=now,
        )
        db.add(mapping)
    else:
        workspace.billing_subject_id = billing_subject_id
        if workspace.display_name is None and incoming_display_name is not None:
            workspace.display_name = incoming_display_name
        workspace.git_provider = git_provider
        workspace.git_owner = git_owner
        workspace.git_repo_name = git_repo_name
        workspace.git_branch = git_branch
        workspace.git_base_branch = git_base_branch or workspace.git_base_branch
        workspace.target_id = target_id
        if workspace.origin_json is None and origin_json is not None:
            workspace.origin_json = origin_json
        workspace.status = CloudWorkspaceStatus.ready.value
        workspace.status_detail = "Synced from target."
        workspace.last_error = None
        workspace.template_version = template_version
        workspace.anyharness_workspace_id = anyharness_workspace_id
        workspace.updated_at = now
        workspace.ready_at = workspace.ready_at or now
        await _upsert_workspace_mapping(
            db,
            target_id=target_id,
            anyharness_workspace_id=anyharness_workspace_id,
            cloud_workspace_id=workspace.id,
            now=now,
        )
    await db.flush()
    return _workspace_snapshot(target_id=target_id, workspace=workspace)


async def _upsert_workspace_mapping(
    db: AsyncSession,
    *,
    target_id: UUID,
    anyharness_workspace_id: str,
    cloud_workspace_id: UUID,
    now: datetime,
) -> None:
    row = (
        await db.execute(
            select(CloudSyncedWorkspace)
            .where(CloudSyncedWorkspace.target_id == target_id)
            .where(CloudSyncedWorkspace.workspace_id == anyharness_workspace_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = CloudSyncedWorkspace(
            target_id=target_id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=anyharness_workspace_id,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        return
    row.cloud_workspace_id = cloud_workspace_id
    row.updated_at = now


async def _find_workspace_by_anyharness_id(
    db: AsyncSession,
    *,
    target_id: UUID,
    anyharness_workspace_id: str,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace)
            .outerjoin(
                CloudSyncedWorkspace,
                CloudSyncedWorkspace.cloud_workspace_id == CloudWorkspace.id,
            )
            .where(
                or_(
                    (
                        (CloudSyncedWorkspace.target_id == target_id)
                        & (CloudSyncedWorkspace.workspace_id == anyharness_workspace_id)
                    ),
                    (
                        (CloudWorkspace.target_id == target_id)
                        & (CloudWorkspace.anyharness_workspace_id == anyharness_workspace_id)
                    ),
                )
            )
            .where(CloudWorkspace.archived_at.is_(None))
            .order_by(CloudWorkspace.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
