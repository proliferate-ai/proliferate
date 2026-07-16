"""One-generation managed Workflow cancellation and ambiguity reconciliation."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.config import WORKFLOW_CANCEL_TASK, WORKFLOW_OBSERVE_TASK
from proliferate.db.store import workflow_managed_execution as managed_store
from proliferate.db.store import workflow_managed_projection as projection_store
from proliferate.integrations.anyharness import (
    WorkflowRuntimeError,
    cancel_workflow_run,
    get_workflow_run,
    put_workflow_run,
)
from proliferate.server.workflows.domain.managed_execution import (
    access_retry_delay_seconds,
    execution_is_terminal,
)
from proliferate.server.workflows.worker.coordination import (
    enqueue,
    load_delivery,
    runtime_access,
    safe_error_code,
)
from proliferate.server.workflows.worker.telemetry import emit_attempt


async def run_cancel_task(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    invocation_id: UUID,
    generation: int,
) -> None:
    async with session_factory() as db:
        invocation, managed = await load_delivery(db, invocation_id)
    if (
        managed.cancel_generation != generation
        or managed.desired_state != "cancelled"
        or managed.delivery_checkpoint not in {"run_put_started", "accepted"}
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
        try:
            await get_workflow_run(
                access.runtime_url,
                access.access_token,
                run_id=str(invocation_id),
                expected_workspace_id=managed.target_workspace_id,
            )
        except WorkflowRuntimeError as error:
            if not error.not_found or managed.delivery_checkpoint != "run_put_started":
                raise
            await put_workflow_run(
                access.runtime_url,
                access.access_token,
                run_id=str(invocation_id),
                expected_workspace_id=managed.target_workspace_id,
                request={
                    "schemaVersion": 2,
                    "workspaceId": managed.target_workspace_id,
                    "definition": invocation.invocation_json["definition"],
                    "arguments": invocation.invocation_json["arguments"],
                },
            )
        projection = await cancel_workflow_run(
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
    async with session_factory() as db, db.begin():
        updated = await projection_store.apply_cancel_projection(
            db,
            invocation_id=invocation_id,
            expected_cancel_generation=generation,
            projection=projection.value,
        )
        if updated is not None and not execution_is_terminal(updated.execution_status):
            await enqueue(
                db,
                operation="observe",
                invocation_id=invocation_id,
                generation=updated.observation_generation,
                task_name=WORKFLOW_OBSERVE_TASK,
                delay_seconds=1,
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
                    operation="cancel",
                    expected_generation=generation,
                    expected_cloud_sandbox_id=managed.target_cloud_sandbox_id,
                    expected_execution_store_id=managed.target_execution_store_id,
                    error_code=code,
                )
        else:
            updated = await projection_store.advance_cancel_generation(
                db,
                invocation_id=invocation_id,
                expected_generation=generation,
                error_code=code,
            )
            if updated is not None:
                await enqueue(
                    db,
                    operation="cancel",
                    invocation_id=invocation_id,
                    generation=updated.cancel_generation,
                    task_name=WORKFLOW_CANCEL_TASK,
                    delay_seconds=access_retry_delay_seconds(
                        max(0, updated.cancel_generation - 2)
                    ),
                )
    emit_attempt(
        operation="cancel",
        safe_code=code,
        invocation_id=invocation_id,
        generation=generation,
    )
