"""Wire models for GitHub App cloud authorization."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class GitHubAppUserAuthorizationStartResponse(BaseModel):
    authorization_url: str = Field(serialization_alias="authorizationUrl")


class GitHubAppInstallationStartResponse(BaseModel):
    installation_url: str = Field(serialization_alias="installationUrl")


GitHubAppAuthorizationStatus = Literal["ready", "expired", "revoked", "needs_reauth"]


class GitHubAppUserAuthorizationStatusResponse(BaseModel):
    connected: bool
    github_login: str | None = Field(default=None, serialization_alias="githubLogin")
    status: GitHubAppAuthorizationStatus | None = None
    token_expires_at: datetime | None = Field(
        default=None,
        serialization_alias="tokenExpiresAt",
    )
    action: Literal["authorize", "reauthorize"] | None = None


class GitHubAppInstallationStatusResponse(BaseModel):
    installed: bool
    installation_id: str | None = Field(default=None, serialization_alias="installationId")
    account_login: str | None = Field(default=None, serialization_alias="accountLogin")
    account_type: str | None = Field(default=None, serialization_alias="accountType")
    repository_selection: str | None = Field(
        default=None,
        serialization_alias="repositorySelection",
    )
    suspended_at: datetime | None = Field(default=None, serialization_alias="suspendedAt")
    action: Literal["install", "manage"] | None = None


RepoAuthorityStatus = Literal[
    "ready",
    "missing_user_authorization",
    "expired_user_authorization",
    "missing_installation",
    "repo_not_covered",
    "missing_user_repo_access",
    "error",
]

RepoAuthorityAction = Literal[
    "authorize_user",
    "reauthorize_user",
    "install_app",
    "grant_repo_access",
]


class GitHubRepoAuthorityResponse(BaseModel):
    authorized: bool
    status: RepoAuthorityStatus
    action: RepoAuthorityAction | None = None
    message: str | None = None
