"""Repository and environment configuration orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.repositories import (
    RepoConfigValue,
    RepoEnvironmentValue,
    list_repo_configs_for_user,
    upsert_cloud_repo_environment,
    upsert_local_repo_environment,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app.repo_authority import require_github_cloud_repo_authority
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.repos.domain.github_credentials import CloudRepoGitHubCredentials
from proliferate.server.cloud.repos.service import get_repo_branches_for_credentials
from proliferate.server.cloud.repositories.models import SaveRepoEnvironmentRequest


async def list_repositories(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[RepoConfigValue, ...]:
    return await list_repo_configs_for_user(db, user_id=user_id)


async def save_local_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    body: SaveRepoEnvironmentRequest,
) -> RepoEnvironmentValue:
    desktop_install_id = (body.desktop_install_id or "").strip()
    if not desktop_install_id:
        raise CloudApiError(
            "desktop_install_id_required",
            "A desktop install id is required for local environments.",
            status_code=400,
        )
    return await upsert_local_repo_environment(
        db,
        user_id=user_id,
        git_provider=body.git_provider.value,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        desktop_install_id=desktop_install_id,
        local_path=body.local_path or "",
        default_branch=body.default_branch,
        setup_script=body.setup_script,
        run_command=body.run_command,
    )


async def save_cloud_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    body: SaveRepoEnvironmentRequest,
) -> RepoEnvironmentValue:
    authority = await require_github_cloud_repo_authority(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    default_branch = body.default_branch
    if default_branch is not None and default_branch.strip():
        repo_branches = await get_repo_branches_for_credentials(
            CloudRepoGitHubCredentials(user_id=user_id, access_token=authority.access_token),
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            missing_access_message=(
                "Connect the Proliferate GitHub App before setting a cloud default branch."
            ),
            repo_access_required_message=(
                "Reconnect the Proliferate GitHub App and grant repository access before "
                "setting a cloud default branch."
            ),
        )
        if default_branch not in repo_branches.branches:
            raise CloudApiError(
                "github_branch_not_found",
                f"The default branch '{default_branch}' was not found on GitHub.",
                status_code=400,
            )
    repo_environment = await upsert_cloud_repo_environment(
        db,
        user_id=user_id,
        git_provider="github",
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        default_branch=default_branch,
        setup_script=body.setup_script,
        run_command=body.run_command,
    )
    await materialization_service.schedule_materialize_repo_environment(
        db,
        repo_environment_id=repo_environment.id,
    )
    return repo_environment


async def save_repo_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    body: SaveRepoEnvironmentRequest,
) -> RepoEnvironmentValue:
    if body.kind.value == "local":
        if not body.local_path:
            raise CloudApiError(
                "local_path_required",
                "A local path is required for local environments.",
                status_code=400,
            )
        return await save_local_environment(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            body=body,
        )
    return await save_cloud_environment(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        body=body,
    )
