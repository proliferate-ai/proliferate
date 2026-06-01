from __future__ import annotations

import time
from collections.abc import Iterable
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
from proliferate.db.store.cloud_repo_config import list_cloud_repo_configs
from proliferate.integrations.github import (
    GitHubIntegrationError,
    GitHubInvalidCursor,
    GitHubRateLimited,
    GitHubRepoAccessRequired,
    GitHubRepoBranches,
    GitHubRepoEmpty,
    get_github_repo_branches,
    list_github_repositories,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.repos.domain.catalog import (
    CloudGitRepositoriesPageRecord,
    CloudGitRepositoryRecord,
    RepoConfigState,
    normalized_repo_key,
)
from proliferate.server.cloud.repos.domain.github_credentials import (
    CloudRepoGitHubCredentials,
    OAuthAccountLike,
    build_cloud_repo_github_credentials,
    find_oauth_account,
)
from proliferate.server.cloud.repos.models import RepoBranchesResponse
from proliferate.utils.time import duration_ms

SUPPORTED_VISIBILITIES = {"all", "public", "private"}
SUPPORTED_AFFILIATIONS = {"owner", "collaborator", "organization_member"}
DEFAULT_REPO_AFFILIATION = "owner,collaborator,organization_member"
DEFAULT_REPO_VISIBILITY = "all"


class CloudRepoUserLike(Protocol):
    id: UUID
    oauth_accounts: Iterable[OAuthAccountLike]


def get_linked_github_account(user: CloudRepoUserLike) -> OAuthAccountLike | None:
    return find_oauth_account(
        user.oauth_accounts,
        oauth_name=SUPPORTED_GIT_PROVIDER,
    )


def build_cloud_repo_credentials_for_user(
    user: CloudRepoUserLike,
) -> CloudRepoGitHubCredentials:
    return build_cloud_repo_github_credentials(
        user_id=user.id,
        oauth_accounts=user.oauth_accounts,
        oauth_name=SUPPORTED_GIT_PROVIDER,
    )


def _require_github_access_token(
    credentials: CloudRepoGitHubCredentials,
    message: str,
) -> str:
    if not credentials.access_token:
        raise CloudApiError(
            "github_link_required",
            message,
            status_code=400,
        )
    return credentials.access_token


def _rate_limit_detail(exc: GitHubRateLimited) -> dict[str, object]:
    detail: dict[str, object] = {}
    if exc.retry_after_seconds is not None:
        detail["retryAfterSeconds"] = exc.retry_after_seconds
    if exc.rate_limit_reset_at is not None:
        detail["rateLimitResetAt"] = exc.rate_limit_reset_at
    return detail


def _rate_limit_headers(exc: GitHubRateLimited) -> dict[str, str]:
    headers: dict[str, str] = {}
    if exc.retry_after_seconds is not None:
        headers["Retry-After"] = str(exc.retry_after_seconds)
    return headers


def _github_rate_limited_error(exc: GitHubRateLimited) -> CloudApiError:
    return CloudApiError(
        "github_rate_limited",
        "GitHub is rate limiting repository browsing. Try again later.",
        status_code=429,
        extra_detail=_rate_limit_detail(exc),
        headers=_rate_limit_headers(exc),
    )


def _validate_repo_catalog_params(
    *,
    query: str | None,
    limit: int,
    affiliation: str,
    visibility: str,
) -> tuple[str | None, int, str, str]:
    if limit < 1 or limit > 100:
        raise CloudApiError(
            "invalid_repo_catalog_query",
            "Repository catalog limit must be between 1 and 100.",
            status_code=400,
        )
    normalized_visibility = visibility.strip().lower()
    if normalized_visibility not in SUPPORTED_VISIBILITIES:
        raise CloudApiError(
            "invalid_repo_catalog_query",
            "Repository catalog visibility is invalid.",
            status_code=400,
        )
    affiliation_parts = [part.strip().lower() for part in affiliation.split(",") if part.strip()]
    has_invalid_affiliation = any(part not in SUPPORTED_AFFILIATIONS for part in affiliation_parts)
    if not affiliation_parts or has_invalid_affiliation:
        raise CloudApiError(
            "invalid_repo_catalog_query",
            "Repository catalog affiliation is invalid.",
            status_code=400,
        )
    normalized_query = (query or "").strip().lower() or None
    if normalized_query is not None and len(normalized_query) > 120:
        raise CloudApiError(
            "invalid_repo_catalog_query",
            "Repository catalog query is too long.",
            status_code=400,
        )
    return normalized_query, limit, ",".join(affiliation_parts), normalized_visibility


async def get_repo_branches_for_credentials(
    credentials: CloudRepoGitHubCredentials,
    *,
    git_owner: str,
    git_repo_name: str,
    missing_access_message: str,
    repo_access_required_message: str | None = None,
) -> GitHubRepoBranches:
    access_token = _require_github_access_token(credentials, missing_access_message)
    lookup_started = time.perf_counter()
    try:
        branch_info = await get_github_repo_branches(access_token, git_owner, git_repo_name)
    except GitHubRateLimited as exc:
        raise _github_rate_limited_error(exc) from exc
    except GitHubRepoAccessRequired as exc:
        raise CloudApiError(
            "github_repo_access_required",
            repo_access_required_message or str(exc),
            status_code=400,
        ) from exc
    except GitHubRepoEmpty as exc:
        raise CloudApiError(
            "github_repo_empty",
            str(exc),
            status_code=400,
        ) from exc
    except GitHubIntegrationError as exc:
        raise CloudApiError(
            "github_branch_lookup_failed",
            str(exc),
            status_code=502,
        ) from exc
    log_cloud_event(
        "github repo branches loaded",
        repo=f"{git_owner}/{git_repo_name}",
        default_branch=branch_info.default_branch,
        branch_count=len(branch_info.branches),
        elapsed_ms=duration_ms(lookup_started),
    )
    return branch_info


async def list_cloud_repositories(
    db: AsyncSession,
    credentials: CloudRepoGitHubCredentials,
    *,
    query: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    affiliation: str = DEFAULT_REPO_AFFILIATION,
    visibility: str = DEFAULT_REPO_VISIBILITY,
) -> CloudGitRepositoriesPageRecord:
    access_token = _require_github_access_token(
        credentials,
        "Connect a GitHub account before browsing cloud repositories.",
    )
    normalized_query, normalized_limit, normalized_affiliation, normalized_visibility = (
        _validate_repo_catalog_params(
            query=query,
            limit=limit,
            affiliation=affiliation,
            visibility=visibility,
        )
    )
    lookup_started = time.perf_counter()
    try:
        github_page = await list_github_repositories(
            access_token,
            cursor=cursor,
            limit=normalized_limit,
            affiliation=normalized_affiliation,
            visibility=normalized_visibility,
        )
    except GitHubInvalidCursor as exc:
        raise CloudApiError(
            "invalid_repo_catalog_query",
            str(exc),
            status_code=400,
        ) from exc
    except GitHubRateLimited as exc:
        raise _github_rate_limited_error(exc) from exc
    except GitHubRepoAccessRequired as exc:
        raise CloudApiError(
            "github_repo_access_required",
            str(exc),
            status_code=400,
        ) from exc
    except GitHubIntegrationError as exc:
        raise CloudApiError(
            "github_repo_list_failed",
            str(exc),
            status_code=502,
        ) from exc

    config_states: dict[str, RepoConfigState] = {
        normalized_repo_key(config.git_owner, config.git_repo_name): (
            "configured" if config.configured else "disabled"
        )
        for config in await list_cloud_repo_configs(db, credentials.user_id)
    }
    records: list[CloudGitRepositoryRecord] = []
    for repo in github_page.repositories:
        if normalized_query and (
            normalized_query not in repo.full_name.lower()
            and normalized_query not in repo.owner.lower()
            and normalized_query not in repo.name.lower()
        ):
            continue
        config_state = config_states.get(
            normalized_repo_key(repo.owner, repo.name),
            "missing",
        )
        records.append(
            CloudGitRepositoryRecord(
                provider="github",
                git_owner=repo.owner,
                git_repo_name=repo.name,
                full_name=repo.full_name,
                default_branch=repo.default_branch,
                private=repo.private,
                fork=repo.fork,
                archived=repo.archived,
                disabled=repo.disabled,
                html_url=repo.html_url,
                owner_avatar_url=repo.owner_avatar_url,
                pushed_at=repo.pushed_at,
                updated_at=repo.updated_at,
                permission=repo.permission,
                configured=config_state == "configured",
                repo_config_state=config_state,
            )
        )
    log_cloud_event(
        "cloud github repos listed",
        user_id=credentials.user_id,
        repo_count=len(records),
        has_next_cursor=github_page.next_cursor is not None,
        query_present=normalized_query is not None,
        elapsed_ms=duration_ms(lookup_started),
    )
    return CloudGitRepositoriesPageRecord(
        repositories=tuple(records),
        next_cursor=github_page.next_cursor,
    )


async def get_repo_branches_for_user(
    user: CloudRepoUserLike,
    *,
    git_owner: str,
    git_repo_name: str,
    missing_access_message: str,
    repo_access_required_message: str | None = None,
) -> GitHubRepoBranches:
    return await get_repo_branches_for_credentials(
        build_cloud_repo_credentials_for_user(user),
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message=missing_access_message,
        repo_access_required_message=repo_access_required_message,
    )


async def get_cloud_repo_branches(
    credentials: CloudRepoGitHubCredentials,
    *,
    git_owner: str,
    git_repo_name: str,
) -> RepoBranchesResponse:
    branch_info = await get_repo_branches_for_credentials(
        credentials,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message="Connect a GitHub account before browsing cloud branches.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before browsing cloud branches."
        ),
    )
    log_cloud_event(
        "cloud repo branch metadata loaded",
        user_id=credentials.user_id,
        repo=f"{git_owner}/{git_repo_name}",
        default_branch=branch_info.default_branch,
        branch_count=len(branch_info.branches),
    )
    return RepoBranchesResponse(
        default_branch=branch_info.default_branch,
        branches=branch_info.branches,
        permission=branch_info.permission,
        private=branch_info.private,
        fork=branch_info.fork,
        archived=branch_info.archived,
        disabled=branch_info.disabled,
    )
