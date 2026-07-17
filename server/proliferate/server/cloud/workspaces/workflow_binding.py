"""Managed Workflow ownership boundary for Cloud workspace bindings."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_workspace_materializations as materialization_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.server.cloud.errors import CloudApiError


async def bind_managed_workflow_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    invocation_id: UUID,
    placement_kind: Literal["scratch", "repositoryWorktree"],
    repo_environment: RepoEnvironmentValue | None,
    base_ref: str | None,
    cloud_sandbox_id: UUID,
    anyharness_workspace_id: str,
    expected_cloud_workspace_id: UUID | None = None,
) -> CloudWorkspaceValue:
    """Ensure one exact product alias + managed materialization for a run."""

    display_name = f"Workflow run {invocation_id}"
    branch = f"workflow/{invocation_id}"
    workspace = None
    if expected_cloud_workspace_id is not None:
        workspace = await cloud_workspace_store.get_cloud_workspace_by_id(
            db, expected_cloud_workspace_id
        )
        if workspace is None:
            raise CloudApiError(
                "workflow_workspace_binding_lost",
                "Managed Workflow workspace binding is no longer available.",
                status_code=409,
            )
    else:
        workspace = await cloud_workspace_store.get_cloud_workspace_for_runtime_identity(
            db,
            user_id=user_id,
            anyharness_workspace_id=anyharness_workspace_id,
        )

    if workspace is None:
        if placement_kind == "scratch":
            workspace = await cloud_workspace_store.create_scratch_cloud_workspace(
                db,
                user_id=user_id,
                display_name=display_name,
                anyharness_workspace_id=anyharness_workspace_id,
            )
            if workspace is None:
                workspace = await cloud_workspace_store.get_cloud_workspace_for_runtime_identity(
                    db,
                    user_id=user_id,
                    anyharness_workspace_id=anyharness_workspace_id,
                )
        else:
            if repo_environment is None or not base_ref:
                raise CloudApiError(
                    "workflow_workspace_binding_mismatch",
                    "Managed Workflow workspace binding did not match its frozen target.",
                    status_code=409,
                )
            workspace = await cloud_workspace_store.create_cloud_workspace(
                db,
                user_id=user_id,
                repo_environment_id=repo_environment.id,
                display_name=display_name,
                git_branch=branch,
                git_base_branch=base_ref,
                anyharness_workspace_id=anyharness_workspace_id,
            )
            if workspace is None:
                workspace = await cloud_workspace_store.get_repository_workspace_for_branch(
                    db,
                    user_id=user_id,
                    repo_environment_id=repo_environment.id,
                    git_branch=branch,
                )

    expected_repo_environment_id = repo_environment.id if repo_environment is not None else None
    exact_workspace = (
        workspace is not None
        and workspace.owner_user_id == user_id
        and workspace.anyharness_workspace_id == anyharness_workspace_id
        and workspace.display_name == display_name
        and (
            (
                placement_kind == "scratch"
                and workspace.workspace_kind == "scratch"
                and workspace.repo_environment_id is None
                and workspace.git_branch == "main"
                and workspace.git_base_branch is None
            )
            or (
                placement_kind == "repositoryWorktree"
                and workspace.workspace_kind == "repository_worktree"
                and workspace.repo_environment_id == expected_repo_environment_id
                and workspace.git_branch == branch
                and workspace.git_base_branch == base_ref
            )
        )
    )
    if not exact_workspace or workspace is None:
        raise CloudApiError(
            "workflow_workspace_binding_mismatch",
            "Managed Workflow workspace binding did not match its frozen target.",
            status_code=409,
        )

    materialization = await materialization_store.get_active_managed_cloud_materialization(
        db,
        cloud_workspace_id=workspace.id,
        lock_row=True,
    )
    if materialization is None:
        materialization = await materialization_store.insert_managed_cloud_materialization(
            db,
            cloud_workspace_id=workspace.id,
            cloud_sandbox_id=cloud_sandbox_id,
            anyharness_workspace_id=anyharness_workspace_id,
            state="hydrated",
        )
        if materialization is None:
            materialization = await materialization_store.get_active_managed_cloud_materialization(
                db,
                cloud_workspace_id=workspace.id,
                lock_row=True,
            )
    if (
        materialization is None
        or materialization.cloud_workspace_id != workspace.id
        or materialization.cloud_sandbox_id != cloud_sandbox_id
        or materialization.anyharness_workspace_id != anyharness_workspace_id
        or materialization.state != "hydrated"
    ):
        raise CloudApiError(
            "workflow_workspace_materialization_mismatch",
            "Managed Workflow materialization binding did not match its frozen target.",
            status_code=409,
        )
    return workspace
