from __future__ import annotations

import time
from collections.abc import Iterable
from typing import Protocol
from uuid import UUID

from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
from proliferate.integrations.github import (
    GitHubIntegrationError,
    GitHubRepoAccessRequired,
    GitHubRepoBranches,
    get_github_repo_branches,
)
from proliferate.server.cloud._logging import log_cloud_event
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repos.domain.github_credentials import (
    CloudRepoGitHubCredentials,
    OAuthAccountLike,
    build_cloud_repo_github_credentials,
    find_oauth_account,
)
from proliferate.server.cloud.repos.models import RepoBranchesResponse
from proliferate.utils.time import duration_ms


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
    except GitHubRepoAccessRequired as exc:
        raise CloudApiError(
            "github_repo_access_required",
            repo_access_required_message or str(exc),
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
    )
