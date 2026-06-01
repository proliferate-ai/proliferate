"""Transaction wrappers for cloud automation claim mutations."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
)
from proliferate.db import engine as db_engine
from proliferate.db.store import automation_run_claim_transitions as transition_store
from proliferate.db.store import automation_run_claims as claim_store
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.automation_run_claims import (
    ClaimActivePredicate,
    ClaimFailure,
    ClaimTransitionRule,
)


async def _run_in_session[T](operation: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async with db_engine.async_session_factory() as db:
        return await operation(db)


async def _run_in_transaction[T](operation: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async with db_engine.async_session_factory() as db, db.begin():
        return await operation(db)


async def claim_cloud_automation_runs(
    *,
    executor_id: str,
    claim_ttl: timedelta,
    limit: int,
    now: datetime,
    reclaimable_statuses: frozenset[str],
    unconfigured_agent_failure: ClaimFailure,
) -> list[AutomationRunClaimValue]:
    async def operation(db: AsyncSession) -> list[AutomationRunClaimValue]:
        return await claim_store.claim_cloud_automation_runs(
            db,
            executor_id=executor_id,
            claim_ttl=claim_ttl,
            limit=limit,
            now=now,
            reclaimable_statuses=reclaimable_statuses,
            unconfigured_agent_failure=unconfigured_agent_failure,
        )

    return await _run_in_transaction(operation)


async def load_current_run_claim(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    active_statuses: frozenset[str],
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        return await claim_store.load_current_run_claim(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            active_statuses=active_statuses,
            claim_is_active=claim_is_active,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )

    return await _run_in_session(operation)


async def heartbeat_run_claim(
    *,
    run_id: UUID,
    claim_id: UUID,
    claim_ttl: timedelta,
    now: datetime,
    active_statuses: frozenset[str],
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        return await claim_store.heartbeat_run_claim(
            db,
            run_id=run_id,
            claim_id=claim_id,
            claim_ttl=claim_ttl,
            now=now,
            active_statuses=active_statuses,
            claim_is_active=claim_is_active,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )

    return await _run_in_transaction(operation)


async def mark_run_creating_workspace(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        return await transition_store.mark_run_creating_workspace(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            transition=transition,
            claim_is_active=claim_is_active,
        )

    return await _run_in_transaction(operation)


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
        return await transition_store.attach_cloud_target_snapshot_to_run(
            db,
            run_id=run_id,
            claim_id=claim_id,
            cloud_target_id=cloud_target_id,
            cloud_target_kind=cloud_target_kind,
            sandbox_profile_id=sandbox_profile_id,
            now=now,
            transition=transition,
            claim_is_active=claim_is_active,
        )

    return await _run_in_transaction(operation)


async def attach_anyharness_workspace_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        return await transition_store.attach_anyharness_workspace_to_run(
            db,
            run_id=run_id,
            claim_id=claim_id,
            anyharness_workspace_id=anyharness_workspace_id,
            now=now,
            transition=transition,
            claim_is_active=claim_is_active,
            execution_target=execution_target,
            executor_kind=executor_kind,
        )

    return await _run_in_transaction(operation)


async def mark_run_provisioning_workspace(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        return await transition_store.mark_run_provisioning_workspace(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            transition=transition,
            claim_is_active=claim_is_active,
        )

    return await _run_in_transaction(operation)


async def mark_run_creating_session(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        return await transition_store.mark_run_creating_session(
            db,
            run_id=run_id,
            claim_id=claim_id,
            anyharness_workspace_id=anyharness_workspace_id,
            now=now,
            transition=transition,
            claim_is_active=claim_is_active,
        )

    return await _run_in_transaction(operation)


async def attach_anyharness_session_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> bool:
    async def operation(db: AsyncSession) -> bool:
        return await transition_store.attach_anyharness_session_to_run(
            db,
            run_id=run_id,
            claim_id=claim_id,
            anyharness_workspace_id=anyharness_workspace_id,
            anyharness_session_id=anyharness_session_id,
            now=now,
            transition=transition,
            claim_is_active=claim_is_active,
        )

    return await _run_in_transaction(operation)


async def mark_run_dispatching(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> AutomationRunClaimValue | None:
    async def operation(db: AsyncSession) -> AutomationRunClaimValue | None:
        return await transition_store.mark_run_dispatching(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            transition=transition,
            claim_is_active=claim_is_active,
        )

    return await _run_in_transaction(operation)


async def mark_run_dispatched(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> bool:
    async def operation(db: AsyncSession) -> bool:
        return await transition_store.mark_run_dispatched(
            db,
            run_id=run_id,
            claim_id=claim_id,
            anyharness_workspace_id=anyharness_workspace_id,
            anyharness_session_id=anyharness_session_id,
            now=now,
            transition=transition,
            claim_is_active=claim_is_active,
        )

    return await _run_in_transaction(operation)


async def mark_run_failed(
    *,
    run_id: UUID,
    claim_id: UUID,
    error_code: str,
    message: str,
    now: datetime,
    active_statuses: frozenset[str],
    claim_is_active: ClaimActivePredicate,
) -> bool:
    async def operation(db: AsyncSession) -> bool:
        return await transition_store.mark_run_failed(
            db,
            run_id=run_id,
            claim_id=claim_id,
            error_code=error_code,
            message=message,
            now=now,
            active_statuses=active_statuses,
            claim_is_active=claim_is_active,
        )

    return await _run_in_transaction(operation)
