"""One-generation managed Workflow observation."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.config import WORKFLOW_OBSERVE_TASK
from proliferate.db.store import workflow_managed_execution as managed_store
from proliferate.db.store import workflow_managed_projection as projection_store
from proliferate.integrations.anyharness import WorkflowRuntimeError, get_workflow_run
from proliferate.server.workflows.domain.managed_execution import (
    access_retry_delay_seconds,
    execution_is_terminal,
    observation_delay_seconds,
    projection_decision,
)
from proliferate.server.workflows.worker.coordination import (
    enqueue,
    runtime_access,
    safe_error_code,
)
from proliferate.server.workflows.worker.telemetry import emit_attempt


async def run_observation_task(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    invocation_id: UUID,
    generation: int,
) -> None:
    async with session_factory() as db:
        managed = await managed_store.get_managed_execution(db, invocation_id=invocation_id)
    if (
        managed is None
        or managed.observation_generation != generation
        or managed.delivery_checkpoint != "accepted"
        or execution_is_terminal(managed.execution_status)
        or managed.target_cloud_sandbox_id is None
        or managed.target_execution_store_id is None
        or managed.target_workspace_id is None
    ):
        return
    try:
        access = await runtime_access(
            session_factory,
            sandbox_id=managed.target_cloud_sandbox_id,
            expected_store_id=managed.target_execution_store_id,
        )
        projection = await get_workflow_run(
            access.runtime_url,
            access.access_token,
            run_id=str(invocation_id),
            expected_workspace_id=managed.target_workspace_id,
        )
    except Exception as error:  # noqa: BLE001 - closed durable classification.
        await _handle_error(
            session_factory,
            invocation_id=invocation_id,
            managed=managed,
            generation=generation,
            error=error,
        )
        return
    decision = projection_decision(
        stored_version=managed.latest_state_version,
        stored_projection=managed.latest_projection_json,
        incoming_version=int(projection.value["stateVersion"]),
        incoming_projection=projection.value,
    )
    async with session_factory() as db, db.begin():
        updated = await projection_store.apply_projection(
            db,
            invocation_id=invocation_id,
            expected_observation_generation=generation,
            projection=projection.value,
            decision=decision,
        )
        if updated is None or execution_is_terminal(updated.execution_status):
            if updated is not None and decision == "conflict":
                emit_attempt(
                    operation="observe",
                    safe_code="equal_version_projection_conflict",
                    invocation_id=invocation_id,
                    generation=generation,
                )
            return
        await enqueue(
            db,
            operation="observe",
            invocation_id=invocation_id,
            generation=updated.observation_generation,
            task_name=WORKFLOW_OBSERVE_TASK,
            delay_seconds=observation_delay_seconds(
                advanced=decision == "apply",
                unchanged_count=updated.consecutive_unchanged_count,
            ),
        )
    if decision == "conflict":
        emit_attempt(
            operation="observe",
            safe_code="equal_version_projection_conflict",
            invocation_id=invocation_id,
            generation=generation,
        )


async def _handle_error(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    invocation_id: UUID,
    managed: managed_store.WorkflowManagedExecutionSnapshot,
    generation: int,
    error: BaseException,
) -> None:
    code = safe_error_code(error)
    target_lost = isinstance(error, WorkflowRuntimeError) and error.not_found
    async with session_factory() as db, db.begin():
        if target_lost:
            if (
                managed.target_cloud_sandbox_id is not None
                and managed.target_execution_store_id is not None
            ):
                await projection_store.mark_target_lost(
                    db,
                    invocation_id=invocation_id,
                    operation="observe",
                    expected_generation=generation,
                    expected_cloud_sandbox_id=managed.target_cloud_sandbox_id,
                    expected_execution_store_id=managed.target_execution_store_id,
                    error_code=code,
                )
        else:
            updated = await projection_store.mark_observation_unreachable(
                db,
                invocation_id=invocation_id,
                expected_generation=generation,
                error_code=code,
            )
            if updated is not None:
                await enqueue(
                    db,
                    operation="observe",
                    invocation_id=invocation_id,
                    generation=updated.observation_generation,
                    task_name=WORKFLOW_OBSERVE_TASK,
                    delay_seconds=access_retry_delay_seconds(
                        max(0, updated.consecutive_unchanged_count - 1)
                    ),
                )
    emit_attempt(
        operation="observe",
        safe_code=code,
        invocation_id=invocation_id,
        generation=generation,
    )
