from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.auth.identity.store import get_ready_github_grant_for_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.repos.domain.github_credentials import (
    CloudRepoGitHubCredentials,
)


async def current_cloud_repo_github_credentials(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudRepoGitHubCredentials:
    grant = await get_ready_github_grant_for_user(db, user_id=user.id)
    return CloudRepoGitHubCredentials(
        user_id=user.id,
        access_token=grant.access_token if grant is not None else None,
    )


CloudRepoGitHubCredentialsDependency = Annotated[
    CloudRepoGitHubCredentials,
    Depends(current_cloud_repo_github_credentials),
]
