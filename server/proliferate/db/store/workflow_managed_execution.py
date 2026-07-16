"""Core persistence identity and reads for managed Workflow execution."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowManagedExecution


@dataclass(frozen=True)
class WorkflowManagedExecutionSnapshot:
    invocation_id: UUID
    delivery_status: str
    delivery_checkpoint: str
    desired_state: str
    target_plan_json: dict[str, object] | None
    target_cloud_sandbox_id: UUID | None
    target_execution_store_id: str | None
    target_workspace_id: str | None
    cloud_workspace_id: UUID | None
    execution_status: str | None
    latest_state_version: int | None
    latest_projection_json: dict[str, object] | None
    latest_observed_at: datetime | None
    freshness_basis: str
    delivery_generation: int
    observation_generation: int
    cancel_generation: int
    delivery_attempt_count: int
    consecutive_unchanged_count: int
    last_delivery_error_code: str | None
    last_observation_error_code: str | None
    created_at: datetime
    updated_at: datetime
    accepted_at: datetime | None


def snapshot_managed_execution(
    row: WorkflowManagedExecution,
) -> WorkflowManagedExecutionSnapshot:
    return WorkflowManagedExecutionSnapshot(
        invocation_id=row.invocation_id,
        delivery_status=row.delivery_status,
        delivery_checkpoint=row.delivery_checkpoint,
        desired_state=row.desired_state,
        target_plan_json=(
            None if row.target_plan_json is None else deepcopy(row.target_plan_json)
        ),
        target_cloud_sandbox_id=row.target_cloud_sandbox_id,
        target_execution_store_id=row.target_execution_store_id,
        target_workspace_id=row.target_workspace_id,
        cloud_workspace_id=row.cloud_workspace_id,
        execution_status=row.execution_status,
        latest_state_version=row.latest_state_version,
        latest_projection_json=(
            None
            if row.latest_projection_json is None
            else deepcopy(row.latest_projection_json)
        ),
        latest_observed_at=row.latest_observed_at,
        freshness_basis=row.freshness_basis,
        delivery_generation=row.delivery_generation,
        observation_generation=row.observation_generation,
        cancel_generation=row.cancel_generation,
        delivery_attempt_count=row.delivery_attempt_count,
        consecutive_unchanged_count=row.consecutive_unchanged_count,
        last_delivery_error_code=row.last_delivery_error_code,
        last_observation_error_code=row.last_observation_error_code,
        created_at=row.created_at,
        updated_at=row.updated_at,
        accepted_at=row.accepted_at,
    )


async def create_managed_execution(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    created_at: datetime,
) -> WorkflowManagedExecutionSnapshot:
    row = WorkflowManagedExecution(
        invocation_id=invocation_id,
        delivery_status="prepared",
        delivery_checkpoint="none",
        desired_state="active",
        freshness_basis="pending",
        delivery_generation=1,
        observation_generation=0,
        cancel_generation=0,
        delivery_attempt_count=0,
        consecutive_unchanged_count=0,
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(row)
    await db.flush()
    return snapshot_managed_execution(row)


async def get_managed_execution(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    lock_row: bool = False,
) -> WorkflowManagedExecutionSnapshot | None:
    statement = select(WorkflowManagedExecution).where(
        WorkflowManagedExecution.invocation_id == invocation_id
    )
    if lock_row:
        statement = statement.with_for_update()
    row = (await db.execute(statement)).scalar_one_or_none()
    return None if row is None else snapshot_managed_execution(row)


async def lock_managed_execution_row(
    db: AsyncSession,
    invocation_id: UUID,
) -> WorkflowManagedExecution | None:
    return (
        await db.execute(
            select(WorkflowManagedExecution)
            .where(WorkflowManagedExecution.invocation_id == invocation_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
