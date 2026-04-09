from __future__ import annotations

from uuid import UUID

from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigValue,
    CloudRepoFileInput,
    bootstrap_cloud_repo_config_for_user,
    list_cloud_repo_configs_for_user,
    load_cloud_repo_config_for_user,
    persist_cloud_repo_config,
    persist_cloud_repo_file,
)
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_for_user
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repo_config.models import (
    CloudRepoConfigResponse,
    CloudRepoConfigsListResponse,
    CloudWorkspaceRepoConfigStatusResponse,
    PutCloudRepoFileRequest,
    RunCloudWorkspaceSetupResponse,
    ResyncCloudWorkspaceFilesResponse,
    SaveCloudRepoConfigRequest,
    repo_config_payload,
    repo_config_summary_payload,
    run_cloud_workspace_setup_payload,
    resync_cloud_workspace_files_payload,
    workspace_repo_config_status_payload,
)
from proliferate.server.cloud.runtime.anyharness_api import CloudRuntimeOperationError
from proliferate.server.cloud.runtime.repo_config_apply import (
    WorkspaceRepoApplyBusyError,
    WorkspaceRuntimeAccess,
    apply_workspace_repo_config,
    run_workspace_saved_setup,
)
from proliferate.server.cloud.runtime.service import get_workspace_connection
from proliferate.server.cloud.repo_config.validation import (
    normalize_env_vars,
    normalize_repo_file_path,
    validate_tracked_file_content,
)


def _default_repo_config_response() -> CloudRepoConfigResponse:
    return CloudRepoConfigResponse(
        configured=False,
        configured_at=None,
        env_vars={},
        setup_script="",
        files_version=0,
        tracked_files=[],
    )


async def list_repo_configs(user_id: UUID) -> CloudRepoConfigsListResponse:
    values = await list_cloud_repo_configs_for_user(user_id)
    return CloudRepoConfigsListResponse(
        configs=[repo_config_summary_payload(value) for value in values]
    )


async def get_repo_config(
    user_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigResponse:
    value = await load_cloud_repo_config_for_user(
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    return _default_repo_config_response() if value is None else repo_config_payload(value)


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


async def save_repo_config(
    user_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
    body: SaveCloudRepoConfigRequest,
) -> CloudRepoConfigResponse:
    env_vars = normalize_env_vars(body.env_vars)
    files = _normalize_files(
        [
            CloudRepoFileInput(relative_path=item.relative_path, content=item.content)
            for item in body.files
        ]
    )
    value = await persist_cloud_repo_config(
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        configured=body.configured,
        env_vars=env_vars,
        setup_script=body.setup_script,
        files=files,
    )
    return repo_config_payload(value)


async def save_repo_file(
    user_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
    body: PutCloudRepoFileRequest,
) -> CloudRepoConfigResponse:
    relative_path = normalize_repo_file_path(body.relative_path)
    validate_tracked_file_content(body.content)
    value = await persist_cloud_repo_file(
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        relative_path=relative_path,
        content=body.content,
    )
    return repo_config_payload(value)


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
    return await bootstrap_cloud_repo_config_for_user(
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )


async def get_workspace_repo_config_status(
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspaceRepoConfigStatusResponse:
    workspace = await load_cloud_workspace_for_user(user_id, workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    repo_config = await load_cloud_repo_config_for_user(
        user_id=user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    return workspace_repo_config_status_payload(workspace, repo_config)


async def build_resync_workspace_repo_config_status(
    user_id: UUID,
    workspace_id: UUID,
) -> ResyncCloudWorkspaceFilesResponse:
    workspace = await load_cloud_workspace_for_user(user_id, workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    repo_config = await load_cloud_repo_config_for_user(
        user_id=user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    return resync_cloud_workspace_files_payload(workspace, repo_config)


def _runtime_access_from_target(target) -> WorkspaceRuntimeAccess:
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
    user_id: UUID,
    workspace_id: UUID,
) -> ResyncCloudWorkspaceFilesResponse:
    workspace = await load_cloud_workspace_for_user(user_id, workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)

    target = await get_workspace_connection(workspace)
    try:
        await apply_workspace_repo_config(
            workspace,
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

    workspace = await load_cloud_workspace_for_user(user_id, workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    repo_config = await load_cloud_repo_config_for_user(
        user_id=user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    return resync_cloud_workspace_files_payload(workspace, repo_config)


async def run_workspace_setup(
    user_id: UUID,
    workspace_id: UUID,
) -> RunCloudWorkspaceSetupResponse:
    workspace = await load_cloud_workspace_for_user(user_id, workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)

    target = await get_workspace_connection(workspace)
    try:
        command = await run_workspace_saved_setup(
            workspace,
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

    workspace = await load_cloud_workspace_for_user(user_id, workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    return run_cloud_workspace_setup_payload(workspace, command=command)
