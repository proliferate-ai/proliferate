"""Executor claim persistence for automation runs."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.automations import AutomationRun
from proliferate.db.store.automation_run_claim_values import (
    ACTIVE_CLAIM_STATUSES,
    AUTOMATION_ERROR_AGENT_NOT_CONFIGURED,
    AUTOMATION_ERROR_AGENT_NOT_CONFIGURED_MESSAGE,
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE,
    RECLAIMABLE_STATUSES,
    AutomationRunClaimValue,
    LocalAutomationRepoIdentity,
    claim_value,
)
from proliferate.db.store.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
    AUTOMATION_EXECUTOR_KIND_DESKTOP,
    AUTOMATION_RUN_STATUS_CLAIMED,
    AUTOMATION_RUN_STATUS_CREATING_SESSION,
    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
    AUTOMATION_RUN_STATUS_DISPATCHED,
    AUTOMATION_RUN_STATUS_DISPATCHING,
    AUTOMATION_RUN_STATUS_FAILED,
    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
    AUTOMATION_RUN_STATUS_QUEUED,
)


def _claim_is_active(run: AutomationRun, now: datetime) -> bool:
    return run.claim_expires_at is not None and run.claim_expires_at > now


async def load_claimed_run_for_update(
    db: AsyncSession,
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    allowed_statuses: frozenset[str],
    execution_target: str,
    executor_kind: str,
    user_id: UUID | None = None,
) -> AutomationRun | None:
    predicates = [
        AutomationRun.id == run_id,
        AutomationRun.claim_id == claim_id,
        AutomationRun.execution_target == execution_target,
        AutomationRun.executor_kind == executor_kind,
        AutomationRun.status.in_(allowed_statuses),
    ]
    if user_id is not None:
        predicates.append(AutomationRun.user_id == user_id)

    run = (
        await db.execute(select(AutomationRun).where(*predicates).with_for_update())
    ).scalar_one_or_none()
    if run is None or not _claim_is_active(run, now):
        return None
    return run


def _clear_claim(run: AutomationRun) -> None:
    run.executor_kind = None
    run.executor_id = None
    run.claim_id = None
    run.claim_expires_at = None


def _fail_unconfigured_agent(run: AutomationRun, now: datetime) -> None:
    run.status = AUTOMATION_RUN_STATUS_FAILED
    run.failed_at = now
    run.last_error_code = AUTOMATION_ERROR_AGENT_NOT_CONFIGURED
    run.last_error_message = AUTOMATION_ERROR_AGENT_NOT_CONFIGURED_MESSAGE
    _clear_claim(run)
    run.updated_at = now


async def claim_cloud_automation_runs(
    *,
    executor_id: str,
    claim_ttl: timedelta,
    limit: int,
    now: datetime,
) -> list[AutomationRunClaimValue]:
    return await _claim_automation_runs(
        executor_id=executor_id,
        executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
        execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        claim_ttl=claim_ttl,
        limit=limit,
        now=now,
        user_id=None,
        repo_identities=None,
    )


async def claim_local_automation_runs(
    *,
    user_id: UUID,
    executor_id: str,
    available_repositories: list[LocalAutomationRepoIdentity],
    claim_ttl: timedelta,
    limit: int,
    now: datetime,
) -> list[AutomationRunClaimValue]:
    identities = {
        (identity.provider, identity.owner, identity.name)
        for identity in available_repositories
        if identity.provider and identity.owner and identity.name
    }
    if not identities:
        return []
    return await _claim_automation_runs(
        executor_id=executor_id,
        executor_kind=AUTOMATION_EXECUTOR_KIND_DESKTOP,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        claim_ttl=claim_ttl,
        limit=limit,
        now=now,
        user_id=user_id,
        repo_identities=[
            LocalAutomationRepoIdentity(provider=provider, owner=owner, name=name)
            for provider, owner, name in sorted(identities)
        ],
    )


async def _claim_automation_runs(
    *,
    executor_id: str,
    executor_kind: str,
    execution_target: str,
    claim_ttl: timedelta,
    limit: int,
    now: datetime,
    user_id: UUID | None,
    repo_identities: list[LocalAutomationRepoIdentity] | None,
) -> list[AutomationRunClaimValue]:
    predicates = [
        AutomationRun.execution_target == execution_target,
        or_(
            AutomationRun.status == AUTOMATION_RUN_STATUS_QUEUED,
            (
                AutomationRun.status.in_(RECLAIMABLE_STATUSES)
                & (AutomationRun.claim_expires_at.is_not(None))
                & (AutomationRun.claim_expires_at <= now)
            ),
        ),
    ]
    if user_id is not None:
        predicates.append(AutomationRun.user_id == user_id)
    if repo_identities is not None:
        predicates.append(
            or_(
                *[
                    and_(
                        func.lower(AutomationRun.git_provider_snapshot) == identity.provider,
                        func.lower(AutomationRun.git_owner_snapshot) == identity.owner,
                        func.lower(AutomationRun.git_repo_name_snapshot) == identity.name,
                    )
                    for identity in repo_identities
                ]
            )
        )

    async with db_engine.async_session_factory() as db:
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
            if run.agent_kind_snapshot is None:
                _fail_unconfigured_agent(run, now)
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
        await db.commit()
        return values


async def load_current_run_claim(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
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
            allowed_statuses=ACTIVE_CLAIM_STATUSES,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return None
        return claim_value(run)


async def heartbeat_run_claim(
    *,
    run_id: UUID,
    claim_id: UUID,
    claim_ttl: timedelta,
    now: datetime,
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
            allowed_statuses=ACTIVE_CLAIM_STATUSES,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return None
        run.claim_expires_at = now + claim_ttl
        run.last_heartbeat_at = now
        run.updated_at = now
        await db.commit()
        return claim_value(run)


async def mark_run_creating_workspace(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
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
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CLAIMED}),
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return None
        run.status = AUTOMATION_RUN_STATUS_CREATING_WORKSPACE
        run.updated_at = now
        await db.commit()
        return claim_value(run)


async def attach_cloud_workspace_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    cloud_workspace_id: UUID,
    now: datetime,
) -> bool:
    async with db_engine.async_session_factory() as db:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                }
            ),
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
        )
        if run is None:
            return False
        run.cloud_workspace_id = cloud_workspace_id
        run.updated_at = now
        await db.commit()
        return True


async def attach_anyharness_workspace_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    now: datetime,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_LOCAL,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_DESKTOP,
    user_id: UUID | None = None,
) -> AutomationRunClaimValue | None:
    async with db_engine.async_session_factory() as db:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_CREATING_SESSION,
                }
            ),
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return None
        run.anyharness_workspace_id = anyharness_workspace_id
        run.updated_at = now
        await db.commit()
        return claim_value(run)


async def mark_run_provisioning_workspace(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
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
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                }
            ),
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return None
        if (
            execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD
            and run.cloud_workspace_id is None
        ):
            return None
        if (
            execution_target == AUTOMATION_EXECUTION_TARGET_LOCAL
            and run.anyharness_workspace_id is None
        ):
            return None
        run.status = AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE
        run.updated_at = now
        await db.commit()
        return claim_value(run)


async def mark_run_creating_session(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    now: datetime,
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
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_CREATING_SESSION,
                }
            ),
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return None
        run.status = AUTOMATION_RUN_STATUS_CREATING_SESSION
        run.anyharness_workspace_id = anyharness_workspace_id
        run.updated_at = now
        await db.commit()
        return claim_value(run)


async def attach_anyharness_session_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str,
    now: datetime,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> bool:
    async with db_engine.async_session_factory() as db:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_SESSION}),
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return False
        run.anyharness_workspace_id = anyharness_workspace_id
        run.anyharness_session_id = anyharness_session_id
        run.updated_at = now
        await db.commit()
        return True


async def mark_run_dispatching(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
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
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_SESSION}),
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None or run.anyharness_session_id is None or run.anyharness_workspace_id is None:
            return None
        run.status = AUTOMATION_RUN_STATUS_DISPATCHING
        run.dispatch_started_at = now
        run.updated_at = now
        await db.commit()
        return claim_value(run)


async def mark_run_dispatched(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str,
    now: datetime,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> bool:
    async with db_engine.async_session_factory() as db:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_DISPATCHING}),
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return False
        run.status = AUTOMATION_RUN_STATUS_DISPATCHED
        run.dispatched_at = now
        run.anyharness_workspace_id = anyharness_workspace_id
        run.anyharness_session_id = anyharness_session_id
        _clear_claim(run)
        run.updated_at = now
        await db.commit()
        return True


async def mark_run_failed(
    *,
    run_id: UUID,
    claim_id: UUID,
    error_code: str,
    message: str,
    now: datetime,
    execution_target: str = AUTOMATION_EXECUTION_TARGET_CLOUD,
    executor_kind: str = AUTOMATION_EXECUTOR_KIND_CLOUD,
    user_id: UUID | None = None,
) -> bool:
    async with db_engine.async_session_factory() as db:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=ACTIVE_CLAIM_STATUSES,
            execution_target=execution_target,
            executor_kind=executor_kind,
            user_id=user_id,
        )
        if run is None:
            return False
        run.status = AUTOMATION_RUN_STATUS_FAILED
        run.failed_at = now
        run.last_error_code = error_code
        run.last_error_message = message
        _clear_claim(run)
        run.updated_at = now
        await db.commit()
        return True


async def sweep_expired_dispatching_runs(*, now: datetime, limit: int = 100) -> int:
    if limit <= 0:
        return 0
    async with db_engine.async_session_factory() as db:
        runs = list(
            (
                await db.execute(
                    select(AutomationRun)
                    .where(
                        AutomationRun.status == AUTOMATION_RUN_STATUS_DISPATCHING,
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
            run.last_error_code = AUTOMATION_ERROR_DISPATCH_UNCERTAIN
            run.last_error_message = AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE
            _clear_claim(run)
            run.updated_at = now
        await db.commit()
        return len(runs)
