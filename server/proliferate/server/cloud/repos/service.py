from __future__ import annotations

import time

from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
from proliferate.db.models.auth import (
    OAuthAccount,
    User,
)
from proliferate.integrations.github import (
    GitHubIntegrationError,
    GitHubRepoAccessRequired,
    GitHubRepoBranches,
    get_github_repo_branches,
)
from proliferate.server.cloud._logging import log_cloud_event
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repos.models import RepoBranchesResponse
from proliferate.utils.time import duration_ms


def get_linked_github_account(user: User) -> OAuthAccount | None:
    for account in user.oauth_accounts:
        if getattr(account, "oauth_name", None) == SUPPORTED_GIT_PROVIDER:
            return account
    return None


def _require_github_access_token(user: User, message: str) -> str:
    github_account = get_linked_github_account(user)
    access_token = getattr(github_account, "access_token", None) if github_account else None
    if not access_token:
        raise CloudApiError(
            "github_link_required",
            message,
            status_code=400,
        )
    return str(access_token)


async def get_repo_branches_for_user(
    user: User,
    *,
    git_owner: str,
    git_repo_name: str,
    missing_access_message: str,
    repo_access_required_message: str | None = None,
) -> GitHubRepoBranches:
    access_token = _require_github_access_token(user, missing_access_message)
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


async def get_cloud_repo_branches(
    user: User,
    *,
    git_owner: str,
    git_repo_name: str,
) -> RepoBranchesResponse:
    branch_info = await get_repo_branches_for_user(
        user,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message="Connect a GitHub account before browsing cloud branches.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before browsing cloud branches."
        ),
    )
    log_cloud_event(
        "cloud repo branch metadata loaded",
        user_id=user.id,
        repo=f"{git_owner}/{git_repo_name}",
        default_branch=branch_info.default_branch,
        branch_count=len(branch_info.branches),
    )
    return RepoBranchesResponse(
        default_branch=branch_info.default_branch,
        branches=branch_info.branches,
    )
