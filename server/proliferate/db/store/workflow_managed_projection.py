"""Projection, reachability, and cancellation CAS for managed execution."""

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


async def apply_projection(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_observation_generation: int,
    projection: dict[str, object],
    decision: str,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.observation_generation != expected_observation_generation
        or row.freshness_basis == "target_lost"
    ):
        return None
    incoming_version = int(projection["stateVersion"])
    if row.latest_state_version is None or incoming_version > row.latest_state_version:
        expected_decision = "apply"
    elif incoming_version < row.latest_state_version:
        expected_decision = "stale"
    elif row.latest_projection_json == projection:
        expected_decision = "heartbeat"
    else:
        expected_decision = "conflict"
    if decision != expected_decision:
        return None
    now = utcnow()
    if decision == "apply":
        row.execution_status = str(projection["status"])
        row.latest_state_version = incoming_version
        row.latest_projection_json = deepcopy(projection)
        row.consecutive_unchanged_count = 0
        row.last_observation_error_code = None
    elif decision == "heartbeat":
        row.consecutive_unchanged_count = (
            1 if row.freshness_basis == "unreachable" else row.consecutive_unchanged_count + 1
        )
        row.last_observation_error_code = None
    elif decision == "conflict":
        row.last_observation_error_code = "equal_version_projection_conflict"
    row.latest_observed_at = now
    row.freshness_basis = "live"
    row.observation_generation += 1
    row.updated_at = now
    await db.flush()
    return snapshot_managed_execution(row)


async def apply_cancel_projection(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_cancel_generation: int,
    projection: dict[str, object],
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.cancel_generation != expected_cancel_generation
        or row.desired_state != "cancelled"
        or row.freshness_basis == "target_lost"
        or row.delivery_checkpoint not in {"run_put_started", "accepted"}
        or row.target_workspace_id is None
        or projection.get("id") != str(invocation_id)
        or projection.get("workspaceId") != row.target_workspace_id
    ):
        return None
    incoming_version = int(projection["stateVersion"])
    now = utcnow()
    if row.latest_state_version is None or incoming_version > row.latest_state_version:
        row.execution_status = str(projection["status"])
        row.latest_state_version = incoming_version
        row.latest_projection_json = deepcopy(projection)
        row.consecutive_unchanged_count = 0
        row.last_observation_error_code = None
    elif incoming_version == row.latest_state_version:
        if row.latest_projection_json != projection:
            row.last_observation_error_code = "equal_version_projection_conflict"
        else:
            row.last_observation_error_code = None
            row.consecutive_unchanged_count += 1
    row.delivery_status = "accepted"
    row.delivery_checkpoint = "accepted"
    row.accepted_at = row.accepted_at or now
    row.latest_observed_at = now
    row.freshness_basis = "live"
    row.cancel_generation += 1
    row.observation_generation += 1
    row.updated_at = now
    await db.flush()
    return snapshot_managed_execution(row)


async def mark_observation_unreachable(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_generation: int,
    error_code: str,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.observation_generation != expected_generation
        or row.freshness_basis == "target_lost"
    ):
        return None
    previously_unreachable = row.freshness_basis == "unreachable"
    row.freshness_basis = "unreachable"
    row.last_observation_error_code = error_code[:128]
    row.consecutive_unchanged_count = (
        row.consecutive_unchanged_count + 1 if previously_unreachable else 1
    )
    row.observation_generation += 1
    row.updated_at = utcnow()
    await db.flush()
    return snapshot_managed_execution(row)


async def mark_target_lost(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    operation: str,
    expected_generation: int,
    expected_cloud_sandbox_id: UUID,
    expected_execution_store_id: str,
    error_code: str,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    generation = (
        row.observation_generation
        if row is not None and operation == "observe"
        else (
            row.cancel_generation
            if row is not None and operation == "cancel"
            else row.delivery_generation
            if row is not None and operation == "deliver"
            else None
        )
    )
    if (
        row is None
        or generation != expected_generation
        or row.target_cloud_sandbox_id != expected_cloud_sandbox_id
        or row.target_execution_store_id != expected_execution_store_id
        or row.delivery_checkpoint not in {"run_put_started", "accepted"}
        or row.freshness_basis == "target_lost"
    ):
        return None
    row.freshness_basis = "target_lost"
    row.last_observation_error_code = error_code[:128]
    row.delivery_generation += 1
    row.observation_generation += 1
    row.cancel_generation += 1
    row.updated_at = utcnow()
    await db.flush()
    return snapshot_managed_execution(row)


async def advance_cancel_generation(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_generation: int,
    error_code: str | None = None,
) -> WorkflowManagedExecutionSnapshot | None:
    row = await lock_managed_execution_row(db, invocation_id)
    if (
        row is None
        or row.cancel_generation != expected_generation
        or row.desired_state != "cancelled"
        or row.freshness_basis == "target_lost"
    ):
        return None
    row.cancel_generation += 1
    if error_code is not None:
        row.last_observation_error_code = error_code[:128]
        row.freshness_basis = "unreachable"
    row.updated_at = utcnow()
    await db.flush()
    return snapshot_managed_execution(row)
