"""Coordination primitives shared by managed Workflow worker phases."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.config import DEFAULT_QUEUE
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store import workflow_invocations as invocation_store
from proliferate.db.store import workflow_managed_execution as managed_store
from proliferate.db.store.background_outbox import enqueue_outbox_task
from proliferate.integrations.anyharness import (
    WorkflowRuntimeError,
    get_execution_store_identity,
)
from proliferate.server.cloud.cloud_sandboxes import service as sandbox_service
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.materialization.sandbox_io import connect_ready_sandbox
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class RuntimeAccess:
    sandbox_id: UUID
    runtime_url: str
    access_token: str
    execution_store_id: str


def safe_error_code(error: BaseException) -> str:
    if isinstance(error, WorkflowRuntimeError):
        return error.code
    if isinstance(error, CloudApiError):
        code = getattr(error, "code", None)
        if isinstance(code, str) and code:
            return code[:128]
    return f"managed_workflow_{type(error).__name__.lower()}"[:128]


def retryable(error: BaseException) -> bool:
    if isinstance(error, WorkflowRuntimeError):
        return error.retryable or error.authentication
    status_code = getattr(error, "status_code", None)
    return not isinstance(status_code, int) or status_code >= 500


async def enqueue(
    db: AsyncSession,
    *,
    operation: str,
    invocation_id: UUID,
    generation: int,
    task_name: str,
    delay_seconds: float = 0,
) -> None:
    await enqueue_outbox_task(
        db,
        task_name=task_name,
        queue=DEFAULT_QUEUE,
        args_json=(str(invocation_id), generation),
        idempotency_key=f"workflow:{operation}:{invocation_id}:{generation}",
        available_at=utcnow() + timedelta(seconds=delay_seconds),
    )


async def runtime_access(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    sandbox_id: UUID,
    expected_store_id: str | None,
) -> RuntimeAccess:
    async with session_factory() as db:
        sandbox = await sandbox_store.load_cloud_sandbox_by_id(db, sandbox_id)
        if sandbox is None or sandbox.destroyed_at is not None or sandbox.status == "destroyed":
            raise WorkflowRuntimeError("workflow_target_destroyed", not_found=True)
        await db.commit()
        await connect_ready_sandbox(db, sandbox=sandbox)
        sandbox = await sandbox_store.load_cloud_sandbox_by_id(db, sandbox_id)
        if sandbox is None:
            raise WorkflowRuntimeError("workflow_target_destroyed", not_found=True)
        runtime_url, access_token, _data_key = (
            await sandbox_service.load_cloud_sandbox_runtime_access(sandbox)
        )
        await db.commit()
        identity = await get_execution_store_identity(runtime_url, access_token)
    if expected_store_id is not None and identity.execution_store_id != expected_store_id:
        raise WorkflowRuntimeError("workflow_execution_store_changed", not_found=True)
    return RuntimeAccess(
        sandbox_id=sandbox_id,
        runtime_url=runtime_url,
        access_token=access_token,
        execution_store_id=identity.execution_store_id,
    )


async def load_delivery(
    db: AsyncSession,
    invocation_id: UUID,
) -> tuple[
    invocation_store.WorkflowInvocationSnapshot,
    managed_store.WorkflowManagedExecutionSnapshot,
]:
    invocation = await invocation_store.get_workflow_invocation_global(
        db,
        invocation_id=invocation_id,
    )
    managed = await managed_store.get_managed_execution(db, invocation_id=invocation_id)
    if invocation is None or managed is None or managed.target_plan_json is None:
        raise WorkflowRuntimeError("workflow_delivery_state_missing")
    return invocation, managed
