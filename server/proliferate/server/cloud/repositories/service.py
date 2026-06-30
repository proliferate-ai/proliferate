"""Repository and environment configuration orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.repositories import (
    RepoConfigValue,
    RepoEnvironmentValue,
    list_repo_configs_for_user,
    sync_cloud_environment_from_legacy_cloud_repo_config,
    upsert_local_repo_environment,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repo_config.models import SaveCloudRepoConfigRequest
from proliferate.server.cloud.repo_config.service import save_repo_config
from proliferate.server.cloud.repositories.models import (
    SaveCloudRepoEnvironmentRequest,
    SaveLocalRepoEnvironmentRequest,
)


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
    body: SaveLocalRepoEnvironmentRequest,
) -> RepoEnvironmentValue:
    desktop_install_id = body.desktop_install_id.strip()
    if not desktop_install_id:
        raise CloudApiError(
            "desktop_install_id_required",
            "A desktop install id is required for local environments.",
            status_code=400,
        )
    return await upsert_local_repo_environment(
        db,
        user_id=user_id,
        git_provider=body.git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        desktop_install_id=desktop_install_id,
        local_path=body.local_path,
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
    body: SaveCloudRepoEnvironmentRequest,
) -> RepoEnvironmentValue:
    legacy = await save_repo_config(
        db,
        user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        body=SaveCloudRepoConfigRequest(
            configured=body.configured,
            defaultBranch=body.default_branch,
            setupScript=body.setup_script,
            runCommand=body.run_command,
        ),
    )
    environment = await sync_cloud_environment_from_legacy_cloud_repo_config(
        db,
        cloud_repo_config_id=legacy.id,
    )
    if environment is None:
        raise RuntimeError("Cloud repo environment disappeared after save.")
    return environment
