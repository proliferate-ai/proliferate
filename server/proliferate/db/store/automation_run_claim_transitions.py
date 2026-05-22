"""Executor claim transition persistence for automation runs."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
    AUTOMATION_EXECUTOR_KIND_DESKTOP,
    AUTOMATION_RUN_STATUS_CREATING_SESSION,
    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
    AUTOMATION_RUN_STATUS_DISPATCHED,
    AUTOMATION_RUN_STATUS_DISPATCHING,
    AUTOMATION_RUN_STATUS_FAILED,
    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.automations import AutomationRun
from proliferate.db.store.automation_run_claim_values import (
    AutomationRunClaimValue,
    claim_value,
)
from proliferate.db.store.automation_run_claims import (
    ClaimActivePredicate,
    ClaimTransitionRule,
    clear_claim_metadata,
    load_claimed_run_for_update,
)


async def _run_self_committing[T](operation: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async with db_engine.async_session_factory() as db:
        result = await operation(db)
        await db.commit()
        return result


def _transition_requirements_satisfied(
    run: AutomationRun,
    rule: ClaimTransitionRule,
) -> bool:
    if rule.requires_cloud_workspace and run.cloud_workspace_id is None:
        return False
    if rule.requires_anyharness_workspace and run.anyharness_workspace_id is None:
        return False
    return not (rule.requires_anyharness_session and run.anyharness_session_id is None)


async def _load_run_for_transition(
    db: AsyncSession,
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    transition: ClaimTransitionRule,
    execution_target: str,
    executor_kind: str,
    claim_is_active: ClaimActivePredicate,
    user_id: UUID | None = None,
) -> AutomationRun | None:
    run = await load_claimed_run_for_update(
        db,
        run_id=run_id,
        claim_id=claim_id,
        now=now,
        allowed_statuses=transition.allowed_statuses,
        execution_target=execution_target,
        executor_kind=executor_kind,
        claim_is_active=claim_is_active,
        user_id=user_id,
    )
    if run is None or not _transition_requirements_satisfied(run, transition):
        return None
    return run


async def _mark_claim_status(
    db: AsyncSession,
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    status: str,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str,
    executor_kind: str,
    user_id: UUID | None = None,
    anyharness_workspace_id: str | None = None,
    dispatch_started_at: datetime | None = None,
) -> AutomationRunClaimValue | None:
    run = await _load_run_for_transition(
        db,
        run_id=run_id,
        claim_id=claim_id,
        now=now,
        transition=transition,
        execution_target=execution_target,
        executor_kind=executor_kind,
        claim_is_active=claim_is_active,
        user_id=user_id,
    )
    if run is None:
        return None
    run.status = status
    if anyharness_workspace_id is not None:
        run.anyharness_workspace_id = anyharness_workspace_id
    if dispatch_started_at is not None:
        run.dispatch_started_at = dispatch_started_at
    run.updated_at = now
    return claim_value(run)


async def mark_run_creating_workspace(
    db: AsyncSession | None = None,
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> AutomationRunClaimValue | None:
    async def operation(session: AsyncSession) -> AutomationRunClaimValue | None:
        return await _mark_claim_status(
            session,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            status=AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
            transition=transition,
            claim_is_active=claim_is_active,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def attach_cloud_workspace_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    cloud_workspace_id: UUID,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> bool:
    async def operation(db: AsyncSession) -> bool:
        run = await _load_run_for_transition(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            transition=transition,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
            claim_is_active=claim_is_active,
        )
        if run is None:
            return False
        run.cloud_workspace_id = cloud_workspace_id
        run.updated_at = now
        return True

    return await _run_self_committing(operation)


async def attach_cloud_target_snapshot_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    cloud_target_id: UUID,
    cloud_target_kind: str,
    sandbox_profile_id: UUID | None = None,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        run = await _load_run_for_transition(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            transition=transition,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
            claim_is_active=claim_is_active,
        )
        if run is None:
            return None
        run.cloud_target_id_snapshot = cloud_target_id
        run.cloud_target_kind_snapshot = cloud_target_kind
        if sandbox_profile_id is not None:
            run.sandbox_profile_id = sandbox_profile_id
        run.updated_at = now
        return claim_value(run)

    return await _run_self_committing(operation)


async def attach_anyharness_workspace_to_run(
    db: AsyncSession | None = None,
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_LOCAL,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_DESKTOP,
    user_id: UUID | None = None,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        run = await _load_run_for_transition(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            transition=transition,
            execution_target=execution_target,
            executor_kind=executor_kind,
            claim_is_active=claim_is_active,
            user_id=user_id,
        )
        if run is None:
            return None
        run.anyharness_workspace_id = anyharness_workspace_id
        run.updated_at = now
        return claim_value(run)

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def mark_run_provisioning_workspace(
    db: AsyncSession | None = None,
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> AutomationRunClaimValue | None:
    async def operation(session: AsyncSession) -> AutomationRunClaimValue | None:
        return await _mark_claim_status(
            session,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            status=AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
            transition=transition,
            claim_is_active=claim_is_active,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def mark_run_creating_session(
    db: AsyncSession | None = None,
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> AutomationRunClaimValue | None:
    async def operation(session: AsyncSession) -> AutomationRunClaimValue | None:
        return await _mark_claim_status(
            session,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            status=AUTOMATION_RUN_STATUS_CREATING_SESSION,
            transition=transition,
            claim_is_active=claim_is_active,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
            anyharness_workspace_id=anyharness_workspace_id,
        )

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def attach_anyharness_session_to_run(
    db: AsyncSession | None = None,
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> bool:
    async def operation(db: AsyncSession) -> bool:
        run = await _load_run_for_transition(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            transition=transition,
            execution_target=execution_target,
            executor_kind=executor_kind,
            claim_is_active=claim_is_active,
            user_id=user_id,
        )
        if run is None:
            return False
        run.anyharness_workspace_id = anyharness_workspace_id
        run.anyharness_session_id = anyharness_session_id
        run.updated_at = now
        return True

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def mark_run_dispatching(
    db: AsyncSession | None = None,
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> AutomationRunClaimValue | None:
    async def operation(session: AsyncSession) -> AutomationRunClaimValue | None:
        return await _mark_claim_status(
            session,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            status=AUTOMATION_RUN_STATUS_DISPATCHING,
            transition=transition,
            claim_is_active=claim_is_active,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
            dispatch_started_at=now,
        )

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def mark_run_dispatched(
    db: AsyncSession | None = None,
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> bool:
    async def operation(db: AsyncSession) -> bool:
        run = await _load_run_for_transition(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            transition=transition,
            execution_target=execution_target,
            executor_kind=executor_kind,
            claim_is_active=claim_is_active,
            user_id=user_id,
        )
        if run is None:
            return False
        run.status = AUTOMATION_RUN_STATUS_DISPATCHED
        run.dispatched_at = now
        run.anyharness_workspace_id = anyharness_workspace_id
        run.anyharness_session_id = anyharness_session_id
        clear_claim_metadata(run)
        run.updated_at = now
        return True

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def mark_run_failed(
    db: AsyncSession | None = None,
    *,
    run_id: UUID,
    claim_id: UUID,
    error_code: str,
    message: str,
    now: datetime,
    active_statuses: frozenset[str],
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> bool:
    async def operation(db: AsyncSession) -> bool:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=active_statuses,
            execution_target=execution_target,
            executor_kind=executor_kind,
            claim_is_active=claim_is_active,
            user_id=user_id,
        )
        if run is None:
            return False
        run.status = AUTOMATION_RUN_STATUS_FAILED
        run.failed_at = now
        run.last_error_code = error_code
        run.last_error_message = message
        clear_claim_metadata(run)
        run.updated_at = now
        return True

    return await operation(db) if db is not None else await _run_self_committing(operation)
