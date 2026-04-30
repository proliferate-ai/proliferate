"""Local automation executor service operations."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from proliferate.db.store.automation_run_claim_values import (
    AUTOMATION_ERROR_MESSAGES,
    AutomationRunClaimValue,
    automation_error_message,
    canonical_repo_identity,
)
from proliferate.db.store.automation_run_claims import (
    attach_anyharness_session_to_run,
    attach_anyharness_workspace_to_run,
    claim_local_automation_runs,
    heartbeat_run_claim,
    mark_run_creating_session,
    mark_run_creating_workspace,
    mark_run_dispatched,
    mark_run_dispatching,
    mark_run_failed,
    mark_run_provisioning_workspace,
)
from proliferate.db.store.automations import (
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_EXECUTOR_KIND_DESKTOP,
)
from proliferate.server.automations.models import (
    LocalAutomationAttachSessionRequest,
    LocalAutomationAttachWorkspaceRequest,
    LocalAutomationClaimActionRequest,
    LocalAutomationClaimListResponse,
    LocalAutomationClaimRequest,
    LocalAutomationFailRequest,
    LocalAutomationMutationResponse,
    local_claim_payload,
)
from proliferate.server.automations.service import _normalize_required_text
from proliferate.utils.time import utcnow

DEFAULT_LOCAL_CLAIM_TTL_SECONDS = 300.0
MAX_LOCAL_CLAIM_LIMIT = 1
MAX_LOCAL_REPOSITORY_IDENTITIES = 200
LOCAL_FALLBACK_ERROR_CODE = "local_unexpected_executor_error"
LOCAL_SHARED_ERROR_CODES = frozenset(
    {
        "agent_not_configured",
        "dispatch_uncertain",
        "stale_claim",
    }
)


def _normalize_executor_id(value: str) -> str:
    return _normalize_required_text(value, field_name="executorId", max_length=255)


def _local_claim_ttl() -> timedelta:
    return timedelta(seconds=DEFAULT_LOCAL_CLAIM_TTL_SECONDS)


def _local_mutation_response(
    value: AutomationRunClaimValue | None,
) -> LocalAutomationMutationResponse:
    return LocalAutomationMutationResponse(
        run=local_claim_payload(value) if value is not None else None,
        accepted=value is not None,
    )


def _normalize_local_error_code(value: str) -> str:
    error_code = _normalize_required_text(value, field_name="errorCode", max_length=64)
    if error_code.startswith("local_") and error_code in AUTOMATION_ERROR_MESSAGES:
        return error_code
    if error_code in LOCAL_SHARED_ERROR_CODES:
        return error_code
    return LOCAL_FALLBACK_ERROR_CODE


async def claim_local_runs(
    user_id: UUID,
    body: LocalAutomationClaimRequest,
) -> LocalAutomationClaimListResponse:
    executor_id = _normalize_executor_id(body.executor_id)
    limit = max(1, min(body.limit, MAX_LOCAL_CLAIM_LIMIT))
    repositories = []
    for item in body.available_repositories[:MAX_LOCAL_REPOSITORY_IDENTITIES]:
        identity = canonical_repo_identity(item.provider, item.owner, item.name)
        if identity is not None:
            repositories.append(identity)

    values = await claim_local_automation_runs(
        user_id=user_id,
        executor_id=executor_id,
        available_repositories=repositories,
        claim_ttl=_local_claim_ttl(),
        limit=limit,
        now=utcnow(),
    )
    return LocalAutomationClaimListResponse(runs=[local_claim_payload(value) for value in values])


async def heartbeat_local_run(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await heartbeat_run_claim(
        run_id=run_id,
        claim_id=body.claim_id,
        claim_ttl=_local_claim_ttl(),
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def mark_local_run_creating_workspace(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await mark_run_creating_workspace(
        run_id=run_id,
        claim_id=body.claim_id,
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def attach_local_run_workspace(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationAttachWorkspaceRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await attach_anyharness_workspace_to_run(
        run_id=run_id,
        claim_id=body.claim_id,
        anyharness_workspace_id=_normalize_required_text(
            body.anyharness_workspace_id,
            field_name="anyharnessWorkspaceId",
            max_length=255,
        ),
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def mark_local_run_provisioning_workspace(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await mark_run_provisioning_workspace(
        run_id=run_id,
        claim_id=body.claim_id,
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def mark_local_run_creating_session(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationAttachWorkspaceRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await mark_run_creating_session(
        run_id=run_id,
        claim_id=body.claim_id,
        anyharness_workspace_id=_normalize_required_text(
            body.anyharness_workspace_id,
            field_name="anyharnessWorkspaceId",
            max_length=255,
        ),
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def attach_local_run_session(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationAttachSessionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    attached = await attach_anyharness_session_to_run(
        run_id=run_id,
        claim_id=body.claim_id,
        anyharness_workspace_id=_normalize_required_text(
            body.anyharness_workspace_id,
            field_name="anyharnessWorkspaceId",
            max_length=255,
        ),
        anyharness_session_id=_normalize_required_text(
            body.anyharness_session_id,
            field_name="anyharnessSessionId",
            max_length=255,
        ),
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return LocalAutomationMutationResponse(run=None, accepted=attached)


async def mark_local_run_dispatching(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await mark_run_dispatching(
        run_id=run_id,
        claim_id=body.claim_id,
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def mark_local_run_dispatched(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationAttachSessionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    dispatched = await mark_run_dispatched(
        run_id=run_id,
        claim_id=body.claim_id,
        anyharness_workspace_id=_normalize_required_text(
            body.anyharness_workspace_id,
            field_name="anyharnessWorkspaceId",
            max_length=255,
        ),
        anyharness_session_id=_normalize_required_text(
            body.anyharness_session_id,
            field_name="anyharnessSessionId",
            max_length=255,
        ),
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return LocalAutomationMutationResponse(run=None, accepted=dispatched)


async def mark_local_run_failed(
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationFailRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    error_code = _normalize_local_error_code(body.error_code)
    failed = await mark_run_failed(
        run_id=run_id,
        claim_id=body.claim_id,
        error_code=error_code,
        message=automation_error_message(error_code),
        now=utcnow(),
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return LocalAutomationMutationResponse(run=None, accepted=failed)
