"""Managed Cloud Workflow invocation reads, delivery, history, and cancel."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background.config import (
    DEFAULT_QUEUE,
    WORKFLOW_CANCEL_TASK,
    WORKFLOW_DELIVER_TASK,
)
from proliferate.config import Settings, settings
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import workflow_managed_delivery as managed_delivery_store
from proliferate.db.store import workflow_managed_execution as managed_execution_store
from proliferate.db.store import workflow_managed_history as managed_history_store
from proliferate.db.store.background_outbox import enqueue_outbox_task
from proliferate.db.store.workflow_invocations import WorkflowInvocationSnapshot
from proliferate.server.workflows.domain.managed_execution import (
    FreshnessBasis,
    derive_freshness,
)
from proliferate.server.workflows.errors import (
    InvalidWorkflowHistoryCursor,
    WorkflowInvocationNotFound,
    WorkflowManagedRunsUnavailable,
    WorkflowTargetLost,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class ManagedWorkflowValue:
    invocation: WorkflowInvocationSnapshot
    managed: managed_execution_store.WorkflowManagedExecutionSnapshot
    freshness: str
    open_target_available: bool


def managed_workflow_delivery_enabled(config: Settings = settings) -> bool:
    """Single source for deliver admission and `/meta` presentation."""

    return config.workflow_managed_runs_enabled


async def read_managed_workflow(
    db: AsyncSession,
    *,
    invocation: WorkflowInvocationSnapshot,
    config: Settings = settings,
) -> ManagedWorkflowValue:
    managed = await managed_execution_store.get_managed_execution(
        db,
        invocation_id=invocation.id,
    )
    if managed is None:
        raise WorkflowInvocationNotFound()
    return await _managed_value(db, invocation=invocation, managed=managed, config=config)


async def deliver_managed_workflow(
    db: AsyncSession,
    *,
    invocation: WorkflowInvocationSnapshot,
    config: Settings = settings,
) -> ManagedWorkflowValue:
    managed = await managed_execution_store.get_managed_execution(
        db,
        invocation_id=invocation.id,
        lock_row=True,
    )
    if managed is None:
        raise WorkflowInvocationNotFound()
    if managed.delivery_status == "prepared":
        if not managed_workflow_delivery_enabled(config):
            raise WorkflowManagedRunsUnavailable()
        queued = await managed_delivery_store.mark_delivery_queued(
            db,
            invocation_id=invocation.id,
        )
        if queued is None:
            raise WorkflowInvocationNotFound()
        managed = queued
        await _enqueue_workflow_task(
            db,
            operation="deliver",
            invocation_id=invocation.id,
            generation=managed.delivery_generation,
            task_name=WORKFLOW_DELIVER_TASK,
        )
    return await _managed_value(db, invocation=invocation, managed=managed, config=config)


async def cancel_managed_workflow(
    db: AsyncSession,
    *,
    invocation: WorkflowInvocationSnapshot,
    config: Settings = settings,
) -> ManagedWorkflowValue:
    current = await managed_execution_store.get_managed_execution(
        db,
        invocation_id=invocation.id,
        lock_row=True,
    )
    if current is None:
        raise WorkflowInvocationNotFound()
    if current.freshness_basis == "target_lost" and current.desired_state == "active":
        raise WorkflowTargetLost()
    managed, enqueue_cancel = await managed_delivery_store.request_cancellation(
        db,
        invocation_id=invocation.id,
    )
    if managed is None:
        raise WorkflowInvocationNotFound()
    if enqueue_cancel:
        await _enqueue_workflow_task(
            db,
            operation="cancel",
            invocation_id=invocation.id,
            generation=managed.cancel_generation,
            task_name=WORKFLOW_CANCEL_TASK,
        )
    return await _managed_value(db, invocation=invocation, managed=managed, config=config)


async def list_managed_workflow_history(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
    cursor_text: str | None,
    limit: int = 50,
    config: Settings = settings,
) -> tuple[tuple[managed_history_store.WorkflowHistoryItem, str], str | None]:
    cursor = None
    if cursor_text is not None:
        try:
            cursor = managed_history_store.decode_cursor(cursor_text)
        except ValueError as error:
            raise InvalidWorkflowHistoryCursor() from error
    page = await managed_history_store.list_definition_history(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
        cursor=cursor,
        limit=limit,
    )
    values = tuple(
        (item, _freshness(item.managed, config=config)) for item in page.items
    )
    return values, page.next_cursor


async def _managed_value(
    db: AsyncSession,
    *,
    invocation: WorkflowInvocationSnapshot,
    managed: managed_execution_store.WorkflowManagedExecutionSnapshot,
    config: Settings,
) -> ManagedWorkflowValue:
    open_target_available = False
    if managed.cloud_workspace_id is not None and managed.target_workspace_id is not None:
        workspace = await cloud_workspace_store.get_cloud_workspace_by_id(
            db,
            managed.cloud_workspace_id,
        )
        open_target_available = bool(
            workspace is not None
            and workspace.owner_user_id == invocation.user_id
            and workspace.archived_at is None
            and workspace.anyharness_workspace_id == managed.target_workspace_id
        )
    return ManagedWorkflowValue(
        invocation=invocation,
        managed=managed,
        freshness=_freshness(managed, config=config),
        open_target_available=open_target_available,
    )


def _freshness(
    managed: managed_execution_store.WorkflowManagedExecutionSnapshot,
    *,
    config: Settings,
) -> str:
    return derive_freshness(
        basis=FreshnessBasis(managed.freshness_basis),
        execution_status=managed.execution_status,
        latest_observed_at=managed.latest_observed_at,
        now=utcnow(),
        stale_after=timedelta(seconds=config.workflow_managed_freshness_stale_seconds),
    )


async def _enqueue_workflow_task(
    db: AsyncSession,
    *,
    operation: str,
    invocation_id: UUID,
    generation: int,
    task_name: str,
    available_at: datetime | None = None,
) -> None:
    await enqueue_outbox_task(
        db,
        task_name=task_name,
        queue=DEFAULT_QUEUE,
        args_json=(str(invocation_id), generation),
        idempotency_key=f"workflow:{operation}:{invocation_id}:{generation}",
        available_at=available_at,
    )
