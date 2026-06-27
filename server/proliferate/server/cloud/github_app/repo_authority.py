"""GitHub App authority gate for managed-cloud repositories."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import github_app as github_app_store
from proliferate.integrations.github import (
    GitHubAppInstallationInfo,
    GitHubAppInvalidGrant,
    GitHubIntegrationError,
    fetch_installation_repo_coverage_from_github,
    list_github_app_installations,
    refresh_github_app_user_authorization,
    verify_github_app_user_repo_access,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class GitHubCloudRepoAuthority:
    user_id: UUID
    git_owner: str
    git_repo_name: str
    token_kind: str
    actor_login: str
    github_user_id: str
    installation_id: str
    repository_id: str | None
    access_token: str = field(repr=False)


async def ensure_fresh_github_app_authorization(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> github_app_store.GitHubAppAuthorizationValue:
    authorization = await github_app_store.get_github_app_authorization_for_user(
        db,
        user_id=user_id,
        lock_row=True,
    )
    if authorization is None:
        raise CloudApiError(
            "github_app_authorization_required",
            "Connect the Proliferate GitHub App before using GitHub Cloud repos.",
            status_code=409,
        )
    if authorization.status == "needs_reauth":
        raise CloudApiError(
            "github_app_authorization_expired",
            "Reconnect the Proliferate GitHub App before using GitHub Cloud repos.",
            status_code=409,
        )
    if authorization.status != "ready":
        raise CloudApiError(
            "github_app_authorization_required",
            "Connect the Proliferate GitHub App before using GitHub Cloud repos.",
            status_code=409,
        )

    now = utcnow()
    if (
        authorization.token_expires_at is None
        or authorization.access_token is None
        or authorization.token_expires_at <= now + timedelta(minutes=10)
    ):
        if authorization.refresh_token is None:
            await github_app_store.mark_github_app_authorization_needs_reauth(
                db,
                authorization.id,
            )
            raise CloudApiError(
                "github_app_authorization_expired",
                "Reconnect the Proliferate GitHub App before using GitHub Cloud repos.",
                status_code=409,
            )
        try:
            refreshed = await refresh_github_app_user_authorization(
                refresh_token=authorization.refresh_token,
            )
        except GitHubAppInvalidGrant as exc:
            await github_app_store.mark_github_app_authorization_needs_reauth(
                db,
                authorization.id,
            )
            raise CloudApiError(
                "github_app_authorization_expired",
                "Reconnect the Proliferate GitHub App before using GitHub Cloud repos.",
                status_code=409,
            ) from exc
        except GitHubIntegrationError as exc:
            raise CloudApiError(
                "github_app_refresh_failed",
                "Could not refresh GitHub App authorization.",
                status_code=502,
            ) from exc
        authorization = await github_app_store.upsert_github_app_authorization(
            db,
            user_id=user_id,
            authorization=refreshed,
        )

    if authorization.access_token is None:
        raise CloudApiError(
            "github_app_authorization_required",
            "Connect the Proliferate GitHub App before using GitHub Cloud repos.",
            status_code=409,
        )
    return authorization


async def require_github_cloud_repo_authority(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> GitHubCloudRepoAuthority:
    authorization = await ensure_fresh_github_app_authorization(db, user_id=user_id)
    installations = await github_app_store.list_active_github_app_installations_for_owner(
        db,
        owner=git_owner,
    )
    if not installations:
        await _refresh_installation_cache(db)
        installations = await github_app_store.list_active_github_app_installations_for_owner(
            db,
            owner=git_owner,
        )
    if not installations:
        raise CloudApiError(
            "github_app_installation_required",
            "Install the Proliferate GitHub App for this repository.",
            status_code=409,
        )

    selected_installation = None
    selected_repository_id: str | None = None
    for installation in installations:
        if installation.repository_selection == "all":
            selected_installation = installation
            break

        cached = await github_app_store.get_fresh_installation_repo_cache(
            db,
            installation_id=installation.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
        if cached is not None:
            selected_installation = installation
            selected_repository_id = cached.github_repository_id
            break

        try:
            coverage = await fetch_installation_repo_coverage_from_github(
                user_access_token=authorization.access_token,
                installation_id=installation.github_installation_id,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
            )
        except GitHubIntegrationError as exc:
            raise CloudApiError(
                "github_app_repo_coverage_failed",
                "Could not verify GitHub App repository access.",
                status_code=502,
            ) from exc
        await github_app_store.upsert_installation_repo_cache(
            db,
            installation_id=installation.id,
            owner=git_owner,
            name=git_repo_name,
            coverage=coverage,
        )
        if coverage.covered:
            selected_installation = installation
            selected_repository_id = coverage.repository_id
            break

    if selected_installation is None:
        raise CloudApiError(
            "github_app_repo_not_covered",
            "Grant the Proliferate GitHub App access to this repository.",
            status_code=409,
        )

    try:
        actor_has_access = await verify_github_app_user_repo_access(
            user_access_token=authorization.access_token,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    except GitHubIntegrationError as exc:
        raise CloudApiError(
            "github_repo_access_check_failed",
            "Could not verify your GitHub access to this repository.",
            status_code=502,
        ) from exc
    if not actor_has_access:
        raise CloudApiError(
            "github_repo_access_required",
            "Your GitHub user must have access to this repository.",
            status_code=409,
        )

    return GitHubCloudRepoAuthority(
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        token_kind="github_app_user_to_server",
        actor_login=authorization.github_login,
        github_user_id=authorization.github_user_id,
        installation_id=selected_installation.github_installation_id,
        repository_id=selected_repository_id,
        access_token=authorization.access_token,
    )


async def _refresh_installation_cache(db: AsyncSession) -> None:
    try:
        installations = await list_github_app_installations()
    except GitHubIntegrationError:
        return
    for installation in installations:
        await github_app_store.upsert_github_app_installation(
            db,
            installation=GitHubAppInstallationInfo(
                github_installation_id=installation.github_installation_id,
                account_login=installation.account_login,
                account_type=installation.account_type,
                repository_selection=installation.repository_selection,
                permissions=installation.permissions,
                suspended_at=installation.suspended_at,
            ),
        )
