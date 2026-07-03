"""Persistence for workflows, immutable versions, and the run ledger."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_RUN_STATUS_PENDING_DELIVERY
from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class WorkflowRecord:
    id: UUID
    owner_user_id: UUID
    created_by_user_id: UUID
    name: str
    description: str | None
    current_version_id: UUID | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class WorkflowVersionRecord:
    id: UUID
    workflow_id: UUID
    version_n: int
    definition_json: dict[str, object]
    created_by_user_id: UUID
    created_at: datetime


@dataclass(frozen=True)
class WorkflowRunRecord:
    id: UUID
    workflow_id: UUID
    workflow_version_id: UUID
    trigger_kind: str
    executor_user_id: UUID
    args_json: dict[str, object]
    target_mode: str
    resolved_plan_json: dict[str, object]
    status: str
    step_cursor: int | None
    step_outputs_json: dict[str, object] | None
    anyharness_workspace_id: str | None
    anyharness_session_ids: list[str] | None
    error_code: str | None
    error_message: str | None
    cost_usd: Decimal | None
    cost_tokens: int | None
    created_at: datetime
    updated_at: datetime
    delivered_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None


def _workflow_record(row: Workflow) -> WorkflowRecord:
    return WorkflowRecord(
        id=row.id,
        owner_user_id=row.owner_user_id,
        created_by_user_id=row.created_by_user_id,
        name=row.name,
        description=row.description,
        current_version_id=row.current_version_id,
        archived_at=row.archived_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _version_record(row: WorkflowVersion) -> WorkflowVersionRecord:
    return WorkflowVersionRecord(
        id=row.id,
        workflow_id=row.workflow_id,
        version_n=row.version_n,
        definition_json=dict(row.definition_json or {}),
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
    )


def _run_record(row: WorkflowRun) -> WorkflowRunRecord:
    return WorkflowRunRecord(
        id=row.id,
        workflow_id=row.workflow_id,
        workflow_version_id=row.workflow_version_id,
        trigger_kind=row.trigger_kind,
        executor_user_id=row.executor_user_id,
        args_json=dict(row.args_json or {}),
        target_mode=row.target_mode,
        resolved_plan_json=dict(row.resolved_plan_json or {}),
        status=row.status,
        step_cursor=row.step_cursor,
        step_outputs_json=(
            dict(row.step_outputs_json) if row.step_outputs_json is not None else None
        ),
        anyharness_workspace_id=row.anyharness_workspace_id,
        anyharness_session_ids=(
            list(row.anyharness_session_ids) if row.anyharness_session_ids is not None else None
        ),
        error_code=row.error_code,
        error_message=row.error_message,
        cost_usd=row.cost_usd,
        cost_tokens=row.cost_tokens,
        created_at=row.created_at,
        updated_at=row.updated_at,
        delivered_at=row.delivered_at,
        started_at=row.started_at,
        finished_at=row.finished_at,
    )


# --- workflows + versions ------------------------------------------------------


async def create_workflow_with_version(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    created_by_user_id: UUID,
    name: str,
    description: str | None,
    definition_json: dict[str, object],
) -> tuple[WorkflowRecord, WorkflowVersionRecord]:
    """Insert a workflow, its version 1, and point the workflow at that version."""

    now = utcnow()
    workflow = Workflow(
        owner_user_id=owner_user_id,
        created_by_user_id=created_by_user_id,
        name=name,
        description=description,
        current_version_id=None,
        created_at=now,
        updated_at=now,
    )
    db.add(workflow)
    await db.flush()
    version = WorkflowVersion(
        workflow_id=workflow.id,
        version_n=1,
        definition_json=definition_json,
        created_by_user_id=created_by_user_id,
        created_at=now,
    )
    db.add(version)
    await db.flush()
    workflow.current_version_id = version.id
    await db.flush()
    return _workflow_record(workflow), _version_record(version)


async def append_version(
    db: AsyncSession,
    *,
    workflow_id: UUID,
    definition_json: dict[str, object],
    created_by_user_id: UUID,
    name: str | None = None,
    description: str | None = None,
    update_description: bool = False,
) -> tuple[WorkflowRecord, WorkflowVersionRecord] | None:
    """Append a new immutable version, bump ``current_version_id``, update meta."""

    workflow = await db.get(Workflow, workflow_id)
    if workflow is None:
        return None
    next_n = (
        await db.execute(
            select(func.coalesce(func.max(WorkflowVersion.version_n), 0)).where(
                WorkflowVersion.workflow_id == workflow_id
            )
        )
    ).scalar_one() + 1
    now = utcnow()
    version = WorkflowVersion(
        workflow_id=workflow_id,
        version_n=next_n,
        definition_json=definition_json,
        created_by_user_id=created_by_user_id,
        created_at=now,
    )
    db.add(version)
    await db.flush()
    workflow.current_version_id = version.id
    if name is not None:
        workflow.name = name
    if update_description:
        workflow.description = description
    workflow.updated_at = now
    await db.flush()
    return _workflow_record(workflow), _version_record(version)


async def get_workflow(db: AsyncSession, workflow_id: UUID) -> WorkflowRecord | None:
    row = await db.get(Workflow, workflow_id)
    return None if row is None else _workflow_record(row)


async def list_workflows(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    include_archived: bool = False,
) -> tuple[WorkflowRecord, ...]:
    stmt = select(Workflow).where(Workflow.owner_user_id == owner_user_id)
    if not include_archived:
        stmt = stmt.where(Workflow.archived_at.is_(None))
    stmt = stmt.order_by(Workflow.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return tuple(_workflow_record(row) for row in rows)


async def count_active_workflows(db: AsyncSession, *, owner_user_id: UUID) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Workflow)
            .where(Workflow.owner_user_id == owner_user_id, Workflow.archived_at.is_(None))
        )
    ).scalar_one()


async def archive_workflow(db: AsyncSession, workflow_id: UUID) -> WorkflowRecord | None:
    row = await db.get(Workflow, workflow_id)
    if row is None:
        return None
    if row.archived_at is None:
        now = utcnow()
        row.archived_at = now
        row.updated_at = now
        await db.flush()
    return _workflow_record(row)


async def get_version(db: AsyncSession, version_id: UUID) -> WorkflowVersionRecord | None:
    row = await db.get(WorkflowVersion, version_id)
    return None if row is None else _version_record(row)


async def list_versions(
    db: AsyncSession, *, workflow_id: UUID
) -> tuple[WorkflowVersionRecord, ...]:
    rows = (
        (
            await db.execute(
                select(WorkflowVersion)
                .where(WorkflowVersion.workflow_id == workflow_id)
                .order_by(WorkflowVersion.version_n.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_version_record(row) for row in rows)


# --- runs ----------------------------------------------------------------------


async def create_run(
    db: AsyncSession,
    *,
    run_id: UUID | None = None,
    workflow_id: UUID,
    workflow_version_id: UUID,
    trigger_kind: str,
    executor_user_id: UUID,
    args_json: dict[str, object],
    target_mode: str,
    resolved_plan_json: dict[str, object],
) -> WorkflowRunRecord:
    now = utcnow()
    row = WorkflowRun(
        id=run_id or uuid4(),
        workflow_id=workflow_id,
        workflow_version_id=workflow_version_id,
        trigger_kind=trigger_kind,
        executor_user_id=executor_user_id,
        args_json=args_json,
        target_mode=target_mode,
        resolved_plan_json=resolved_plan_json,
        status=WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
        step_cursor=None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _run_record(row)


async def get_run(db: AsyncSession, run_id: UUID) -> WorkflowRunRecord | None:
    row = await db.get(WorkflowRun, run_id)
    return None if row is None else _run_record(row)


async def lock_run(db: AsyncSession, run_id: UUID) -> WorkflowRunRecord | None:
    """Row-lock a run for a status transition. Requires an open transaction."""

    row = (
        await db.execute(select(WorkflowRun).where(WorkflowRun.id == run_id).with_for_update())
    ).scalar_one_or_none()
    return None if row is None else _run_record(row)


async def list_runs(
    db: AsyncSession,
    *,
    executor_user_id: UUID,
    workflow_id: UUID | None = None,
    limit: int = 100,
) -> tuple[WorkflowRunRecord, ...]:
    stmt = select(WorkflowRun).where(WorkflowRun.executor_user_id == executor_user_id)
    if workflow_id is not None:
        stmt = stmt.where(WorkflowRun.workflow_id == workflow_id)
    stmt = stmt.order_by(WorkflowRun.created_at.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return tuple(_run_record(row) for row in rows)


async def update_run(
    db: AsyncSession,
    *,
    run_id: UUID,
    status: str | None = None,
    step_cursor: int | None = None,
    step_outputs_json: dict[str, object] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    anyharness_workspace_id: str | None = None,
    anyharness_session_ids: list[str] | None = None,
    cost_usd: Decimal | None = None,
    cost_tokens: int | None = None,
    delivered_at: datetime | None = None,
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
) -> WorkflowRunRecord | None:
    """Apply a run update. Only non-None arguments are written."""

    row = await db.get(WorkflowRun, run_id)
    if row is None:
        return None
    if status is not None:
        row.status = status
    if step_cursor is not None:
        row.step_cursor = step_cursor
    if step_outputs_json is not None:
        row.step_outputs_json = step_outputs_json
    if error_code is not None:
        row.error_code = error_code
    if error_message is not None:
        row.error_message = error_message
    if anyharness_workspace_id is not None:
        row.anyharness_workspace_id = anyharness_workspace_id
    if anyharness_session_ids is not None:
        row.anyharness_session_ids = anyharness_session_ids
    if cost_usd is not None:
        row.cost_usd = cost_usd
    if cost_tokens is not None:
        row.cost_tokens = cost_tokens
    if delivered_at is not None:
        row.delivered_at = delivered_at
    if started_at is not None:
        row.started_at = started_at
    if finished_at is not None:
        row.finished_at = finished_at
    row.updated_at = utcnow()
    await db.flush()
    return _run_record(row)
