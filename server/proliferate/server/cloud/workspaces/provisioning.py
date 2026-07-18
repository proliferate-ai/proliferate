"""AnyHarness handoff for managed Cloud workspace provisioning."""

from __future__ import annotations

import re
from uuid import UUID

from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import ResolvedRemoteWorkspace
from proliferate.integrations.anyharness.workspaces import (
    create_remote_worktree_workspace,
    resolve_runtime_workspace,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.materialization import paths as materialization_paths
from proliferate.server.cloud.provisioning_observability import provisioning_phase
from proliferate.server.cloud.workspaces.domain.origin import resolve_workspace_origin_entrypoint

_WORKTREE_SEGMENT_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


async def resolve_repo_root(
    runtime_url: str,
    runtime_token: str,
    *,
    repo_path: str,
) -> ResolvedRemoteWorkspace:
    try:
        async with provisioning_phase(scope="workspace_create", phase="repo_root_resolve"):
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


async def create_anyharness_worktree(
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
        async with provisioning_phase(
            scope="workspace_create",
            phase="worktree_create",
            cloud_workspace_id=workspace_id,
            repo_environment_id=repo_environment.id,
        ):
            return await create_remote_worktree_workspace(
                runtime_url,
                runtime_token,
                repo_root_id=repo_root_id,
                target_path=target_path,
                new_branch_name=branch_name,
                base_branch=base_branch,
                setup_script=setup_script or None,
                origin={
                    "kind": "human",
                    "entrypoint": resolve_workspace_origin_entrypoint(source),
                },
            )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError(
            "cloud_workspace_create_failed",
            str(exc),
            status_code=502,
        ) from exc


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
