"""Pure value objects for cloud repo-config status payloads."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class CloudRepoFileMetadataValue:
    relative_path: str
    content_sha256: str
    byte_size: int
    updated_at: datetime
    last_synced_at: datetime


@dataclass(frozen=True)
class CloudWorkspaceRepoConfigStatusValue:
    workspace_id: UUID
    current_repo_files_version: int
    repo_files_applied_version: int
    repo_files_applied_at: datetime | None
    files_out_of_sync: bool
    tracked_files: tuple[CloudRepoFileMetadataValue, ...]
    env_var_keys: tuple[str, ...]
    post_ready_phase: str
    post_ready_files_total: int
    post_ready_files_applied: int
    post_ready_started_at: datetime | None
    post_ready_completed_at: datetime | None
    last_apply_failed_path: str | None
    last_apply_error: str | None


@dataclass(frozen=True)
class CloudWorkspaceSetupRunValue:
    workspace_id: UUID
    command: str
    terminal_id: str | None
    command_run_id: str | None
    status: str
