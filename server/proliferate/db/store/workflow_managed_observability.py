"""Low-cardinality operational snapshot for managed Workflow execution."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowManagedExecution
from proliferate.utils.time import utcnow

_TERMINAL_EXECUTION = ("completed", "failed", "cancelled", "interrupted")


@dataclass(frozen=True)
class ManagedWorkflowTelemetrySnapshot:
    queued_or_delivering_count: int
    oldest_queued_or_delivering_age_seconds: float
    accepted_nonterminal_count: int
    oldest_accepted_observation_age_seconds: float
    pending_cancellation_count: int
    oldest_pending_cancellation_age_seconds: float
    unreachable_count: int
    target_lost_count: int
    invariant_conflict_count: int


def _age_seconds(now: datetime, oldest: datetime | None) -> float:
    return 0.0 if oldest is None else max(0.0, (now - oldest).total_seconds())


async def get_managed_workflow_telemetry_snapshot(
    db: AsyncSession,
) -> ManagedWorkflowTelemetrySnapshot:
    """Read process-independent, fixed-cardinality age/count gauges."""

    active_delivery = WorkflowManagedExecution.delivery_status.in_(("queued", "delivering"))
    execution_nonterminal = WorkflowManagedExecution.execution_status.is_(None) | (
        WorkflowManagedExecution.execution_status.not_in(_TERMINAL_EXECUTION)
    )
    accepted_nonterminal = (
        WorkflowManagedExecution.delivery_status == "accepted"
    ) & execution_nonterminal
    pending_cancellation = (
        (WorkflowManagedExecution.desired_state == "cancelled")
        & WorkflowManagedExecution.delivery_checkpoint.in_(("run_put_started", "accepted"))
        & execution_nonterminal
    )
    row = (
        await db.execute(
            select(
                func.count().filter(active_delivery),
                func.min(WorkflowManagedExecution.created_at).filter(active_delivery),
                func.count().filter(accepted_nonterminal),
                func.min(WorkflowManagedExecution.latest_observed_at).filter(accepted_nonterminal),
                func.count().filter(pending_cancellation),
                func.min(WorkflowManagedExecution.updated_at).filter(pending_cancellation),
                func.count().filter(WorkflowManagedExecution.freshness_basis == "unreachable"),
                func.count().filter(WorkflowManagedExecution.freshness_basis == "target_lost"),
                func.count().filter(
                    WorkflowManagedExecution.last_observation_error_code
                    == "equal_version_projection_conflict"
                ),
            )
        )
    ).one()
    now = utcnow()
    return ManagedWorkflowTelemetrySnapshot(
        queued_or_delivering_count=int(row[0] or 0),
        oldest_queued_or_delivering_age_seconds=_age_seconds(now, row[1]),
        accepted_nonterminal_count=int(row[2] or 0),
        oldest_accepted_observation_age_seconds=_age_seconds(now, row[3]),
        pending_cancellation_count=int(row[4] or 0),
        oldest_pending_cancellation_age_seconds=_age_seconds(now, row[5]),
        unreachable_count=int(row[6] or 0),
        target_lost_count=int(row[7] or 0),
        invariant_conflict_count=int(row[8] or 0),
    )
