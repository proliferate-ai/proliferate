"""Executor claim persistence for automation runs."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
    AUTOMATION_EXECUTOR_KIND_DESKTOP,
    AUTOMATION_OWNER_SCOPE_ORGANIZATION,
    AUTOMATION_RUN_STATUS_CLAIMED,
    AUTOMATION_RUN_STATUS_FAILED,
    AUTOMATION_RUN_STATUS_QUEUED,
    AUTOMATION_TARGET_MODE_LOCAL,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
    AUTOMATION_TARGET_MODE_SHARED_CLOUD,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.automations import AutomationRun
from proliferate.db.store.automation_run_claim_values import (
    AutomationRunClaimValue,
    claim_value,
)


class ClaimFailure(Protocol):
    code: str
    message: str


class ClaimTransitionRule(Protocol):
    allowed_statuses: frozenset[str]
    requires_cloud_workspace: bool
    requires_anyharness_workspace: bool
    requires_anyharness_session: bool


class LocalAutomationRepoIdentity(Protocol):
    provider: str
    owner: str
    name: str


class ClaimActivePredicate(Protocol):
    def __call__(self, claim_expires_at: datetime | None, now: datetime) -> bool: ...


async def _run_self_committing[T](operation: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async with db_engine.async_session_factory() as db:
        result = await operation(db)
        await db.commit()
        return result


async def load_claimed_run_for_update(
    db: AsyncSession,
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    allowed_statuses: frozenset[str],
    execution_target: str,
    executor_kind: str,
    claim_is_active: ClaimActivePredicate,
    user_id: UUID | None = None,
) -> AutomationRun | None:
    target_mode_predicate = (
        AutomationRun.target_mode == AUTOMATION_TARGET_MODE_LOCAL
        if execution_target == AUTOMATION_EXECUTION_TARGET_LOCAL
        else AutomationRun.target_mode.in_(
            [AUTOMATION_TARGET_MODE_PERSONAL_CLOUD, AUTOMATION_TARGET_MODE_SHARED_CLOUD]
        )
    )
    predicates = [
        AutomationRun.id == run_id,
        AutomationRun.claim_id == claim_id,
        target_mode_predicate,
        AutomationRun.executor_kind == executor_kind,
        AutomationRun.status.in_(allowed_statuses),
    ]
    if user_id is not None:
        predicates.append(
            or_(
                AutomationRun.owner_user_id == user_id,
                and_(
                    AutomationRun.owner_scope == AUTOMATION_OWNER_SCOPE_ORGANIZATION,
                    AutomationRun.created_by_user_id == user_id,
                ),
            )
        )

    run = (
        await db.execute(select(AutomationRun).where(*predicates).with_for_update())
    ).scalar_one_or_none()
    if run is None or not claim_is_active(run.claim_expires_at, now):
        return None
    return run


def clear_claim_metadata(run: AutomationRun) -> None:
    run.executor_kind = None
    run.executor_id = None
    run.claim_id = None
    run.claim_expires_at = None


def _fail_unconfigured_agent(
    run: AutomationRun,
    now: datetime,
    failure: ClaimFailure,
) -> None:
    run.status = AUTOMATION_RUN_STATUS_FAILED
    run.failed_at = now
    run.last_error_code = failure.code
    run.last_error_message = failure.message
    clear_claim_metadata(run)
    run.updated_at = now


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
        return await _claim_automation_runs(
            db,
            executor_id=executor_id,
            executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            claim_ttl=claim_ttl,
            limit=limit,
            now=now,
            reclaimable_statuses=reclaimable_statuses,
            unconfigured_agent_failure=unconfigured_agent_failure,
            user_id=None,
            repo_identities=None,
        )

    return await _run_self_committing(operation)


async def claim_local_automation_runs(
    db: AsyncSession | None = None,
    *,
    user_id: UUID,
    executor_id: str,
    available_repositories: list[LocalAutomationRepoIdentity],
    claim_ttl: timedelta,
    limit: int,
    now: datetime,
    reclaimable_statuses: frozenset[str],
    unconfigured_agent_failure: ClaimFailure,
) -> list[AutomationRunClaimValue]:
    identities = {
        (identity.provider, identity.owner, identity.name)
        for identity in available_repositories
        if identity.provider and identity.owner and identity.name
    }
    if not identities:
        return []
    repo_identities = sorted(identities)

    async def operation(session: AsyncSession) -> list[AutomationRunClaimValue]:
        return await _claim_automation_runs(
            session,
            executor_id=executor_id,
            executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
            execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
            claim_ttl=claim_ttl,
            limit=limit,
            now=now,
            reclaimable_statuses=reclaimable_statuses,
            unconfigured_agent_failure=unconfigured_agent_failure,
            user_id=user_id,
            repo_identities=repo_identities,
        )

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def _claim_automation_runs(
    db: AsyncSession,
    *,
    executor_id: str,
    executor_kind: str,
    execution_target: str,
    claim_ttl: timedelta,
    limit: int,
    now: datetime,
    reclaimable_statuses: frozenset[str],
    unconfigured_agent_failure: ClaimFailure,
    user_id: UUID | None,
    repo_identities: list[tuple[str, str, str]] | None,
) -> list[AutomationRunClaimValue]:
    predicates = [
        (
            AutomationRun.target_mode == AUTOMATION_TARGET_MODE_LOCAL
            if execution_target == AUTOMATION_EXECUTION_TARGET_LOCAL
            else AutomationRun.target_mode.in_(
                [AUTOMATION_TARGET_MODE_PERSONAL_CLOUD, AUTOMATION_TARGET_MODE_SHARED_CLOUD]
            )
        ),
        or_(
            AutomationRun.status == AUTOMATION_RUN_STATUS_QUEUED,
            (
                AutomationRun.status.in_(reclaimable_statuses)
                & (AutomationRun.claim_expires_at.is_not(None))
                & (AutomationRun.claim_expires_at <= now)
            ),
        ),
    ]
    if user_id is not None:
        predicates.append(AutomationRun.owner_user_id == user_id)
    if repo_identities is not None:
        predicates.append(
            or_(
                *[
                    and_(
                        func.lower(AutomationRun.git_provider_snapshot) == provider,
                        func.lower(AutomationRun.git_owner_snapshot) == owner,
                        func.lower(AutomationRun.git_repo_name_snapshot) == name,
                    )
                    for provider, owner, name in repo_identities
                ]
            )
        )

    rows = list(
        (
            await db.execute(
                select(AutomationRun)
                .where(*predicates)
                .order_by(AutomationRun.created_at.asc(), AutomationRun.id.asc())
                .limit(max(1, limit))
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    expires_at = now + claim_ttl
    values: list[AutomationRunClaimValue] = []
    for run in rows:
        if run.agent_run_config_snapshot_json is None:
            _fail_unconfigured_agent(run, now, unconfigured_agent_failure)
            continue
        run.status = AUTOMATION_RUN_STATUS_CLAIMED
        run.executor_kind = executor_kind
        run.executor_id = executor_id
        run.claim_id = uuid4()
        run.claimed_at = now
        run.claim_expires_at = expires_at
        run.last_heartbeat_at = now
        run.failed_at = None
        run.last_error_code = None
        run.last_error_message = None
        run.updated_at = now
        values.append(claim_value(run))
    return values


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
    async with db_engine.async_session_factory() as db:
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
            return None
        return claim_value(run)


async def heartbeat_run_claim(
    db: AsyncSession | None = None,
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
    async def operation(session: AsyncSession) -> AutomationRunClaimValue | None:
        return await _heartbeat_run_claim(
            session,
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

    return await operation(db) if db is not None else await _run_self_committing(operation)


async def _heartbeat_run_claim(
    db: AsyncSession,
    *,
    run_id: UUID,
    claim_id: UUID,
    claim_ttl: timedelta,
    now: datetime,
    active_statuses: frozenset[str],
    claim_is_active: ClaimActivePredicate,
    execution_target: str,
    executor_kind: str,
    user_id: UUID | None,
) -> AutomationRunClaimValue | None:
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
        return None
    run.claim_expires_at = now + claim_ttl
    run.last_heartbeat_at = now
    run.updated_at = now
    return claim_value(run)


async def sweep_expired_dispatching_runs(
    db: AsyncSession,
    *,
    now: datetime,
    dispatching_status: str,
    dispatch_uncertain_failure: ClaimFailure,
    limit: int = 100,
) -> int:
    if limit <= 0:
        return 0

    runs = list(
        (
            await db.execute(
                select(AutomationRun)
                .where(
                    AutomationRun.status == dispatching_status,
                    AutomationRun.claim_expires_at.is_not(None),
                    AutomationRun.claim_expires_at <= now,
                )
                .order_by(AutomationRun.claim_expires_at.asc(), AutomationRun.id.asc())
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    for run in runs:
        run.status = AUTOMATION_RUN_STATUS_FAILED
        run.failed_at = now
        run.last_error_code = dispatch_uncertain_failure.code
        run.last_error_message = dispatch_uncertain_failure.message
        clear_claim_metadata(run)
        run.updated_at = now
    return len(runs)
