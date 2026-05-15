"""Execution context objects for cloud automation stages."""

from __future__ import annotations

from dataclasses import dataclass, replace
from uuid import UUID

from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue


@dataclass(frozen=True)
class TargetExecutionContext:
    target_id: UUID
    target_kind: str
    default_workspace_root: str | None
    organization_id: UUID | None
    status: str
    ready_agent_kinds: tuple[str, ...] = ()


@dataclass(frozen=True)
class WorkspaceExecutionContext:
    cloud_workspace_id: UUID
    anyharness_workspace_id: str
    anyharness_repo_root_id: str | None
    path: str
    branch: str | None
    target_config_id: UUID | None = None
    target_config_version: int | None = None


@dataclass(frozen=True)
class SessionExecutionContext:
    anyharness_session_id: str


@dataclass(frozen=True)
class AutomationExecutionContext:
    claim: AutomationRunClaimValue
    target: TargetExecutionContext | None = None
    workspace: WorkspaceExecutionContext | None = None
    session: SessionExecutionContext | None = None

    def with_claim(self, claim: AutomationRunClaimValue) -> AutomationExecutionContext:
        return replace(self, claim=claim)

    def with_target(self, target: TargetExecutionContext) -> AutomationExecutionContext:
        return replace(self, target=target)

    def with_workspace(self, workspace: WorkspaceExecutionContext) -> AutomationExecutionContext:
        return replace(self, workspace=workspace)

    def with_session(self, session: SessionExecutionContext) -> AutomationExecutionContext:
        return replace(self, session=session)
