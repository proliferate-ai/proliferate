from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
from proliferate.db.models.auth import User
from proliferate.server.cloud.repos.domain.github_credentials import (
    CloudRepoGitHubCredentials,
    build_cloud_repo_github_credentials,
)


def current_cloud_repo_github_credentials(
    user: User = Depends(current_active_user),
) -> CloudRepoGitHubCredentials:
    return build_cloud_repo_github_credentials(
        user_id=user.id,
        oauth_accounts=user.oauth_accounts,
        oauth_name=SUPPORTED_GIT_PROVIDER,
    )


CloudRepoGitHubCredentialsDependency = Annotated[
    CloudRepoGitHubCredentials,
    Depends(current_cloud_repo_github_credentials),
]
