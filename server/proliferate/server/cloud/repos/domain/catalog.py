from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

RepoConfigState = Literal["missing", "disabled", "configured"]


@dataclass(frozen=True)
class CloudGitRepositoryRecord:
    provider: Literal["github"]
    git_owner: str
    git_repo_name: str
    full_name: str
    default_branch: str | None
    private: bool
    fork: bool
    archived: bool
    disabled: bool
    html_url: str | None
    owner_avatar_url: str | None
    pushed_at: str | None
    updated_at: str | None
    permission: str | None
    configured: bool
    repo_config_state: RepoConfigState


@dataclass(frozen=True)
class CloudGitRepositoriesPageRecord:
    repositories: tuple[CloudGitRepositoryRecord, ...]
    next_cursor: str | None


def normalized_repo_key(git_owner: str, git_repo_name: str) -> str:
    return f"{git_owner.strip().lower()}/{git_repo_name.strip().lower()}"
