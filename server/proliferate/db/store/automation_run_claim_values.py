"""Shared automation run claim value objects and error copy."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from proliferate.db.models.automations import AutomationRun
from proliferate.db.store.automations import (
    AUTOMATION_RUN_STATUS_CANCELLED,
    AUTOMATION_RUN_STATUS_CLAIMED,
    AUTOMATION_RUN_STATUS_CREATING_SESSION,
    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
    AUTOMATION_RUN_STATUS_DISPATCHED,
    AUTOMATION_RUN_STATUS_DISPATCHING,
    AUTOMATION_RUN_STATUS_FAILED,
    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
)

AUTOMATION_ERROR_DISPATCH_UNCERTAIN: Final = "dispatch_uncertain"
AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE: Final = (
    "Prompt delivery could not be confirmed after the executor stopped responding."
)
AUTOMATION_ERROR_AGENT_NOT_CONFIGURED: Final = "agent_not_configured"
AUTOMATION_ERROR_AGENT_NOT_CONFIGURED_MESSAGE: Final = (
    "Choose an agent before this automation can run."
)
AUTOMATION_ERROR_MESSAGES: Final = {
    AUTOMATION_ERROR_AGENT_NOT_CONFIGURED: AUTOMATION_ERROR_AGENT_NOT_CONFIGURED_MESSAGE,
    "agent_not_ready": "The requested cloud agent is not ready in the runtime.",
    "user_not_found": "The automation owner is no longer available.",
    "workspace_missing": "The cloud workspace for this run could not be found.",
    "workspace_create_stale_claim": "The executor lost its claim while creating the workspace.",
    "workspace_provision_failed": "Cloud workspace provisioning failed.",
    "runtime_not_ready": "The runtime was not ready.",
    "session_create_failed": "The runtime could not create a session.",
    "config_apply_failed": "The runtime could not apply the requested configuration.",
    "prompt_send_failed": "The runtime could not accept the automation prompt.",
    "stale_claim": "The executor lost its claim before the run was dispatched.",
    "unexpected_executor_error": "The executor could not dispatch this run.",
    "local_repo_not_available": "This repository is not available in the local runtime.",
    "local_agent_not_ready": "The requested local agent is not ready in the runtime.",
    "local_workspace_create_failed": "The local worktree could not be created or reused.",
    "local_workspace_setup_failed": "The local worktree setup script did not complete.",
    "local_session_create_failed": "The local runtime could not create a session.",
    "local_config_apply_failed": "The local runtime could not apply the requested configuration.",
    "local_prompt_send_failed": "The local runtime could not accept the automation prompt.",
    "local_unexpected_executor_error": "The local executor could not dispatch this run.",
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN: AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE,
}
AUTOMATION_ERROR_DEFAULT_MESSAGE: Final = "The executor could not dispatch this run."

RECLAIMABLE_STATUSES: Final = frozenset(
    {
        AUTOMATION_RUN_STATUS_CLAIMED,
        AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
        AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
        AUTOMATION_RUN_STATUS_CREATING_SESSION,
    }
)
ACTIVE_CLAIM_STATUSES: Final = frozenset(
    {
        AUTOMATION_RUN_STATUS_CLAIMED,
        AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
        AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
        AUTOMATION_RUN_STATUS_CREATING_SESSION,
        AUTOMATION_RUN_STATUS_DISPATCHING,
    }
)
TERMINAL_STATUSES: Final = frozenset(
    {
        AUTOMATION_RUN_STATUS_DISPATCHED,
        AUTOMATION_RUN_STATUS_FAILED,
        AUTOMATION_RUN_STATUS_CANCELLED,
    }
)


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


@dataclass(frozen=True)
class LocalAutomationRepoIdentity:
    provider: str
    owner: str
    name: str


def automation_error_message(code: str) -> str:
    return AUTOMATION_ERROR_MESSAGES.get(code, AUTOMATION_ERROR_DEFAULT_MESSAGE)


def canonical_repo_identity(
    provider: str,
    owner: str,
    name: str,
) -> LocalAutomationRepoIdentity | None:
    normalized_provider = provider.strip().lower()
    normalized_owner = owner.strip().lower()
    normalized_name = name.strip().lower()
    if not normalized_provider or not normalized_owner or not normalized_name:
        return None
    return LocalAutomationRepoIdentity(
        provider=normalized_provider,
        owner=normalized_owner,
        name=normalized_name,
    )


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
