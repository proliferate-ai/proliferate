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
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    user_id: UUID
    status: str
    execution_target: str
    target_mode: str
    title: str
    prompt: str
    git_provider: str
    git_owner: str
    git_repo_name: str
    cloud_target_id_snapshot: UUID | None
    cloud_target_kind_snapshot: str | None
    cloud_agent_run_config_id_snapshot: UUID | None
    sandbox_profile_id: UUID | None
    cloud_workspace_exposure_id: UUID | None
    agent_run_config_snapshot_json: dict[str, object] | None
    cascade_attempt: int
    last_cascade_command_id: UUID | None
    last_cascade_reason: str | None
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


def _execution_target_for_target_mode(target_mode: str) -> str:
    return "local" if target_mode == "local" else "cloud"


def _snapshot_value(snapshot: dict[str, object] | None, key: str) -> str | None:
    if not snapshot:
        return None
    value = snapshot.get(key)
    return value if isinstance(value, str) and value else None


def _snapshot_control_value(snapshot: dict[str, object] | None, key: str) -> str | None:
    if not snapshot:
        return None
    controls = snapshot.get("control_values")
    if not isinstance(controls, dict):
        return None
    value = controls.get(key)
    return value if isinstance(value, str) and value else None


def _snapshot_config_id(snapshot: dict[str, object] | None) -> UUID | None:
    value = _snapshot_value(snapshot, "config_id")
    if value is None:
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


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
        owner_scope=run.owner_scope,
        owner_user_id=run.owner_user_id,
        organization_id=run.organization_id,
        user_id=run.owner_user_id or run.created_by_user_id,
        status=run.status,
        execution_target=_execution_target_for_target_mode(run.target_mode),
        target_mode=run.target_mode,
        title=run.title_snapshot,
        prompt=run.prompt_snapshot,
        git_provider=run.git_provider_snapshot,
        git_owner=run.git_owner_snapshot,
        git_repo_name=run.git_repo_name_snapshot,
        cloud_target_id_snapshot=run.cloud_target_id_snapshot,
        cloud_target_kind_snapshot=run.cloud_target_kind_snapshot,
        cloud_agent_run_config_id_snapshot=_snapshot_config_id(run.agent_run_config_snapshot_json),
        sandbox_profile_id=run.sandbox_profile_id,
        cloud_workspace_exposure_id=run.cloud_workspace_exposure_id,
        agent_run_config_snapshot_json=run.agent_run_config_snapshot_json,
        cascade_attempt=run.cascade_attempt,
        last_cascade_command_id=run.last_cascade_command_id,
        last_cascade_reason=run.last_cascade_reason,
        agent_kind=_snapshot_value(run.agent_run_config_snapshot_json, "agent_kind"),
        model_id=_snapshot_value(run.agent_run_config_snapshot_json, "model_id"),
        mode_id=_snapshot_control_value(run.agent_run_config_snapshot_json, "mode"),
        reasoning_effort=(
            _snapshot_control_value(run.agent_run_config_snapshot_json, "reasoning")
            or _snapshot_control_value(run.agent_run_config_snapshot_json, "effort")
        ),
        executor_kind=run.executor_kind,
        executor_id=run.executor_id,
        claim_id=run.claim_id,
        claim_expires_at=run.claim_expires_at,
        cloud_workspace_id=run.cloud_workspace_id,
        anyharness_workspace_id=run.anyharness_workspace_id,
        anyharness_session_id=run.anyharness_session_id,
    )
