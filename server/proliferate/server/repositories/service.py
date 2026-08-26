"""Repository and environment configuration orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.repositories import (
    RepoConfigValue,
    RepoEnvironmentValue,
    get_cloud_repo_environment,
    list_repo_configs_for_user,
    update_repo_config_commit_instructions,
    upsert_cloud_repo_environment,
    upsert_local_repo_environment,
)
from proliferate.db.store.repositories import (
    remove_cloud_repo_environment as remove_cloud_repo_environment_row,
)
from proliferate.server.api_errors import CloudApiError
from proliferate.server.github.repo_authority import require_github_cloud_repo_authority
from proliferate.server.github.repos.domain.github_credentials import CloudRepoGitHubCredentials
from proliferate.server.github.repos.service import get_repo_branches_for_credentials
from proliferate.server.repositories.models import (
    RepoConfigResponse,
    RepoEnvironmentResponse,
    SaveRepoEnvironmentRequest,
    UpdateRepoConfigRequest,
    repo_environment_payload,
)


async def list_repositories(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[RepoConfigValue, ...]:
    return await list_repo_configs_for_user(db, user_id=user_id)


async def repo_environment_response(
    db: AsyncSession,
    *,
    user_id: UUID,
    environment: RepoEnvironmentValue,
) -> RepoEnvironmentResponse:
    return repo_environment_payload(environment)


async def repo_config_response(
    db: AsyncSession,
    *,
    user_id: UUID,
    value: RepoConfigValue,
) -> RepoConfigResponse:
    environments = [
        await repo_environment_response(db, user_id=user_id, environment=environment)
        for environment in value.environments
    ]
    return RepoConfigResponse(
        id=value.id,
        git_provider=value.git_provider,
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        commit_instructions=value.commit_instructions,
        environments=environments,
    )


async def update_repo_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    body: UpdateRepoConfigRequest,
) -> RepoConfigValue:
    return await update_repo_config_commit_instructions(
        db,
        user_id=user_id,
        git_provider="github",
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        commit_instructions=body.commit_instructions,
    )


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
    worker = await runtime_workers_store.get_active_desktop_worker_for_user(
        db,
        owner_user_id=user_id,
        desktop_install_id=desktop_install_id,
    )
    if worker is None:
        raise CloudApiError(
            "desktop_install_not_owned",
            "This desktop installation is not registered to your account.",
            status_code=403,
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
        archive_script=body.archive_script,
        rerun_setup_on_unarchive=body.rerun_setup_on_unarchive,
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
        archive_script=body.archive_script,
        rerun_setup_on_unarchive=body.rerun_setup_on_unarchive,
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


async def remove_cloud_repo_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> None:
    environment = await get_cloud_repo_environment(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        lock_mode="update",
    )
    if environment is None:
        return
    await remove_cloud_repo_environment_row(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
