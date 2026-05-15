"""Shared automation run claim value objects."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from proliferate.db.models.automations import AutomationRun


@dataclass(frozen=True)
class AutomationRunClaimValue:
    id: UUID
    automation_id: UUID
    user_id: UUID
    status: str
    execution_target: str
    title: str
    prompt: str
    git_provider: str
    git_owner: str
    git_repo_name: str
    cloud_target_id_snapshot: UUID | None
    cloud_target_kind_snapshot: str | None
    agent_kind: str | None
    model_id: str | None
    mode_id: str | None
    reasoning_effort: str | None
    executor_kind: str
    executor_id: str
    claim_id: UUID
    claim_expires_at: datetime
    cloud_workspace_id: UUID | None
    anyharness_workspace_id: str | None
    anyharness_session_id: str | None


def claim_value(run: AutomationRun) -> AutomationRunClaimValue:
    if (
        run.executor_kind is None
        or run.executor_id is None
        or run.claim_id is None
        or run.claim_expires_at is None
    ):
        raise RuntimeError("Automation run claim was loaded without active claim metadata.")
    return AutomationRunClaimValue(
        id=run.id,
        automation_id=run.automation_id,
        user_id=run.user_id,
        status=run.status,
        execution_target=run.execution_target,
        title=run.title_snapshot,
        prompt=run.prompt_snapshot,
        git_provider=run.git_provider_snapshot,
        git_owner=run.git_owner_snapshot,
        git_repo_name=run.git_repo_name_snapshot,
        cloud_target_id_snapshot=run.cloud_target_id_snapshot,
        cloud_target_kind_snapshot=run.cloud_target_kind_snapshot,
        agent_kind=run.agent_kind_snapshot,
        model_id=run.model_id_snapshot,
        mode_id=run.mode_id_snapshot,
        reasoning_effort=run.reasoning_effort_snapshot,
        executor_kind=run.executor_kind,
        executor_id=run.executor_id,
        claim_id=run.claim_id,
        claim_expires_at=run.claim_expires_at,
        cloud_workspace_id=run.cloud_workspace_id,
        anyharness_workspace_id=run.anyharness_workspace_id,
        anyharness_session_id=run.anyharness_session_id,
    )
