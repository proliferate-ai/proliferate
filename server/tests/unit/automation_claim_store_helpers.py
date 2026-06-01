from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_RUN_STATUS_DISPATCHING,
)
from proliferate.db import engine as engine_module
from proliferate.db.store.automation_cloud_workspace_claims import (
    create_cloud_workspace_for_claimed_run as create_cloud_workspace_for_claimed_run_store,
)
from proliferate.db.store.automation_run_claim_transitions import (
    attach_anyharness_session_to_run as attach_anyharness_session_to_run_store,
    attach_anyharness_workspace_to_run as attach_anyharness_workspace_to_run_store,
    mark_run_creating_session as mark_run_creating_session_store,
    mark_run_creating_workspace as mark_run_creating_workspace_store,
    mark_run_dispatched as mark_run_dispatched_store,
    mark_run_dispatching as mark_run_dispatching_store,
    mark_run_failed as mark_run_failed_store,
    mark_run_provisioning_workspace as mark_run_provisioning_workspace_store,
)
from proliferate.db.store.automation_run_claims import (
    claim_cloud_automation_runs as claim_cloud_automation_runs_store,
    claim_local_automation_runs as claim_local_automation_runs_store,
    heartbeat_run_claim as heartbeat_run_claim_store,
    sweep_expired_dispatching_runs as sweep_expired_dispatching_runs_store,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    ACTIVE_CLAIM_STATUSES,
    ANYHARNESS_SESSION_ATTACHMENT_TRANSITION,
    ANYHARNESS_WORKSPACE_ATTACHMENT_TRANSITION,
    CLOUD_WORKSPACE_CREATION_TRANSITION,
    CREATING_SESSION_TRANSITION,
    CREATING_WORKSPACE_TRANSITION,
    DISPATCHED_TRANSITION,
    DISPATCHING_TRANSITION,
    RECLAIMABLE_STATUSES,
    claim_is_active,
    dispatch_uncertain_failure,
    provisioning_workspace_transition,
    unconfigured_agent_failure,
)


async def _run_in_transaction[T](operation: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async with engine_module.async_session_factory() as db, db.begin():
        return await operation(db)


async def claim_cloud_automation_runs(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await claim_cloud_automation_runs_store(
            session,
            **kwargs,
            reclaimable_statuses=RECLAIMABLE_STATUSES,
            unconfigured_agent_failure=unconfigured_agent_failure(),
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def claim_local_automation_runs(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await claim_local_automation_runs_store(
            session,
            **kwargs,
            reclaimable_statuses=RECLAIMABLE_STATUSES,
            unconfigured_agent_failure=unconfigured_agent_failure(),
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def heartbeat_run_claim(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await heartbeat_run_claim_store(
            session,
            **kwargs,
            active_statuses=ACTIVE_CLAIM_STATUSES,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def mark_run_creating_workspace(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await mark_run_creating_workspace_store(
            session,
            **kwargs,
            transition=CREATING_WORKSPACE_TRANSITION,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def attach_anyharness_workspace_to_run(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await attach_anyharness_workspace_to_run_store(
            session,
            **kwargs,
            transition=ANYHARNESS_WORKSPACE_ATTACHMENT_TRANSITION,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def mark_run_provisioning_workspace(**kwargs):  # type: ignore[no-untyped-def]
    execution_target = kwargs.get("execution_target", AUTOMATION_EXECUTION_TARGET_CLOUD)
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await mark_run_provisioning_workspace_store(
            session,
            **kwargs,
            transition=provisioning_workspace_transition(execution_target),
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def mark_run_creating_session(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await mark_run_creating_session_store(
            session,
            **kwargs,
            transition=CREATING_SESSION_TRANSITION,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def attach_anyharness_session_to_run(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await attach_anyharness_session_to_run_store(
            session,
            **kwargs,
            transition=ANYHARNESS_SESSION_ATTACHMENT_TRANSITION,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def mark_run_dispatching(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await mark_run_dispatching_store(
            session,
            **kwargs,
            transition=DISPATCHING_TRANSITION,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def mark_run_dispatched(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await mark_run_dispatched_store(
            session,
            **kwargs,
            transition=DISPATCHED_TRANSITION,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def mark_run_failed(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await mark_run_failed_store(
            session,
            **kwargs,
            active_statuses=ACTIVE_CLAIM_STATUSES,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)


async def sweep_expired_dispatching_runs(**kwargs):  # type: ignore[no-untyped-def]
    return await sweep_expired_dispatching_runs_store(
        **kwargs,
        dispatching_status=AUTOMATION_RUN_STATUS_DISPATCHING,
        dispatch_uncertain_failure=dispatch_uncertain_failure(),
    )


async def create_cloud_workspace_for_claimed_run(**kwargs):  # type: ignore[no-untyped-def]
    db = kwargs.pop("db", None)

    async def operation(session: AsyncSession):  # type: ignore[no-untyped-def]
        return await create_cloud_workspace_for_claimed_run_store(
            session,
            **kwargs,
            transition=CLOUD_WORKSPACE_CREATION_TRANSITION,
            claim_is_active=claim_is_active,
        )

    return await operation(db) if db is not None else await _run_in_transaction(operation)
