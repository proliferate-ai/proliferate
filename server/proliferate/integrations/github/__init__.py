"""Public GitHub integration API."""

from proliferate.integrations.github import repos as _repos
from proliferate.integrations.github.repos import (
    GitHubIntegrationError,
    GitHubInvalidCursor,
    GitHubRateLimited,
    GitHubRepoAccessRequired,
    GitHubRepoBranches,
    GitHubRepoEmpty,
    GitHubRepositoryPage,
    GitHubRepositorySummary,
    GitHubUserProfile,
    get_github_repo_branches,
    get_github_user_profile,
    list_branches,
    list_github_repositories,
)

httpx = _repos.httpx

__all__ = [
    "GitHubIntegrationError",
    "GitHubInvalidCursor",
    "GitHubRateLimited",
    "GitHubRepoAccessRequired",
    "GitHubRepoBranches",
    "GitHubRepoEmpty",
    "GitHubRepositoryPage",
    "GitHubRepositorySummary",
    "GitHubUserProfile",
    "get_github_repo_branches",
    "get_github_user_profile",
    "httpx",
    "list_branches",
    "list_github_repositories",
]
