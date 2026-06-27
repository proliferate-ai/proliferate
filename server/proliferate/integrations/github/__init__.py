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
from proliferate.integrations.github.app_installations import (
    GitHubAppInstallationInfo,
    GitHubAppRepositoryCoverage,
    GitHubWebhookSignatureError,
    fetch_installation_repo_coverage_from_github,
    list_github_app_installations,
    verify_github_app_user_repo_access,
    verify_github_webhook_signature,
)
from proliferate.integrations.github.app_user_tokens import (
    GitHubAppInvalidGrant,
    GitHubAppUserAuthorization,
    exchange_github_app_code,
    refresh_github_app_user_authorization,
)

httpx = _repos.httpx

__all__ = [
    "GitHubIntegrationError",
    "GitHubAppInstallationInfo",
    "GitHubAppInvalidGrant",
    "GitHubAppRepositoryCoverage",
    "GitHubAppUserAuthorization",
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
    "exchange_github_app_code",
    "fetch_installation_repo_coverage_from_github",
    "httpx",
    "list_github_app_installations",
    "list_branches",
    "list_github_repositories",
    "refresh_github_app_user_authorization",
    "verify_github_app_user_repo_access",
    "verify_github_webhook_signature",
    "GitHubWebhookSignatureError",
]
