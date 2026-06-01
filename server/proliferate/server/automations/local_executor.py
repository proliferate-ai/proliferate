"""API-facing service for external desktop automation executors.

This module backs request-driven endpoints that let a desktop executor claim,
heartbeat, and record progress for local automation runs. It is intentionally
not under ``automations/worker`` because the server is not executing the work.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_EXECUTOR_KIND_DESKTOP,
    AUTOMATION_EXTERNAL_ID_MAX_LENGTH,
    AUTOMATION_LOCAL_CLAIM_MAX_LIMIT,
    AUTOMATION_LOCAL_CLAIM_TTL_SECONDS,
    AUTOMATION_LOCAL_ERROR_CODE_MAX_LENGTH,
    AUTOMATION_LOCAL_REPOSITORY_IDENTITIES_MAX_LIMIT,
)
from proliferate.db.store.automation_run_claim_transitions import (
    attach_anyharness_session_to_run,
    attach_anyharness_workspace_to_run,
    mark_run_creating_session,
    mark_run_creating_workspace,
    mark_run_dispatched,
    mark_run_dispatching,
    mark_run_failed,
    mark_run_provisioning_workspace,
)
from proliferate.db.store.automation_run_claim_values import (
    AutomationRunClaimValue,
)
from proliferate.db.store.automation_run_claims import (
    claim_local_automation_runs,
    heartbeat_run_claim,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    ACTIVE_CLAIM_STATUSES,
    ANYHARNESS_SESSION_ATTACHMENT_TRANSITION,
    ANYHARNESS_WORKSPACE_ATTACHMENT_TRANSITION,
    CREATING_SESSION_TRANSITION,
    CREATING_WORKSPACE_TRANSITION,
    DISPATCHED_TRANSITION,
    DISPATCHING_TRANSITION,
    RECLAIMABLE_STATUSES,
    automation_error_message,
    canonical_repo_identity,
    claim_is_active,
    provisioning_workspace_transition,
    unconfigured_agent_failure,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    normalize_local_error_code as map_local_error_code,
)
from proliferate.server.automations.domain.validation import normalize_required_text
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
from proliferate.utils.time import utcnow


def _normalize_executor_id(value: str) -> str:
    return normalize_required_text(
        value,
        field_name="executorId",
        max_length=AUTOMATION_EXTERNAL_ID_MAX_LENGTH,
    )


def _local_claim_ttl() -> timedelta:
    return timedelta(seconds=AUTOMATION_LOCAL_CLAIM_TTL_SECONDS)


def _local_mutation_response(
    value: AutomationRunClaimValue | None,
) -> LocalAutomationMutationResponse:
    return LocalAutomationMutationResponse(
        run=local_claim_payload(value) if value is not None else None,
        accepted=value is not None,
    )


def _normalize_local_error_code(value: str) -> str:
    error_code = normalize_required_text(
        value,
        field_name="errorCode",
        max_length=AUTOMATION_LOCAL_ERROR_CODE_MAX_LENGTH,
    )
    return map_local_error_code(error_code)


async def claim_local_runs(
    db: AsyncSession,
    user_id: UUID,
    body: LocalAutomationClaimRequest,
) -> LocalAutomationClaimListResponse:
    executor_id = _normalize_executor_id(body.executor_id)
    limit = max(1, min(body.limit, AUTOMATION_LOCAL_CLAIM_MAX_LIMIT))
    repositories = []
    for item in body.available_repositories[:AUTOMATION_LOCAL_REPOSITORY_IDENTITIES_MAX_LIMIT]:
        identity = canonical_repo_identity(item.provider, item.owner, item.name)
        if identity is not None:
            repositories.append(identity)

    values = await claim_local_automation_runs(
        db,
        user_id=user_id,
        executor_id=executor_id,
        available_repositories=repositories,
        claim_ttl=_local_claim_ttl(),
        limit=limit,
        now=utcnow(),
        reclaimable_statuses=RECLAIMABLE_STATUSES,
        unconfigured_agent_failure=unconfigured_agent_failure(),
    )
    return LocalAutomationClaimListResponse(runs=[local_claim_payload(value) for value in values])


async def heartbeat_local_run(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await heartbeat_run_claim(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        claim_ttl=_local_claim_ttl(),
        now=utcnow(),
        active_statuses=ACTIVE_CLAIM_STATUSES,
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def mark_local_run_creating_workspace(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await mark_run_creating_workspace(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        now=utcnow(),
        transition=CREATING_WORKSPACE_TRANSITION,
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def attach_local_run_workspace(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationAttachWorkspaceRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await attach_anyharness_workspace_to_run(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        anyharness_workspace_id=normalize_required_text(
            body.anyharness_workspace_id,
            field_name="anyharnessWorkspaceId",
            max_length=AUTOMATION_EXTERNAL_ID_MAX_LENGTH,
        ),
        now=utcnow(),
        transition=ANYHARNESS_WORKSPACE_ATTACHMENT_TRANSITION,
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def mark_local_run_provisioning_workspace(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await mark_run_provisioning_workspace(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        now=utcnow(),
        transition=provisioning_workspace_transition(AUTOMATION_EXECUTION_TARGET_LOCAL),
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def mark_local_run_creating_session(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationAttachWorkspaceRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await mark_run_creating_session(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        anyharness_workspace_id=normalize_required_text(
            body.anyharness_workspace_id,
            field_name="anyharnessWorkspaceId",
            max_length=AUTOMATION_EXTERNAL_ID_MAX_LENGTH,
        ),
        now=utcnow(),
        transition=CREATING_SESSION_TRANSITION,
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def attach_local_run_session(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationAttachSessionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    attached = await attach_anyharness_session_to_run(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        anyharness_workspace_id=normalize_required_text(
            body.anyharness_workspace_id,
            field_name="anyharnessWorkspaceId",
            max_length=AUTOMATION_EXTERNAL_ID_MAX_LENGTH,
        ),
        anyharness_session_id=normalize_required_text(
            body.anyharness_session_id,
            field_name="anyharnessSessionId",
            max_length=AUTOMATION_EXTERNAL_ID_MAX_LENGTH,
        ),
        now=utcnow(),
        transition=ANYHARNESS_SESSION_ATTACHMENT_TRANSITION,
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return LocalAutomationMutationResponse(run=None, accepted=attached)


async def mark_local_run_dispatching(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    value = await mark_run_dispatching(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        now=utcnow(),
        transition=DISPATCHING_TRANSITION,
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return _local_mutation_response(value)


async def mark_local_run_dispatched(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationAttachSessionRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    dispatched = await mark_run_dispatched(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        anyharness_workspace_id=normalize_required_text(
            body.anyharness_workspace_id,
            field_name="anyharnessWorkspaceId",
            max_length=AUTOMATION_EXTERNAL_ID_MAX_LENGTH,
        ),
        anyharness_session_id=normalize_required_text(
            body.anyharness_session_id,
            field_name="anyharnessSessionId",
            max_length=AUTOMATION_EXTERNAL_ID_MAX_LENGTH,
        ),
        now=utcnow(),
        transition=DISPATCHED_TRANSITION,
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return LocalAutomationMutationResponse(run=None, accepted=dispatched)


async def mark_local_run_failed(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalAutomationFailRequest,
) -> LocalAutomationMutationResponse:
    _normalize_executor_id(body.executor_id)
    error_code = _normalize_local_error_code(body.error_code)
    failed = await mark_run_failed(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        error_code=error_code,
        message=automation_error_message(error_code),
        now=utcnow(),
        active_statuses=ACTIVE_CLAIM_STATUSES,
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        user_id=user_id,
    )
    return LocalAutomationMutationResponse(run=None, accepted=failed)
