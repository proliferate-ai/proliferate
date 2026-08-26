from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


class OAuthAccountLike(Protocol):
    oauth_name: object
    access_token: object


@dataclass(frozen=True)
class CloudRepoGitHubCredentials:
    user_id: UUID
    access_token: str | None


def find_oauth_account(
    oauth_accounts: Iterable[OAuthAccountLike],
    *,
    oauth_name: str,
) -> OAuthAccountLike | None:
    for account in oauth_accounts:
        if getattr(account, "oauth_name", None) == oauth_name:
            return account
    return None


def build_cloud_repo_github_credentials(
    *,
    user_id: UUID,
    oauth_accounts: Iterable[OAuthAccountLike],
    oauth_name: str,
) -> CloudRepoGitHubCredentials:
    account = find_oauth_account(oauth_accounts, oauth_name=oauth_name)
    access_token = getattr(account, "access_token", None) if account else None
    return CloudRepoGitHubCredentials(
        user_id=user_id,
        access_token=str(access_token) if access_token else None,
    )
