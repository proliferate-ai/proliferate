"""Cloud workspace product orchestration.

Cloud workspaces are lightweight product rows. AnyHarness owns runtime
workspace/session truth; this service only creates the AnyHarness worktree and
stores the returned workspace id.
"""

from __future__ import annotations

import re
from typing import Literal, Protocol
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_sandboxes as cloud_sandbox_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repositories_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import ResolvedRemoteWorkspace
from proliferate.integrations.anyharness.workspaces import (
    create_remote_worktree_workspace,
    resolve_runtime_workspace,
)
from proliferate.lib.product.workspace_naming import resolve_generated_branch_name
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app.repo_authority import require_github_cloud_repo_authority
from proliferate.server.cloud.materialization import paths as materialization_paths
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.repos.domain.github_credentials import CloudRepoGitHubCredentials
from proliferate.server.cloud.repos.service import get_repo_branches_for_credentials
from proliferate.server.cloud.workspaces.models import (
    CloudRuntimeStatus,
    CloudWorkspaceRuntimeStatusResponse,
    CloudWorkspaceStatus,
    CreateCloudWorkspaceRequest,
    RepoRef,
    WorkspaceDetail,
    WorkspaceRuntimeSummary,
    WorkspaceSummary,
)

MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS = 160
_WORKTREE_SEGMENT_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


class _UserWithId(Protocol):
    id: UUID


async def list_cloud_workspaces_for_user(
    db: AsyncSession,
    user_id: UUID,
    *,
    lifecycle: Literal["active", "archived", "all"] = "active",
) -> list[WorkspaceSummary]:
    workspaces = await cloud_workspace_store.list_cloud_workspaces(
        db,
        user_id,
        lifecycle=lifecycle,
    )
    return [
        await _workspace_payload(db, workspace)
        for workspace in workspaces
        if workspace is not None
    ]


async def get_cloud_workspace_detail(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    return await _workspace_payload(db, workspace, detail=True)


async def create_cloud_workspace_for_user(
    db: AsyncSession,
    user: _UserWithId,
    body: CreateCloudWorkspaceRequest,
) -> WorkspaceDetail:
    git_owner = body.git_owner.strip()
    git_repo_name = body.git_repo_name.strip()
    branch_name = body.branch_name.strip()
    if not git_owner or not git_repo_name:
        raise CloudApiError(
            "invalid_repo",
            "Git owner and repository name are required.",
            status_code=400,
        )
    if not branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Branch name is required.",
            status_code=400,
        )

    repo_environment = await repositories_store.get_cloud_repo_environment(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Configure this repository as a cloud environment before creating a cloud workspace.",
            status_code=404,
        )

    authority = await require_github_cloud_repo_authority(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    repo_branches = await get_repo_branches_for_credentials(
        CloudRepoGitHubCredentials(user_id=user.id, access_token=authority.access_token),
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message=(
            "Connect the Proliferate GitHub App before creating a cloud workspace."
        ),
        repo_access_required_message=(
            "Reconnect the Proliferate GitHub App and grant repository access before "
            "creating a cloud workspace."
        ),
    )
    base_branch = (body.base_branch or repo_environment.default_branch or "").strip()
    if not base_branch:
        base_branch = repo_branches.default_branch
    if base_branch not in repo_branches.branches:
        raise CloudApiError(
            "github_branch_not_found",
            f"The base branch '{base_branch}' was not found on GitHub.",
            status_code=400,
        )

    active_workspace_branches = (
        await cloud_workspace_store.list_active_workspace_branches_for_repo_environment(
            db,
            repo_environment_id=repo_environment.id,
        )
    )
    taken_names = set(repo_branches.branches)
    taken_names.update(active_workspace_branches)
    generated_name = bool(body.generated_name)
    final_branch_name = (
        resolve_generated_branch_name(branch_name, taken_names) if generated_name else branch_name
    )
    if not generated_name:
        if final_branch_name in repo_branches.branches:
            raise CloudApiError(
                "github_branch_already_exists",
                f"The branch '{final_branch_name}' already exists on GitHub.",
                status_code=409,
            )
        if final_branch_name in active_workspace_branches:
            raise CloudApiError(
                "cloud_branch_already_exists",
                f"A cloud workspace already exists for branch '{final_branch_name}'.",
                status_code=409,
            )

    display_name = (body.display_name or final_branch_name).strip() or final_branch_name
    display_name_is_generated = not (body.display_name or "").strip()
    if len(display_name) > MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS:
        raise CloudApiError(
            "invalid_display_name",
            (
                "Workspace display name cannot exceed "
                f"{MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS} characters."
            ),
            status_code=400,
        )

    workspace = await _create_workspace_row_with_branch_retry(
        db,
        user_id=user.id,
        repo_environment_id=repo_environment.id,
        display_name=display_name,
        initial_branch_name=final_branch_name,
        branch_generation_seed=branch_name,
        git_base_branch=base_branch,
        generated_name=generated_name,
        display_name_is_generated=display_name_is_generated,
        repo_branches=repo_branches.branches,
    )
    final_branch_name = workspace.git_branch

    await materialization_service.materialize_repo_environment(
        db,
        repo_environment_id=repo_environment.id,
    )
    runtime_url, runtime_token, _data_key = await _load_ready_runtime_access(db, user_id=user.id)
    repo_path = materialization_paths.repo_path(repo_environment)
    repo_root = await _resolve_repo_root(
        runtime_url,
        runtime_token,
        repo_path=repo_path,
    )
    anyharness_workspace = await _create_anyharness_worktree(
        runtime_url,
        runtime_token,
        workspace_id=workspace.id,
        repo_environment=repo_environment,
        repo_root_id=repo_root.repo_root_id,
        branch_name=final_branch_name,
        base_branch=base_branch,
        setup_script=repo_environment.setup_script,
        source=body.source or "desktop",
    )
    workspace = await cloud_workspace_store.update_workspace_anyharness_workspace_id(
        db,
        anyharness_workspace_id=anyharness_workspace.workspace_id,
        workspace=workspace,
    )
    return await _workspace_payload(db, workspace, detail=True)


async def sync_cloud_workspace_display_name(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
    *,
    display_name: str | None,
) -> WorkspaceDetail:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    cleaned = (display_name or "").strip()
    if not cleaned:
        cleaned = workspace.git_branch
    if len(cleaned) > MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS:
        raise CloudApiError(
            "invalid_display_name",
            (
                "Workspace display name cannot exceed "
                f"{MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS} characters."
            ),
            status_code=400,
        )
    workspace = await cloud_workspace_store.update_workspace_display_name(
        db,
        workspace,
        cleaned,
    )
    return await _workspace_payload(db, workspace, detail=True)


async def archive_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    workspace = await cloud_workspace_store.archive_cloud_workspace(db, workspace)
    return await _workspace_payload(db, workspace, detail=True)


async def restore_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    active_branches = (
        await cloud_workspace_store.list_active_workspace_branches_for_repo_environment(
            db,
            repo_environment_id=workspace.repo_environment_id,
        )
    )
    if workspace.git_branch in active_branches:
        raise CloudApiError(
            "cloud_branch_already_exists",
            f"A cloud workspace already exists for branch '{workspace.git_branch}'.",
            status_code=409,
        )
    try:
        async with db.begin_nested():
            workspace = await cloud_workspace_store.restore_cloud_workspace(db, workspace)
    except IntegrityError as exc:
        raise CloudApiError(
            "cloud_branch_already_exists",
            f"A cloud workspace already exists for branch '{workspace.git_branch}'.",
            status_code=409,
        ) from exc
    return await _workspace_payload(db, workspace, detail=True)


async def delete_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> None:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    await cloud_workspace_store.delete_cloud_workspace(db, workspace)


async def get_cloud_workspace_runtime_status(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspaceRuntimeStatusResponse:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    sandbox = await cloud_sandbox_store.load_personal_cloud_sandbox(db, user_id)
    return CloudWorkspaceRuntimeStatusResponse(
        workspace_id=workspace.id,
        status=_workspace_status(workspace),
        runtime_status=_runtime_status(sandbox),
        sandbox_status=sandbox.status if sandbox is not None else None,
        anyharness_workspace_id=workspace.anyharness_workspace_id,
    )


async def _load_ready_runtime_access(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[str, str, str]:
    sandbox = await cloud_sandbox_store.load_personal_cloud_sandbox(db, user_id)
    if sandbox is None:
        raise CloudApiError(
            "cloud_sandbox_missing",
            "Cloud sandbox has not been created.",
            status_code=409,
        )
    return await cloud_sandboxes_service.load_cloud_sandbox_runtime_access(sandbox)


async def _resolve_repo_root(
    runtime_url: str,
    runtime_token: str,
    *,
    repo_path: str,
) -> ResolvedRemoteWorkspace:
    try:
        return await resolve_runtime_workspace(
            runtime_url,
            runtime_token,
            runtime_workdir=repo_path,
        )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError(
            "cloud_runtime_repo_root_failed",
            str(exc),
            status_code=502,
        ) from exc


async def _create_anyharness_worktree(
    runtime_url: str,
    runtime_token: str,
    *,
    workspace_id: UUID,
    repo_environment: RepoEnvironmentValue,
    repo_root_id: str,
    branch_name: str,
    base_branch: str,
    setup_script: str,
    source: str,
) -> ResolvedRemoteWorkspace:
    target_path = _worktree_path(repo_environment, branch_name, workspace_id=workspace_id)
    try:
        return await create_remote_worktree_workspace(
            runtime_url,
            runtime_token,
            repo_root_id=repo_root_id,
            target_path=target_path,
            new_branch_name=branch_name,
            base_branch=base_branch,
            setup_script=setup_script or None,
            origin={"kind": "human", "entrypoint": source},
        )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError(
            "cloud_workspace_create_failed",
            str(exc),
            status_code=502,
        ) from exc


async def _create_workspace_row_with_branch_retry(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_environment_id: UUID,
    display_name: str,
    initial_branch_name: str,
    branch_generation_seed: str,
    git_base_branch: str,
    generated_name: bool,
    display_name_is_generated: bool,
    repo_branches: list[str],
) -> CloudWorkspace:
    current_branch_name = initial_branch_name
    for _attempt in range(5):
        try:
            async with db.begin_nested():
                return await cloud_workspace_store.create_cloud_workspace(
                    db,
                    user_id=user_id,
                    repo_environment_id=repo_environment_id,
                    display_name=(
                        current_branch_name if display_name_is_generated else display_name
                    ),
                    git_branch=current_branch_name,
                    git_base_branch=git_base_branch,
                )
        except IntegrityError as exc:
            if not generated_name:
                raise CloudApiError(
                    "cloud_branch_already_exists",
                    f"A cloud workspace already exists for branch '{current_branch_name}'.",
                    status_code=409,
                ) from exc

        active_workspace_branches = (
            await cloud_workspace_store.list_active_workspace_branches_for_repo_environment(
                db,
                repo_environment_id=repo_environment_id,
            )
        )
        taken_names = set(repo_branches)
        taken_names.update(active_workspace_branches)
        current_branch_name = resolve_generated_branch_name(branch_generation_seed, taken_names)

    raise CloudApiError(
        "cloud_branch_generation_failed",
        "Could not generate a unique cloud workspace branch name.",
        status_code=409,
    )


async def _load_user_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    workspace = await cloud_workspace_store.get_cloud_workspace_for_user(
        db,
        user_id,
        workspace_id,
    )
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    return workspace


async def _load_repo_environment(
    db: AsyncSession,
    repo_environment_id: UUID,
) -> RepoEnvironmentValue:
    repo_environment = await repositories_store.get_repo_environment_by_id(
        db,
        repo_environment_id,
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Cloud repo environment not found.",
            status_code=404,
        )
    if repo_environment.environment_kind != "cloud":
        raise CloudApiError(
            "invalid_cloud_workspace_environment",
            "Cloud workspace must reference a cloud repo environment.",
            status_code=409,
        )
    return repo_environment


async def _workspace_payload(
    db: AsyncSession,
    workspace: CloudWorkspace,
    *,
    detail: bool = False,
) -> WorkspaceSummary:
    repo_environment = await _load_repo_environment(db, workspace.repo_environment_id)
    sandbox = await cloud_sandbox_store.load_personal_cloud_sandbox(
        db,
        workspace.owner_user_id,
    )
    payload_type = WorkspaceDetail if detail else WorkspaceSummary
    status = _workspace_status(workspace)
    runtime_status = _runtime_status(sandbox)
    return payload_type(
        id=str(workspace.id),
        target_id=None,
        repo_environment_id=str(workspace.repo_environment_id),
        display_name=workspace.display_name,
        repo=RepoRef(
            provider=repo_environment.git_provider,
            owner=repo_environment.git_owner,
            name=repo_environment.git_repo_name,
            branch=workspace.git_branch,
            base_branch=workspace.git_base_branch or repo_environment.default_branch or "main",
        ),
        status=status,
        workspace_status=status,
        product_lifecycle="archived" if workspace.archived_at is not None else "active",
        runtime=WorkspaceRuntimeSummary(
            environment_id=str(repo_environment.id),
            status=runtime_status,
            generation=sandbox.runtime_generation if sandbox is not None else 0,
        ),
        updated_at=workspace.updated_at.isoformat() if workspace.updated_at else None,
        created_at=workspace.created_at.isoformat() if workspace.created_at else None,
        ready_at=workspace.created_at.isoformat() if workspace.created_at else None,
        visibility="archived" if workspace.archived_at is not None else "private",
        anyharness_workspace_id=workspace.anyharness_workspace_id,
    )


def _workspace_status(workspace: CloudWorkspace) -> CloudWorkspaceStatus:
    if workspace.archived_at is not None:
        return "archived"
    if not workspace.anyharness_workspace_id:
        return "materializing"
    return "ready"


def _runtime_status(sandbox: CloudSandboxValue | None) -> CloudRuntimeStatus:
    if sandbox is None:
        return "disabled"
    if sandbox.status == "ready":
        return "running"
    if sandbox.status in {"creating", "provisioning"}:
        return "pending"
    if sandbox.status in {"paused", "stopped"}:
        return "paused"
    if sandbox.status in {"error", "destroyed"}:
        return "error"
    return "pending"


def _worktree_path(
    repo_environment: RepoEnvironmentValue,
    branch_name: str,
    *,
    workspace_id: UUID,
) -> str:
    return (
        f"{materialization_paths.SANDBOX_WORKSPACE_ROOT}/worktrees/"
        f"{repo_environment.git_owner}/{repo_environment.git_repo_name}/"
        f"{_branch_path_segment(branch_name)}-{str(workspace_id)[:8]}"
    )


def _branch_path_segment(branch_name: str) -> str:
    cleaned = branch_name.strip().replace("/", "-")
    cleaned = _WORKTREE_SEGMENT_PATTERN.sub("-", cleaned).strip(".-")
    return cleaned[:96] or "workspace"
