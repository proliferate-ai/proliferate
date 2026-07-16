"""Delivery and desired-state transitions for managed Workflow execution."""

from __future__ import annotations

from copy import deepcopy
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.workflow_managed_execution import (
    WorkflowManagedExecutionSnapshot,
    lock_managed_execution_row,
    snapshot_managed_execution,
)
from proliferate.utils.time import utcnow

_DELIVERY_SUCCESSOR = {
    "none": "target_plan_frozen",
    "target_plan_frozen": "target_bound",
    "target_bound": "workspace_put_started",
    "workspace_put_started": "workspace_ready",
    "workspace_ready": "run_put_started",
}


async def mark_delivery_queued(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if row is None:
        return None
    if row.delivery_status == "prepared" and row.desired_state == "active":
        row.delivery_status = "queued"
        row.updated_at = utcnow()
        await db.flush()
    return snapshot_managed_execution(row)


async def claim_delivery_generation(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    generation: int,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.delivery_generation != generation
        or row.desired_state != "active"
        or row.freshness_basis == "target_lost"
        or row.delivery_status not in {"queued", "delivering"}
    ):
        return None
    if row.delivery_status == "queued":
        row.delivery_attempt_count += 1
    row.delivery_status = "delivering"
    row.updated_at = utcnow()
    await db.flush()
    return snapshot_managed_execution(row)


async def advance_delivery(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_generation: int,
    expected_checkpoint: str,
    next_checkpoint: str,
    target_plan_json: dict[str, object] | None = None,
    target_cloud_sandbox_id: UUID | None = None,
    target_execution_store_id: str | None = None,
    target_workspace_id: str | None = None,
    cloud_workspace_id: UUID | None = None,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.delivery_generation != expected_generation
        or row.delivery_checkpoint != expected_checkpoint
        or row.desired_state != "active"
        or row.freshness_basis == "target_lost"
        or row.delivery_status not in {"queued", "delivering"}
        or _DELIVERY_SUCCESSOR.get(expected_checkpoint) != next_checkpoint
    ):
        return None
    proposed = (
        ("target_plan_json", target_plan_json),
        ("target_cloud_sandbox_id", target_cloud_sandbox_id),
        ("target_execution_store_id", target_execution_store_id),
        ("target_workspace_id", target_workspace_id),
        ("cloud_workspace_id", cloud_workspace_id),
    )
    for attribute, value in proposed:
        current = getattr(row, attribute)
        if current is not None and value is not None and current != value:
            return None
    if next_checkpoint == "target_plan_frozen" and (
        target_plan_json is None or target_cloud_sandbox_id is None
    ):
        return None
    if next_checkpoint == "target_bound" and (
        row.target_plan_json is None
        or row.target_cloud_sandbox_id is None
        or target_execution_store_id is None
    ):
        return None
    if next_checkpoint == "workspace_ready" and (
        row.target_execution_store_id is None
        or target_workspace_id is None
        or cloud_workspace_id is None
    ):
        return None
    if next_checkpoint == "run_put_started" and (
        row.target_workspace_id is None or row.cloud_workspace_id is None
    ):
        return None
    row.delivery_status = "delivering"
    row.delivery_checkpoint = next_checkpoint
    row.delivery_generation += 1
    if target_plan_json is not None and row.target_plan_json is None:
        row.target_plan_json = deepcopy(target_plan_json)
    if target_cloud_sandbox_id is not None and row.target_cloud_sandbox_id is None:
        row.target_cloud_sandbox_id = target_cloud_sandbox_id
    if target_execution_store_id is not None and row.target_execution_store_id is None:
        row.target_execution_store_id = target_execution_store_id
    if target_workspace_id is not None and row.target_workspace_id is None:
        row.target_workspace_id = target_workspace_id
    if cloud_workspace_id is not None and row.cloud_workspace_id is None:
        row.cloud_workspace_id = cloud_workspace_id
    row.last_delivery_error_code = None
    row.updated_at = utcnow()
    await db.flush()
    return snapshot_managed_execution(row)


async def mark_delivery_accepted(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_generation: int,
    projection: dict[str, object],
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.delivery_generation != expected_generation
        or row.freshness_basis == "target_lost"
        or row.delivery_checkpoint != "run_put_started"
        or row.target_cloud_sandbox_id is None
        or row.target_execution_store_id is None
        or row.target_workspace_id is None
        or row.cloud_workspace_id is None
        or projection.get("id") != str(invocation_id)
        or projection.get("workspaceId") != row.target_workspace_id
    ):
        return None
    now = utcnow()
    row.delivery_status = "accepted"
    row.delivery_checkpoint = "accepted"
    row.execution_status = str(projection["status"])
    row.latest_state_version = int(projection["stateVersion"])
    row.latest_projection_json = deepcopy(projection)
    row.latest_observed_at = now
    row.freshness_basis = "live"
    row.observation_generation += 1
    row.accepted_at = row.accepted_at or now
    row.last_delivery_error_code = None
    row.last_observation_error_code = None
    row.updated_at = now
    await db.flush()
    return snapshot_managed_execution(row)


async def mark_delivery_failed(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_generation: int,
    error_code: str,
    definitive_after_run_put: bool = False,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.delivery_generation != expected_generation
        or row.freshness_basis == "target_lost"
    ):
        return None
    if row.delivery_checkpoint == "accepted" or (
        row.delivery_checkpoint == "run_put_started" and not definitive_after_run_put
    ):
        return snapshot_managed_execution(row)
    row.delivery_status = "delivery_failed"
    row.last_delivery_error_code = error_code[:128]
    row.updated_at = utcnow()
    await db.flush()
    return snapshot_managed_execution(row)


async def schedule_delivery_retry(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_generation: int,
    error_code: str,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.delivery_generation != expected_generation
        or row.desired_state != "active"
        or row.freshness_basis == "target_lost"
        or row.delivery_status not in {"queued", "delivering"}
    ):
        return None
    row.delivery_generation += 1
    row.delivery_status = "queued"
    row.last_delivery_error_code = error_code[:128]
    row.updated_at = utcnow()
    await db.flush()
    return snapshot_managed_execution(row)


async def request_cancellation(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> tuple[WorkflowManagedExecutionSnapshot | None, bool]:
    row = await lock_managed_execution_row(db, invocation_id)
    if row is None:
        return None, False
    if row.freshness_basis == "target_lost" or row.desired_state == "cancelled":
        return snapshot_managed_execution(row), False
    delivery_terminal = row.delivery_status in {"delivery_failed", "delivery_cancelled"}
    execution_terminal = row.execution_status in {
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    }
    if delivery_terminal or execution_terminal:
        return snapshot_managed_execution(row), False
    row.desired_state = "cancelled"
    row.updated_at = utcnow()
    enqueue_cancel = row.delivery_checkpoint in {"run_put_started", "accepted"}
    if enqueue_cancel:
        row.cancel_generation += 1
    else:
        row.delivery_status = "delivery_cancelled"
        row.delivery_generation += 1
    await db.flush()
    return snapshot_managed_execution(row), enqueue_cancel


async def ensure_cancel_generation(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.desired_state != "cancelled"
        or row.freshness_basis == "target_lost"
    ):
        return None
    if row.cancel_generation == 0:
        row.cancel_generation = 1
        row.updated_at = utcnow()
        await db.flush()
    return snapshot_managed_execution(row)
