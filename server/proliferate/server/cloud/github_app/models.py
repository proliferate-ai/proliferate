"""Wire models for GitHub App cloud authorization."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class GitHubAppConnectResponse(BaseModel):
    authorization_url: str = Field(serialization_alias="authorizationUrl")


GitHubAppStatusAction = Literal[
    "connect",
    "reauthorize",
    "install",
    "grant_repo_access",
    "manage",
]


class GitHubAppStatusResponse(BaseModel):
    connected: bool
    github_login: str | None = Field(default=None, serialization_alias="githubLogin")
    status: str | None = None
    token_expires_at: datetime | None = Field(
        default=None,
        serialization_alias="tokenExpiresAt",
    )
    installation_state: str | None = Field(default=None, serialization_alias="installationState")
    repo_covered: bool | None = Field(default=None, serialization_alias="repoCovered")
    action: GitHubAppStatusAction | None = None
