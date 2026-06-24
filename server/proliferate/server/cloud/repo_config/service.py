from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import get_ready_github_grant_for_user
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigLimitExceededError,
    CloudRepoConfigSummaryValue,
    CloudRepoConfigValue,
    CloudRepoFileInput,
    bootstrap_cloud_repo_config_for_user,
    get_cloud_repo_config,
    get_organization_cloud_repo_config,
    list_cloud_repo_configs,
    list_organization_cloud_repo_configs,
    load_cloud_repo_config_for_user,
    save_cloud_repo_config,
    save_cloud_repo_file,
    save_organization_cloud_repo_config,
)
from proliferate.db.store.cloud_slack import repo_routing_profiles as slack_routing_profile_store
from proliferate.db.store.managed_sandboxes import load_personal_managed_sandbox
from proliferate.server.billing.snapshots import (
    get_billing_snapshot,
    get_billing_snapshot_for_request,
    repo_limit_for_billing_snapshot,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.repo_config.access import require_organization_repo_config_admin
from proliferate.server.cloud.repo_config.models import (
    PutCloudRepoFileRequest,
    SaveCloudRepoConfigRequest,
    SaveOrganizationCloudRepoConfigRequest,
)
from proliferate.server.cloud.repo_config.validation import (
    normalize_env_vars,
    normalize_repo_file_path,
    validate_tracked_file_content,
)
from proliferate.server.cloud.repos.domain.github_credentials import CloudRepoGitHubCredentials
from proliferate.server.cloud.repos.service import get_repo_branches_for_credentials


async def list_repo_configs(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudRepoConfigSummaryValue]:
    return await list_cloud_repo_configs(db, user_id)


async def list_organization_repo_configs(
    db: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> list[CloudRepoConfigValue]:
    await require_organization_repo_config_admin(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    return await list_organization_cloud_repo_configs(db, organization_id=organization_id)


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


async def get_organization_repo_config(
    db: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue | None:
    await require_organization_repo_config_admin(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    return await get_organization_cloud_repo_config(
        db,
        organization_id=organization_id,
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


async def _validate_repo_access_and_default_branch(
    db: AsyncSession,
    user_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
    default_branch: str | None,
    require_access: bool,
) -> str | None:
    normalized_default_branch = (default_branch or "").strip() or None
    if normalized_default_branch is None and not require_access:
        return None

    github_grant = await get_ready_github_grant_for_user(db, user_id=user_id)
    if github_grant is None:
        raise CloudApiError(
            "github_link_required",
            "Connect a GitHub account before setting a cloud default branch.",
            status_code=400,
        )

    repo_branches = await get_repo_branches_for_credentials(
        CloudRepoGitHubCredentials(user_id=user_id, access_token=github_grant.access_token),
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message="Connect a GitHub account before setting a cloud default branch.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before setting a cloud default branch."
        ),
    )
    if normalized_default_branch is None:
        return repo_branches.default_branch

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
    default_branch = await _validate_repo_access_and_default_branch(
        db,
        user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        default_branch=body.default_branch,
        require_access=body.configured,
    )
    files = (
        _normalize_files(
            [
                CloudRepoFileInput(relative_path=item.relative_path, content=item.content)
                for item in body.files
            ]
        )
        if body.files is not None
        else None
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
    _schedule_managed_sandbox_repo_materialization(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        configured=value.configured,
    )
    return value


async def save_organization_repo_config(
    db: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    git_owner: str,
    git_repo_name: str,
    body: SaveOrganizationCloudRepoConfigRequest,
) -> CloudRepoConfigValue:
    await require_organization_repo_config_admin(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    env_vars = normalize_env_vars(body.env_vars)
    default_branch = await _validate_repo_access_and_default_branch(
        db,
        user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        default_branch=body.default_branch,
        require_access=body.configured,
    )
    files = (
        _normalize_files(
            [
                CloudRepoFileInput(relative_path=item.relative_path, content=item.content)
                for item in body.files
            ]
        )
        if body.files is not None
        else None
    )
    value = await save_organization_cloud_repo_config(
        db,
        organization_id=organization_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        configured=body.configured,
        default_branch=default_branch,
        env_vars=env_vars,
        setup_script=body.setup_script,
        run_command=body.run_command,
        files=files,
    )
    if value.configured:
        await slack_routing_profile_store.upsert_profile(
            db,
            cloud_repo_config_id=value.id,
            organization_id=organization_id,
            display_name=f"{value.git_owner}/{value.git_repo_name}",
            description=None,
        )
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
    _schedule_managed_sandbox_repo_materialization(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        configured=value.configured,
    )
    return value


async def load_repo_config_value(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue | None:
    return await load_cloud_repo_config_for_user(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )


async def bootstrap_repo_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue:
    billing_snapshot = await get_billing_snapshot(user_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)
    try:
        value = await bootstrap_cloud_repo_config_for_user(
            db,
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
    _schedule_managed_sandbox_repo_materialization(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        configured=value.configured,
    )
    return value


def _schedule_managed_sandbox_repo_materialization(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    configured: bool,
) -> None:
    if not configured:
        return

    async def _run() -> None:
        async with db_engine.async_session_factory() as fresh_db:
            sandbox = await load_personal_managed_sandbox(fresh_db, user_id)
            if sandbox is None or sandbox.status != "ready":
                return
            github_grant = await get_ready_github_grant_for_user(fresh_db, user_id=user_id)
            if github_grant is None:
                return
            repo_config = await get_cloud_repo_config(
                fresh_db,
                user_id=user_id,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
            )
            if repo_config is None or not repo_config.configured:
                return
            from proliferate.server.cloud.managed_sandboxes.repo_materialization import (
                ensure_repo_materialized,
            )

            try:
                await ensure_repo_materialized(
                    fresh_db,
                    sandbox=sandbox,
                    repo_config=repo_config,
                    github_token=github_grant.access_token,
                    run_setup=False,
                )
            except Exception as exc:
                log_cloud_event(
                    "managed sandbox repo materialization failed after repo config save",
                    managed_sandbox_id=sandbox.id,
                    cloud_repo_config_id=repo_config.id,
                    repo=f"{git_owner}/{git_repo_name}",
                    error=format_exception_message(exc),
                    error_type=exc.__class__.__name__,
                )
                return
            await db_engine.commit_session(fresh_db)

    db_engine.defer_after_commit(db, _run)
