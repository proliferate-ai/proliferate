"""Persistence for workflow triggers (spec 3.5).

A trigger pins target + schedule + concurrency and funnels to the same StartRun.
This module owns trigger CRUD plus the scheduler-lane claim/advance/skip helpers.
The scheduler locks a due trigger (``FOR UPDATE SKIP LOCKED``) and advances its
cursor in the same transaction, so two scheduler beats never double-fire a slot.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_TRIGGER_KIND_SCHEDULE
from proliferate.db.models.cloud.workflows import Workflow, WorkflowTrigger
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class WorkflowTriggerRecord:
    id: UUID
    workflow_id: UUID
    kind: str
    enabled: bool
    concurrency_policy: str
    target_mode: str
    target_workspace_id: UUID | None
    schedule_rrule: str | None
    schedule_timezone: str | None
    schedule_summary: str | None
    next_run_at: datetime | None
    last_scheduled_at: datetime | None
    last_skipped_at: datetime | None
    last_skip_reason: str | None
    args_json: dict[str, object]
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class DueScheduleTrigger:
    """A row-locked, due schedule trigger plus the owner context StartRun needs."""

    id: UUID
    workflow_id: UUID
    workflow_owner_user_id: UUID
    workflow_archived: bool
    concurrency_policy: str
    target_mode: str
    target_workspace_id: UUID | None
    schedule_rrule: str
    schedule_timezone: str
    args_json: dict[str, object]


def _record(row: WorkflowTrigger) -> WorkflowTriggerRecord:
    return WorkflowTriggerRecord(
        id=row.id,
        workflow_id=row.workflow_id,
        kind=row.kind,
        enabled=row.enabled,
        concurrency_policy=row.concurrency_policy,
        target_mode=row.target_mode,
        target_workspace_id=row.target_workspace_id,
        schedule_rrule=row.schedule_rrule,
        schedule_timezone=row.schedule_timezone,
        schedule_summary=row.schedule_summary,
        next_run_at=row.next_run_at,
        last_scheduled_at=row.last_scheduled_at,
        last_skipped_at=row.last_skipped_at,
        last_skip_reason=row.last_skip_reason,
        args_json=dict(row.args_json or {}),
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# --- CRUD ----------------------------------------------------------------------


async def create_trigger(
    db: AsyncSession,
    *,
    workflow_id: UUID,
    created_by_user_id: UUID,
    kind: str,
    concurrency_policy: str,
    target_mode: str,
    target_workspace_id: UUID | None,
    schedule_rrule: str | None,
    schedule_timezone: str | None,
    schedule_summary: str | None,
    next_run_at: datetime | None,
    args_json: dict[str, object],
    enabled: bool = True,
) -> WorkflowTriggerRecord:
    now = utcnow()
    row = WorkflowTrigger(
        id=uuid4(),
        workflow_id=workflow_id,
        kind=kind,
        enabled=enabled,
        concurrency_policy=concurrency_policy,
        target_mode=target_mode,
        target_workspace_id=target_workspace_id,
        schedule_rrule=schedule_rrule,
        schedule_timezone=schedule_timezone,
        schedule_summary=schedule_summary,
        next_run_at=next_run_at,
        args_json=args_json,
        created_by_user_id=created_by_user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _record(row)


async def get_trigger(db: AsyncSession, trigger_id: UUID) -> WorkflowTriggerRecord | None:
    row = await db.get(WorkflowTrigger, trigger_id)
    return None if row is None else _record(row)


async def list_triggers_for_workflow(
    db: AsyncSession, *, workflow_id: UUID
) -> tuple[WorkflowTriggerRecord, ...]:
    rows = (
        (
            await db.execute(
                select(WorkflowTrigger)
                .where(WorkflowTrigger.workflow_id == workflow_id)
                .order_by(WorkflowTrigger.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_record(row) for row in rows)


async def update_trigger(
    db: AsyncSession,
    *,
    trigger_id: UUID,
    enabled: bool | None = None,
    concurrency_policy: str | None = None,
    target_mode: str | None = None,
    target_workspace_id: UUID | None = None,
    clear_target_workspace: bool = False,
    schedule_rrule: str | None = None,
    schedule_timezone: str | None = None,
    schedule_summary: str | None = None,
    next_run_at: datetime | None = None,
    args_json: dict[str, object] | None = None,
) -> WorkflowTriggerRecord | None:
    """Apply a trigger update. Only provided fields are written.

    ``clear_target_workspace`` lets a switch to a local target null the workspace
    (the plain ``target_workspace_id=None`` default is indistinguishable from "no
    change" otherwise).
    """

    row = await db.get(WorkflowTrigger, trigger_id)
    if row is None:
        return None
    if enabled is not None:
        row.enabled = enabled
    if concurrency_policy is not None:
        row.concurrency_policy = concurrency_policy
    if target_mode is not None:
        row.target_mode = target_mode
    if clear_target_workspace:
        row.target_workspace_id = None
    elif target_workspace_id is not None:
        row.target_workspace_id = target_workspace_id
    if schedule_rrule is not None:
        row.schedule_rrule = schedule_rrule
    if schedule_timezone is not None:
        row.schedule_timezone = schedule_timezone
    if schedule_summary is not None:
        row.schedule_summary = schedule_summary
    if next_run_at is not None:
        row.next_run_at = next_run_at
    if args_json is not None:
        row.args_json = args_json
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)


async def delete_trigger(db: AsyncSession, trigger_id: UUID) -> bool:
    row = await db.get(WorkflowTrigger, trigger_id)
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True


# --- scheduler lane ------------------------------------------------------------


async def list_due_schedule_trigger_ids(
    db: AsyncSession, *, now: datetime, limit: int
) -> list[UUID]:
    """Enabled schedule triggers whose next slot has passed, soonest first."""

    rows = (
        (
            await db.execute(
                select(WorkflowTrigger.id)
                .where(
                    WorkflowTrigger.kind == WORKFLOW_TRIGGER_KIND_SCHEDULE,
                    WorkflowTrigger.enabled.is_(True),
                    WorkflowTrigger.next_run_at.is_not(None),
                    WorkflowTrigger.next_run_at <= now,
                )
                .order_by(WorkflowTrigger.next_run_at.asc())
                .limit(max(1, limit))
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def claim_due_schedule_trigger(
    db: AsyncSession, *, trigger_id: UUID, now: datetime
) -> DueScheduleTrigger | None:
    """Row-lock one due schedule trigger for firing. Requires an open transaction.

    ``SKIP LOCKED`` means a beat racing another scheduler simply moves on. Returns
    ``None`` if the trigger was taken, disabled, or is no longer due — the lock +
    ``next_run_at`` advance in the caller's transaction dedupes the slot.
    """

    row = (
        await db.execute(
            select(WorkflowTrigger)
            .where(
                WorkflowTrigger.id == trigger_id,
                WorkflowTrigger.kind == WORKFLOW_TRIGGER_KIND_SCHEDULE,
                WorkflowTrigger.enabled.is_(True),
                WorkflowTrigger.next_run_at.is_not(None),
                WorkflowTrigger.next_run_at <= now,
            )
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if row is None or row.schedule_rrule is None or row.schedule_timezone is None:
        return None
    workflow = await db.get(Workflow, row.workflow_id)
    if workflow is None:
        return None
    return DueScheduleTrigger(
        id=row.id,
        workflow_id=row.workflow_id,
        workflow_owner_user_id=workflow.owner_user_id,
        workflow_archived=workflow.archived_at is not None,
        concurrency_policy=row.concurrency_policy,
        target_mode=row.target_mode,
        target_workspace_id=row.target_workspace_id,
        schedule_rrule=row.schedule_rrule,
        schedule_timezone=row.schedule_timezone,
        args_json=dict(row.args_json or {}),
    )


async def mark_trigger_fired(
    db: AsyncSession, *, trigger_id: UUID, scheduled_for: datetime, next_run_at: datetime
) -> None:
    """A slot fired: record it and advance the cursor, clearing any skip marker."""

    row = await db.get(WorkflowTrigger, trigger_id)
    if row is None:
        return
    row.last_scheduled_at = scheduled_for
    row.last_skipped_at = None
    row.last_skip_reason = None
    row.next_run_at = next_run_at
    row.updated_at = utcnow()
    await db.flush()


async def mark_trigger_skipped(
    db: AsyncSession,
    *,
    trigger_id: UUID,
    now: datetime,
    reason: str,
    next_run_at: datetime,
) -> None:
    """A slot was dropped (concurrency skip or a fire-time error): record + advance."""

    row = await db.get(WorkflowTrigger, trigger_id)
    if row is None:
        return
    row.last_skipped_at = now
    row.last_skip_reason = reason
    row.next_run_at = next_run_at
    row.updated_at = utcnow()
    await db.flush()


async def disable_trigger_with_reason(
    db: AsyncSession, *, trigger_id: UUID, now: datetime, reason: str
) -> None:
    """Stop scheduling a trigger whose schedule can no longer be cursored."""

    row = await db.get(WorkflowTrigger, trigger_id)
    if row is None:
        return
    row.enabled = False
    # Keep the cursor: a schedule trigger must always carry next_run_at (the
    # ck_workflow_trigger_schedule_fields CHECK forbids NULL). Disabling is done via
    # enabled=False alone — the due-selection queries already filter on enabled — so
    # nulling next_run_at is both unnecessary and constraint-violating.
    row.last_skipped_at = now
    row.last_skip_reason = reason
    row.updated_at = utcnow()
    await db.flush()
