from __future__ import annotations

from datetime import datetime
from typing import Protocol
from uuid import UUID


class WorkspaceRecord(Protocol):
    id: UUID
    target_id: UUID | None
    display_name: str | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str | None
    origin: str
    origin_json: str | None
    status: str
    status_detail: str | None
    last_error: str | None
    template_version: str
    runtime_generation: int
    anyharness_workspace_id: str | None
    worktree_path: str | None
    archived_at: datetime | None
    ready_at: datetime | None
    cleanup_state: str
    cleanup_last_error: str | None
    materialized_target_id: UUID | None
    repo_post_ready_phase: str
    repo_post_ready_files_total: int
    repo_post_ready_files_applied: int
    repo_post_ready_started_at: datetime | None
    repo_post_ready_completed_at: datetime | None
    repo_files_last_failed_path: str | None
    updated_at: datetime
    created_at: datetime


class WorkspaceExposureRecord(Protocol):
    id: UUID
    visibility: str
    claimed_by_user_id: UUID | None
    default_projection_level: str
    commandable: bool
    status: str
    last_projected_at: datetime | None


class WorkspaceClaimRecord(Protocol):
    id: UUID
    claimed_by_user_id: UUID | None
    claimed_at: datetime
    source_kind: str


class WorkspaceSessionSummaryRecord(Protocol):
    target_id: UUID
    workspace_id: str | None
    session_id: str
    source_agent_kind: str | None
    title: str | None
    status: str
    phase: str | None
    last_event_at: str | None
    pending_interaction_count: int
    preview: str | None


class RuntimeEnvironmentRecord(Protocol):
    id: UUID
    status: str
    runtime_generation: int


class WorkspaceBillingRecord(Protocol):
    plan: str
    billing_mode: str
    included_hours: float | None
    start_blocked: bool
    start_block_reason: str | None
    active_spend_hold: bool
    hold_reason: str | None
    remaining_seconds: float | None
    overage_enabled: bool
    overage_cap_cents_per_seat: int | None
    managed_cloud_overage_used_cents: int
    active_sandbox_count: int
    active_environment_limit: int | None
