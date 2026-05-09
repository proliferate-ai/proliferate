"""Pure automation run claim lifecycle rules."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_LOCAL_FALLBACK_ERROR_CODE,
    AUTOMATION_LOCAL_SHARED_ERROR_CODES,
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
class ClaimFailure:
    code: str
    message: str


@dataclass(frozen=True)
class ClaimTransitionRule:
    allowed_statuses: frozenset[str]
    requires_cloud_workspace: bool = False
    requires_anyharness_workspace: bool = False
    requires_anyharness_session: bool = False


@dataclass(frozen=True)
class ClaimIdentity:
    run_id: UUID
    claim_id: UUID | None
    execution_target: str
    executor_kind: str | None
    user_id: UUID | None


@dataclass(frozen=True)
class LocalAutomationRepoIdentity:
    provider: str
    owner: str
    name: str


CREATING_WORKSPACE_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CLAIMED})
)
CLOUD_WORKSPACE_CREATION_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_WORKSPACE})
)
CLOUD_WORKSPACE_ATTACHMENT_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset(
        {
            AUTOMATION_RUN_STATUS_CLAIMED,
            AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
            AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
        }
    )
)
ANYHARNESS_WORKSPACE_ATTACHMENT_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset(
        {
            AUTOMATION_RUN_STATUS_CLAIMED,
            AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
            AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
            AUTOMATION_RUN_STATUS_CREATING_SESSION,
        }
    )
)
CLOUD_PROVISIONING_WORKSPACE_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset(
        {
            AUTOMATION_RUN_STATUS_CLAIMED,
            AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
            AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
        }
    ),
    requires_cloud_workspace=True,
)
LOCAL_PROVISIONING_WORKSPACE_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=CLOUD_PROVISIONING_WORKSPACE_TRANSITION.allowed_statuses,
    requires_anyharness_workspace=True,
)
CREATING_SESSION_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset(
        {
            AUTOMATION_RUN_STATUS_CLAIMED,
            AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
            AUTOMATION_RUN_STATUS_CREATING_SESSION,
        }
    )
)
ANYHARNESS_SESSION_ATTACHMENT_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_SESSION})
)
DISPATCHING_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_SESSION}),
    requires_anyharness_workspace=True,
    requires_anyharness_session=True,
)
DISPATCHED_TRANSITION: Final = ClaimTransitionRule(
    allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_DISPATCHING})
)


def claim_is_active(claim_expires_at: datetime | None, now: datetime) -> bool:
    return claim_expires_at is not None and claim_expires_at > now


def is_reclaimable_status(status: str) -> bool:
    return status in RECLAIMABLE_STATUSES


def is_active_claim_status(status: str) -> bool:
    return status in ACTIVE_CLAIM_STATUSES


def is_terminal_status(status: str) -> bool:
    return status in TERMINAL_STATUSES


def is_expired_reclaimable_claim(
    status: str,
    claim_expires_at: datetime | None,
    now: datetime,
) -> bool:
    return (
        is_reclaimable_status(status) and claim_expires_at is not None and claim_expires_at <= now
    )


def is_expired_dispatching_claim(
    status: str,
    claim_expires_at: datetime | None,
    now: datetime,
) -> bool:
    return (
        status == AUTOMATION_RUN_STATUS_DISPATCHING
        and claim_expires_at is not None
        and claim_expires_at <= now
    )


def provisioning_workspace_transition(execution_target: str) -> ClaimTransitionRule:
    if execution_target == AUTOMATION_EXECUTION_TARGET_LOCAL:
        return LOCAL_PROVISIONING_WORKSPACE_TRANSITION
    return CLOUD_PROVISIONING_WORKSPACE_TRANSITION


def claim_identity_matches(expected: ClaimIdentity, actual: ClaimIdentity) -> bool:
    if actual.run_id != expected.run_id:
        return False
    if actual.claim_id != expected.claim_id:
        return False
    if actual.execution_target != expected.execution_target:
        return False
    if actual.executor_kind != expected.executor_kind:
        return False
    return expected.user_id is None or actual.user_id == expected.user_id


def unconfigured_agent_failure() -> ClaimFailure:
    return ClaimFailure(
        code=AUTOMATION_ERROR_AGENT_NOT_CONFIGURED,
        message=AUTOMATION_ERROR_AGENT_NOT_CONFIGURED_MESSAGE,
    )


def dispatch_uncertain_failure() -> ClaimFailure:
    return ClaimFailure(
        code=AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
        message=AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE,
    )


def automation_error_message(code: str) -> str:
    return AUTOMATION_ERROR_MESSAGES.get(code, AUTOMATION_ERROR_DEFAULT_MESSAGE)


def normalize_local_error_code(error_code: str) -> str:
    if error_code.startswith("local_") and error_code in AUTOMATION_ERROR_MESSAGES:
        return error_code
    if error_code in AUTOMATION_LOCAL_SHARED_ERROR_CODES:
        return error_code
    return AUTOMATION_LOCAL_FALLBACK_ERROR_CODE


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
