"""Transaction-free provider resolution for manual cloud workflow sources."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import github_app as github_app_store
from proliferate.db.store import repositories as repositories_store
from proliferate.integrations.github import (
    GitHubBranchNotFound,
    GitHubIntegrationError,
    get_github_branch_head,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudRunTarget:
    anyharness_workspace_id: str
    source_intent: dict[str, object]


@dataclass(frozen=True)
class CloudSourceSnapshot:
    repo_environment_id: UUID
    workspace_generation: int
    git_branch: str
    git_base_branch: str | None
    anyharness_workspace_id: str
    repo_generation: int
    git_provider: str
    git_owner: str
    git_repo_name: str
    environment_kind: str
    default_branch: str | None


@dataclass(frozen=True)
class GitHubSourceAuthoritySnapshot:
    authorization_id: UUID
    authorization_status: str
    token_expires_at: datetime
    authorization_updated_at: datetime
    installation_id: UUID
    installation_updated_at: datetime
    repository_cache_id: UUID
    repository_cache_updated_at: datetime


async def load_cached_github_source_authority(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> tuple[str, GitHubSourceAuthoritySnapshot]:
    """Select one cached, repository-specific authority proof and its token."""

    authorization = await github_app_store.get_github_app_authorization_for_user(
        db, user_id=user_id
    )
    if (
        authorization is None
        or authorization.status != "ready"
        or authorization.access_token is None
        or authorization.token_expires_at is None
        or authorization.token_expires_at <= utcnow() + timedelta(minutes=10)
    ):
        raise CloudApiError(
            "workflow_source_authorization_refresh_required",
            "Refresh GitHub authorization before resolving a workflow source.",
            status_code=409,
        )
    installations = await github_app_store.list_active_github_app_installations_for_owner(
        db, owner=git_owner
    )
    selected_installation = None
    selected_repository = None
    for installation in installations:
        cached = await github_app_store.get_fresh_installation_repo_cache(
            db,
            installation_id=installation.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
        if cached is not None:
            selected_installation = installation
            selected_repository = cached
            break
    if selected_installation is None or selected_repository is None:
        raise CloudApiError(
            "workflow_source_authority_cache_required",
            "Refresh GitHub repository access before resolving this workflow source.",
            status_code=409,
        )
    access_token = authorization.access_token
    snapshot = GitHubSourceAuthoritySnapshot(
        authorization_id=authorization.id,
        authorization_status=authorization.status,
        token_expires_at=authorization.token_expires_at,
        authorization_updated_at=authorization.updated_at,
        installation_id=selected_installation.id,
        installation_updated_at=selected_installation.updated_at,
        repository_cache_id=selected_repository.id,
        repository_cache_updated_at=selected_repository.updated_at,
    )
    del authorization
    return access_token, snapshot


async def _revalidate_github_source_authority(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    snapshot: GitHubSourceAuthoritySnapshot,
) -> bool:
    authorization = await github_app_store.get_github_app_authorization_fence_by_id(
        db,
        authorization_id=snapshot.authorization_id,
        lock_row=True,
    )
    installation = await github_app_store.get_github_app_installation_by_id(
        db,
        installation_id=snapshot.installation_id,
        lock_row=True,
    )
    repository = await github_app_store.get_installation_repo_cache_by_id(
        db,
        repository_cache_id=snapshot.repository_cache_id,
        lock_row=True,
    )
    return bool(
        authorization is not None
        and authorization.user_id == user_id
        and authorization.status == snapshot.authorization_status == "ready"
        and authorization.token_expires_at == snapshot.token_expires_at
        and authorization.token_expires_at is not None
        and authorization.token_expires_at > utcnow() + timedelta(minutes=10)
        and authorization.updated_at == snapshot.authorization_updated_at
        and installation is not None
        and installation.updated_at == snapshot.installation_updated_at
        and installation.suspended_at is None
        and installation.deleted_at is None
        and installation.account_login.lower() == git_owner.lower()
        and repository is not None
        and repository.github_app_installation_id == installation.id
        and repository.owner.lower() == git_owner.lower()
        and repository.name.lower() == git_repo_name.lower()
        and repository.updated_at == snapshot.repository_cache_updated_at
        and repository.updated_at >= utcnow() - timedelta(minutes=10)
    )


async def _resolve_selected_branch(
    access_token: str,
    *,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> tuple[str, str | None]:
    """Collapse credential-bound provider exceptions into a secret-free result."""

    try:
        return (
            "resolved",
            await get_github_branch_head(
                access_token,
                git_owner,
                git_repo_name,
                git_branch,
            ),
        )
    except GitHubBranchNotFound:
        return "missing", None
    except GitHubIntegrationError:
        return "failed", None


async def resolve_cloud_target(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target_workspace_id: UUID | None,
    release_source_snapshot: Callable[[], Awaitable[None]],
) -> CloudRunTarget:
    """Freeze authority, release SQL, resolve GitHub, then re-lock every fence."""

    if target_workspace_id is None:
        raise CloudApiError(
            "target_workspace_required",
            "A cloud workspace is required to run this workflow in the cloud.",
            status_code=400,
        )
    user_id = user.id
    workspace = await cloud_workspace_store.get_cloud_workspace_for_user(
        db, user_id, target_workspace_id
    )
    if workspace is None or workspace.archived_at is not None:
        raise CloudApiError(
            "target_workspace_not_found", "Cloud workspace not found.", status_code=404
        )
    if not workspace.anyharness_workspace_id:
        raise CloudApiError(
            "target_workspace_not_ready",
            "This cloud workspace is still materializing; try again shortly.",
            status_code=409,
        )
    repo_environment = await repositories_store.get_repo_environment_by_id(
        db, workspace.repo_environment_id
    )
    if (
        repo_environment is None
        or repo_environment.user_id != user_id
        or repo_environment.environment_kind != "cloud"
        or repo_environment.git_provider != "github"
    ):
        raise CloudApiError(
            "workflow_source_provenance_invalid",
            "The target workspace repository provenance is invalid.",
            status_code=409,
        )
    snapshot = CloudSourceSnapshot(
        repo_environment_id=workspace.repo_environment_id,
        workspace_generation=workspace.generation,
        git_branch=workspace.git_branch,
        git_base_branch=workspace.git_base_branch,
        anyharness_workspace_id=workspace.anyharness_workspace_id,
        repo_generation=repo_environment.generation,
        git_provider=repo_environment.git_provider,
        git_owner=repo_environment.git_owner,
        git_repo_name=repo_environment.git_repo_name,
        environment_kind=repo_environment.environment_kind,
        default_branch=repo_environment.default_branch,
    )
    access_token, authority_snapshot = await load_cached_github_source_authority(
        db,
        user_id=user_id,
        git_owner=snapshot.git_owner,
        git_repo_name=snapshot.git_repo_name,
    )
    try:
        await release_source_snapshot()
        if db.in_transaction():
            raise CloudApiError(
                "workflow_source_transaction_boundary_required",
                "Source resolution requires a released SQL transaction.",
                status_code=409,
            )
        provider_status, resolved_commit = await _resolve_selected_branch(
            access_token,
            git_owner=snapshot.git_owner,
            git_repo_name=snapshot.git_repo_name,
            git_branch=snapshot.git_branch,
        )
    finally:
        # This guard begins at load, so release/boundary/provider failures cannot
        # retain the plaintext authority in traceback locals.
        del access_token
    # Global lock order continues in compiler.start_run as workspace -> repository
    # -> GitHub auth -> installation -> repository coverage -> workflow -> version.
    # All provider I/O is complete; no provider call may occur after this re-lock.
    current_workspace = await cloud_workspace_store.get_cloud_workspace_for_user(
        db, user_id, target_workspace_id, lock_row=True
    )
    current_repo = await repositories_store.get_repo_environment_by_id(
        db, snapshot.repo_environment_id, lock_row=True
    )
    authority_current = await _revalidate_github_source_authority(
        db,
        user_id=user_id,
        git_owner=snapshot.git_owner,
        git_repo_name=snapshot.git_repo_name,
        snapshot=authority_snapshot,
    )
    if (
        current_workspace is None
        or current_repo is None
        or not authority_current
        or current_workspace.archived_at is not None
        or current_workspace.generation != snapshot.workspace_generation
        or current_repo.generation != snapshot.repo_generation
        or (
            current_workspace.repo_environment_id,
            current_workspace.git_branch,
            current_workspace.git_base_branch,
            current_workspace.anyharness_workspace_id,
        )
        != (
            snapshot.repo_environment_id,
            snapshot.git_branch,
            snapshot.git_base_branch,
            snapshot.anyharness_workspace_id,
        )
        or (
            current_repo.git_provider,
            current_repo.git_owner,
            current_repo.git_repo_name,
            current_repo.environment_kind,
            current_repo.default_branch,
        )
        != (
            snapshot.git_provider,
            snapshot.git_owner,
            snapshot.git_repo_name,
            snapshot.environment_kind,
            snapshot.default_branch,
        )
    ):
        raise CloudApiError(
            "workflow_source_fence_changed",
            "Source authority or repository identity changed while resolving.",
            status_code=409,
        )
    # GitHub deliberately masks some authorization failures as 404. Interpret
    # branch absence only after the cached authority proof has been re-locked.
    if provider_status == "missing":
        raise CloudApiError(
            "workflow_source_selected_branch_unresolved",
            "The target workspace's selected branch does not exist on GitHub.",
            status_code=409,
        ) from None
    if provider_status != "resolved" or resolved_commit is None:
        raise CloudApiError(
            "workflow_source_provider_failed",
            "Could not resolve the target repository commit from GitHub.",
            status_code=502,
        ) from None
    if not re.fullmatch(r"[0-9a-f]{40}", resolved_commit):
        raise CloudApiError(
            "workflow_source_commit_unresolved",
            "The target workspace branch does not resolve to an exact GitHub commit.",
            status_code=409,
        )
    return CloudRunTarget(
        anyharness_workspace_id=snapshot.anyharness_workspace_id,
        source_intent={
            "kind": "remote_commit",
            "repo": f"github.com/{snapshot.git_owner}/{snapshot.git_repo_name}",
            "ref": f"refs/heads/{snapshot.git_branch}",
            "resolvedCommit": resolved_commit,
        },
    )
