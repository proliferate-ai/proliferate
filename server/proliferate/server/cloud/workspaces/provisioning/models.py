from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


class ProvisioningWorkspaceRecord(Protocol):
    id: UUID
    user_id: UUID
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str | None
    status: str
    status_detail: str | None
    updated_at: object
    ready_at: object | None
    anyharness_workspace_id: str | None
    last_error: str | None


@dataclass(frozen=True)
class ResolvedCloudWorkspaceCreate:
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str
    display_name: str | None
    active_sandbox_count: int
    selected_agent_kinds: tuple[str, ...]
    cloud_repo_limit: int | None
