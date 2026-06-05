from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class CloudWorkspaceHandoffOpValue:
    id: UUID
    mobility_workspace_id: UUID
    user_id: UUID
    direction: str
    source_owner: str
    target_owner: str
    phase: str
    requested_branch: str
    requested_base_sha: str | None
    exclude_paths: tuple[str, ...]
    failure_code: str | None
    failure_detail: str | None
    started_at: datetime
    heartbeat_at: datetime
    finalized_at: datetime | None
    cleanup_completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    canonical_side: str = "source"


@dataclass(frozen=True)
class CloudWorkspaceMobilityValue:
    id: UUID
    user_id: UUID
    display_name: str | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    owner: str
    lifecycle_state: str
    status_detail: str | None
    last_error: str | None
    cloud_workspace_id: UUID | None
    active_handoff_op_id: UUID | None
    last_handoff_op_id: UUID | None
    cloud_lost_at: datetime | None
    cloud_lost_reason: str | None
    created_at: datetime
    updated_at: datetime
    active_handoff: CloudWorkspaceHandoffOpValue | None


@dataclass(frozen=True)
class CloudWorkspaceMoveCleanupItemInput:
    item_kind: str
    target_id: UUID | None = None
    anyharness_workspace_id: str | None = None
    object_id: UUID | None = None


@dataclass(frozen=True)
class CloudWorkspaceMoveCleanupItemValue:
    id: UUID
    handoff_op_id: UUID
    item_kind: str
    target_id: UUID | None
    anyharness_workspace_id: str | None
    object_id: UUID | None
    status: str
    attempt_count: int
    next_attempt_at: datetime
    error_code: str | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
