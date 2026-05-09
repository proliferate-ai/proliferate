from __future__ import annotations

from datetime import datetime
from typing import NoReturn, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigLimitExceededError,
    CloudRepoConfigSummaryValue,
    CloudRepoConfigValue,
    CloudRepoFileInput,
    bootstrap_cloud_repo_config_for_user,
    get_cloud_repo_config,
    list_cloud_repo_configs,
    load_cloud_repo_config_for_user,
    save_cloud_repo_config,
    save_cloud_repo_file,
)
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_by_id
from proliferate.db.store.organizations import load_active_membership
from proliferate.db.store.users import get_user_with_oauth_accounts_by_id
from proliferate.integrations.anyharness import CloudRuntimeOperationError
from proliferate.server.billing.service import (
    get_billing_snapshot,
    get_billing_snapshot_for_request,
    repo_limit_for_billing_snapshot,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repo_config.domain.workspace_status import (
    RepoConfigTrackedFileStatus,
    ResyncWorkspaceRepoConfigStatus,
    RunWorkspaceSetupStatus,
    WorkspaceRepoConfigStatus,
)
from proliferate.server.cloud.repo_config.models import (
    PutCloudRepoFileRequest,
    SaveCloudRepoConfigRequest,
)
from proliferate.server.cloud.repo_config.validation import (
    normalize_env_vars,
    normalize_repo_file_path,
    validate_tracked_file_content,
)
from proliferate.server.cloud.repos.service import get_repo_branches_for_user
from proliferate.server.cloud.runtime.models import RuntimeConnectionTarget
from proliferate.server.cloud.runtime.repo_config_apply import (
    WorkspaceRepoApplyBusyError,
    WorkspaceRuntimeAccess,
    apply_workspace_repo_config,
    run_workspace_saved_setup,
)
from proliferate.server.cloud.runtime.service import get_workspace_connection


class _WorkspaceRepoConfigRecord(Protocol):
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    git_owner: str
    git_repo_name: str
    repo_files_applied_version: int
    repo_files_applied_at: datetime | None
    repo_post_ready_phase: str
    repo_post_ready_files_total: int
    repo_post_ready_files_applied: int
    repo_post_ready_started_at: datetime | None
    repo_post_ready_completed_at: datetime | None
    repo_files_last_failed_path: str | None
    repo_files_last_error: str | None


def _raise_workspace_not_found() -> NoReturn:
    raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)


def _raise_org_cloud_not_ready() -> NoReturn:
    raise CloudApiError(
        "org_cloud_not_ready",
        "Organization cloud workspaces are not ready yet.",
        status_code=409,
    )


async def _load_authorized_workspace_for_repo_config(
    user_id: UUID,
    workspace_id: UUID,
) -> _WorkspaceRepoConfigRecord:
    workspace = await load_cloud_workspace_by_id(workspace_id)
    if workspace is None:
        _raise_workspace_not_found()

    if workspace.owner_scope == "personal":
        if workspace.owner_user_id != user_id:
            _raise_workspace_not_found()
        return workspace

    if workspace.owner_scope == "organization" and workspace.organization_id is not None:
        membership = await load_active_membership(
            organization_id=workspace.organization_id,
            user_id=user_id,
        )
        if membership is None:
            _raise_workspace_not_found()
        _raise_org_cloud_not_ready()

    _raise_workspace_not_found()


def _workspace_repo_config_status(
    workspace: _WorkspaceRepoConfigRecord,
    repo_config: CloudRepoConfigValue | None,
) -> WorkspaceRepoConfigStatus:
    tracked_files = (
        ()
        if repo_config is None
        else tuple(
            RepoConfigTrackedFileStatus(
                relative_path=item.relative_path,
                content_sha256=item.content_sha256,
                byte_size=item.byte_size,
                updated_at=item.updated_at,
                last_synced_at=item.last_synced_at,
            )
            for item in repo_config.tracked_files
        )
    )
    env_var_keys = () if repo_config is None else tuple(sorted(repo_config.env_vars))
    current_version = 0 if repo_config is None else repo_config.files_version
    return WorkspaceRepoConfigStatus(
        current_repo_files_version=current_version,
        repo_files_applied_version=workspace.repo_files_applied_version,
        repo_files_applied_at=workspace.repo_files_applied_at,
        files_out_of_sync=workspace.repo_files_applied_version != current_version,
        tracked_files=tracked_files,
        env_var_keys=env_var_keys,
        post_ready_phase=workspace.repo_post_ready_phase,
        post_ready_files_total=workspace.repo_post_ready_files_total,
        post_ready_files_applied=workspace.repo_post_ready_files_applied,
        post_ready_started_at=workspace.repo_post_ready_started_at,
        post_ready_completed_at=workspace.repo_post_ready_completed_at,
        last_apply_failed_path=workspace.repo_files_last_failed_path,
        last_apply_error=workspace.repo_files_last_error,
    )


def _resync_workspace_repo_config_status(
    workspace: _WorkspaceRepoConfigRecord,
    repo_config: CloudRepoConfigValue | None,
) -> ResyncWorkspaceRepoConfigStatus:
    return ResyncWorkspaceRepoConfigStatus(
        workspace_id=workspace.id,
        status=_workspace_repo_config_status(workspace, repo_config),
    )


async def list_repo_configs(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudRepoConfigSummaryValue]:
    return await list_cloud_repo_configs(db, user_id)


async def get_repo_config(
    db: AsyncSession,
    user_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue | None:
    return await get_cloud_repo_config(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )


def _normalize_files(files: list[CloudRepoFileInput]) -> list[CloudRepoFileInput]:
    normalized: list[CloudRepoFileInput] = []
    seen_paths: set[str] = set()
    for item in files:
        relative_path = normalize_repo_file_path(item.relative_path)
        if relative_path in seen_paths:
            raise CloudApiError(
                "duplicate_repo_file_path",
                f"Tracked file '{relative_path}' was supplied more than once.",
                status_code=400,
            )
        validate_tracked_file_content(item.content)
        normalized.append(CloudRepoFileInput(relative_path=relative_path, content=item.content))
        seen_paths.add(relative_path)
    return normalized


async def _validate_default_branch(
    db: AsyncSession,
    user_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
    default_branch: str | None,
) -> str | None:
    normalized_default_branch = (default_branch or "").strip() or None
    if normalized_default_branch is None:
        return None

    user = await get_user_with_oauth_accounts_by_id(db, user_id)
    if user is None:
        raise CloudApiError("user_not_found", "User not found.", status_code=404)

    repo_branches = await get_repo_branches_for_user(
        user,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message="Connect a GitHub account before setting a cloud default branch.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before setting a cloud default branch."
        ),
    )
    if normalized_default_branch not in repo_branches.branches:
        raise CloudApiError(
            "github_branch_not_found",
            f"The default branch '{normalized_default_branch}' was not found on GitHub.",
            status_code=400,
        )

    return normalized_default_branch


async def save_repo_config(
    db: AsyncSession,
    user_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
    body: SaveCloudRepoConfigRequest,
) -> CloudRepoConfigValue:
    env_vars = normalize_env_vars(body.env_vars)
    default_branch = await _validate_default_branch(
        db,
        user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        default_branch=body.default_branch,
    )
    files = _normalize_files(
        [
            CloudRepoFileInput(relative_path=item.relative_path, content=item.content)
            for item in body.files
        ]
    )
    billing_snapshot = await get_billing_snapshot_for_request(db, user_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)
    try:
        value = await save_cloud_repo_config(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            configured=body.configured,
            cloud_repo_limit=cloud_repo_limit,
            default_branch=default_branch,
            env_vars=env_vars,
            setup_script=body.setup_script,
            run_command=body.run_command,
            files=files,
        )
    except CloudRepoConfigLimitExceededError as error:
        raise CloudApiError(
            "repo_limit_exceeded",
            (
                f"Cloud repo limit reached. Upgrade or disable another cloud repo "
                f"before configuring this one ({error.active_repo_count}/"
                f"{error.cloud_repo_limit})."
            ),
            status_code=409,
        ) from error
    return value


async def save_repo_file(
    db: AsyncSession,
    user_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
    body: PutCloudRepoFileRequest,
) -> CloudRepoConfigValue:
    relative_path = normalize_repo_file_path(body.relative_path)
    validate_tracked_file_content(body.content)
    value = await save_cloud_repo_file(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        relative_path=relative_path,
        content=body.content,
    )
    return value


async def load_repo_config_value(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue | None:
    return await load_cloud_repo_config_for_user(
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )


async def bootstrap_repo_config(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue:
    billing_snapshot = await get_billing_snapshot(user_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)
    try:
        return await bootstrap_cloud_repo_config_for_user(
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            cloud_repo_limit=cloud_repo_limit,
        )
    except CloudRepoConfigLimitExceededError as error:
        raise CloudApiError(
            "repo_limit_exceeded",
            (
                f"Cloud repo limit reached. Upgrade or disable another cloud repo "
                f"before configuring this one ({error.active_repo_count}/"
                f"{error.cloud_repo_limit})."
            ),
            status_code=409,
        ) from error


async def get_workspace_repo_config_status(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceRepoConfigStatus:
    workspace = await _load_authorized_workspace_for_repo_config(user_id, workspace_id)
    repo_config = await get_cloud_repo_config(
        db,
        user_id=user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    return _workspace_repo_config_status(workspace, repo_config)


async def build_resync_workspace_repo_config_status(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> ResyncWorkspaceRepoConfigStatus:
    workspace = await _load_authorized_workspace_for_repo_config(user_id, workspace_id)
    repo_config = await get_cloud_repo_config(
        db,
        user_id=user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    return _resync_workspace_repo_config_status(workspace, repo_config)


def _runtime_access_from_target(
    target: RuntimeConnectionTarget,
) -> WorkspaceRuntimeAccess:
    if not target.anyharness_workspace_id:
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud workspace runtime is not ready yet.",
            status_code=409,
        )
    return WorkspaceRuntimeAccess(
        runtime_url=target.runtime_url,
        access_token=target.access_token,
        anyharness_workspace_id=target.anyharness_workspace_id,
    )


async def resync_workspace_files(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> ResyncWorkspaceRepoConfigStatus:
    workspace = await _load_authorized_workspace_for_repo_config(user_id, workspace_id)

    # Workspace stores still return ORM rows; this lane only removes ORM-aware response builders.
    target = await get_workspace_connection(workspace)  # type: ignore[arg-type]
    try:
        await apply_workspace_repo_config(
            workspace,  # type: ignore[arg-type]
            runtime=_runtime_access_from_target(target),
            run_setup=False,
        )
    except WorkspaceRepoApplyBusyError as error:
        raise CloudApiError(
            "workspace_repo_apply_in_progress",
            str(error),
            status_code=409,
        ) from error
    except CloudRuntimeOperationError as error:
        raise CloudApiError(
            "workspace_repo_apply_failed",
            str(error),
            status_code=502,
        ) from error

    workspace = await _load_authorized_workspace_for_repo_config(user_id, workspace_id)
    repo_config = await get_cloud_repo_config(
        db,
        user_id=user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    return _resync_workspace_repo_config_status(workspace, repo_config)


async def run_workspace_setup(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> RunWorkspaceSetupStatus:
    workspace = await _load_authorized_workspace_for_repo_config(user_id, workspace_id)

    # Workspace stores still return ORM rows; this lane only removes ORM-aware response builders.
    target = await get_workspace_connection(workspace)  # type: ignore[arg-type]
    try:
        started = await run_workspace_saved_setup(
            workspace,  # type: ignore[arg-type]
            runtime=_runtime_access_from_target(target),
        )
    except WorkspaceRepoApplyBusyError as error:
        raise CloudApiError(
            "workspace_repo_apply_in_progress",
            str(error),
            status_code=409,
        ) from error
    except CloudRuntimeOperationError as error:
        raise CloudApiError(
            "workspace_setup_start_failed",
            str(error),
            status_code=502,
        ) from error

    workspace = await _load_authorized_workspace_for_repo_config(user_id, workspace_id)
    return RunWorkspaceSetupStatus(
        workspace_id=workspace.id,
        command=started.command,
        terminal_id=started.terminal_id,
        command_run_id=started.command_run_id,
        status=started.status,
    )
