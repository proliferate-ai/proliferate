"""Persistence for workflows, immutable versions, and the run ledger."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
    WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_EXPIRED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_TERMINAL_STATUSES,
    WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db.models.cloud.workflows import (
    Workflow,
    WorkflowRun,
    WorkflowRunGatewayToken,
    WorkflowStepAction,
    WorkflowVersion,
)
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
    trigger_id: UUID | None
    scheduled_for: datetime | None
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
    stopped_by_user_id: UUID | None = None


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
        trigger_id=row.trigger_id,
        scheduled_for=row.scheduled_for,
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
        stopped_by_user_id=row.stopped_by_user_id,
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
    anyharness_workspace_id: str | None = None,
    trigger_id: UUID | None = None,
    scheduled_for: datetime | None = None,
) -> WorkflowRunRecord:
    now = utcnow()
    row = WorkflowRun(
        id=run_id or uuid4(),
        workflow_id=workflow_id,
        workflow_version_id=workflow_version_id,
        trigger_kind=trigger_kind,
        trigger_id=trigger_id,
        scheduled_for=scheduled_for,
        executor_user_id=executor_user_id,
        args_json=args_json,
        target_mode=target_mode,
        resolved_plan_json=resolved_plan_json,
        status=WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
        step_cursor=None,
        # For cloud runs the delivery target workspace is known up front and
        # never changes; recording it lets delivery + refresh resolve the sandbox
        # workspace without re-reading the cloud_workspace row.
        anyharness_workspace_id=anyharness_workspace_id,
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
    resolved_plan_json: dict[str, object] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    anyharness_workspace_id: str | None = None,
    anyharness_session_ids: list[str] | None = None,
    cost_usd: Decimal | None = None,
    cost_tokens: int | None = None,
    delivered_at: datetime | None = None,
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
    stopped_by_user_id: UUID | None = None,
    clear_error: bool = False,
) -> WorkflowRunRecord | None:
    """Apply a run update. Only non-None arguments are written.

    ``clear_error`` is the one exception to the non-None rule: it nulls a prior
    ``delivery_failed`` marker when a re-delivery finally lands.
    """

    row = await db.get(WorkflowRun, run_id)
    if row is None:
        return None
    if status is not None:
        row.status = status
    if step_cursor is not None:
        row.step_cursor = step_cursor
    if step_outputs_json is not None:
        row.step_outputs_json = step_outputs_json
    if resolved_plan_json is not None:
        row.resolved_plan_json = resolved_plan_json
    if clear_error:
        row.error_code = None
        row.error_message = None
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
    if stopped_by_user_id is not None:
        row.stopped_by_user_id = stopped_by_user_id
    row.updated_at = utcnow()
    await db.flush()
    return _run_record(row)


# --- scheduler-lane run queries (W5) -------------------------------------------
#
# "Non-terminal" spans pending_delivery/delivered/running/waiting_approval — every
# status a trigger's prior run can occupy before it is done. The scheduler uses
# these to enforce concurrency (skip) and to order FIFO delivery (queue).

# FIFO ordering key for a trigger's runs: by the schedule slot, then creation.
_RUN_ORDER = (WorkflowRun.scheduled_for.asc(), WorkflowRun.created_at.asc(), WorkflowRun.id.asc())


async def has_non_terminal_run_for_trigger(db: AsyncSession, *, trigger_id: UUID) -> bool:
    """True if this trigger has a run that has not yet reached a terminal state."""

    found = (
        await db.execute(
            select(WorkflowRun.id)
            .where(
                WorkflowRun.trigger_id == trigger_id,
                WorkflowRun.status.notin_(tuple(WORKFLOW_RUN_TERMINAL_STATUSES)),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return found is not None


def _plan_bound_session_ids(resolved_plan_json: dict[str, object] | None) -> set[str]:
    """The session ids a resolved plan binds (B8: `sessions[slot].bind_session_id`)."""

    sessions = (resolved_plan_json or {}).get("sessions")
    if not isinstance(sessions, dict):
        return set()
    bound: set[str] = set()
    for slot in sessions.values():
        if isinstance(slot, dict):
            bind_id = slot.get("bind_session_id")
            if isinstance(bind_id, str) and bind_id:
                bound.add(bind_id)
    return bound


async def live_run_holding_session(db: AsyncSession, *, session_id: str) -> UUID | None:
    """The non-terminal ("live") run holding `session_id`, if any (B8 / E8).

    A run holds a session when its resolved plan binds it (`bind_session_id`) or
    it created/owns it (`anyharness_session_ids`, reported by the runtime). The
    run row is the durable lock (the runtime's owned-session registry is only its
    cache), so this is the authoritative server-side held check. The non-terminal
    run set is small, so an in-Python scan of nested plan slots is fine.
    """

    rows = (
        await db.execute(
            select(
                WorkflowRun.id,
                WorkflowRun.resolved_plan_json,
                WorkflowRun.anyharness_session_ids,
            ).where(WorkflowRun.status.notin_(tuple(WORKFLOW_RUN_TERMINAL_STATUSES)))
        )
    ).all()
    for run_id, resolved_plan_json, anyharness_session_ids in rows:
        if session_id in (anyharness_session_ids or []):
            return run_id
        if session_id in _plan_bound_session_ids(resolved_plan_json):
            return run_id
    return None


async def session_foreign_workspace(
    db: AsyncSession, *, session_id: str, target_workspace_id: str
) -> str | None:
    """A workspace `session_id` is known to belong to that is NOT `target_workspace_id`.

    The control plane has no session mirror; its only record of a session's home
    workspace is the run rows that referenced it (`anyharness_session_ids`, which
    the runtime reports per run). B8 requires a bound session to belong to the
    target workspace — so if history places it in a different workspace, reject.
    A session with no run history returns `None`; the runtime bind boundary
    (session must exist in the target sandbox) is the authoritative backstop.
    """

    rows = (
        await db.execute(
            select(WorkflowRun.anyharness_workspace_id).where(
                WorkflowRun.anyharness_session_ids.contains([session_id]),
                WorkflowRun.anyharness_workspace_id.isnot(None),
            )
        )
    ).all()
    for (workspace_id,) in rows:
        if workspace_id and workspace_id != target_workspace_id:
            return workspace_id
    return None


async def earliest_non_terminal_run_id_for_trigger(
    db: AsyncSession, *, trigger_id: UUID
) -> UUID | None:
    """The FIFO-first non-terminal run for a trigger (its "active" run), if any."""

    return (
        await db.execute(
            select(WorkflowRun.id)
            .where(
                WorkflowRun.trigger_id == trigger_id,
                WorkflowRun.status.notin_(tuple(WORKFLOW_RUN_TERMINAL_STATUSES)),
            )
            .order_by(*_RUN_ORDER)
            .limit(1)
        )
    ).scalar_one_or_none()


async def list_pending_scheduled_cloud_runs(
    db: AsyncSession, *, limit: int
) -> tuple[WorkflowRunRecord, ...]:
    """Server-delivered (schedule + poll) cloud runs still awaiting delivery,
    FIFO-ordered.

    The scheduler tick delivers only those whose trigger has no earlier
    non-terminal run (see ``earliest_non_terminal_run_id_for_trigger``), which is
    how ``queue`` defers a run behind its predecessor.
    """

    rows = (
        (
            await db.execute(
                select(WorkflowRun)
                .where(
                    WorkflowRun.status == WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
                    WorkflowRun.trigger_kind.in_(tuple(WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS)),
                    WorkflowRun.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
                    WorkflowRun.trigger_id.is_not(None),
                )
                .order_by(*_RUN_ORDER)
                .limit(max(1, limit))
            )
        )
        .scalars()
        .all()
    )
    return tuple(_run_record(row) for row in rows)


# --- step actions (PR A) ---------------------------------------------------------

_IN_FLIGHT_STATUSES = ("delivered", "running", "waiting_approval")


@dataclass(frozen=True)
class StepActionRecord:
    id: UUID
    run_id: UUID
    step_key: str
    action_kind: str
    status: str
    attempt_count: int
    result_json: dict[str, object] | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


def _action_record(row: WorkflowStepAction) -> StepActionRecord:
    return StepActionRecord(
        id=row.id,
        run_id=row.run_id,
        step_key=row.step_key,
        action_kind=row.action_kind,
        status=row.status,
        attempt_count=row.attempt_count,
        result_json=dict(row.result_json) if row.result_json else None,
        error_message=row.error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_retryable_actions(
    db: AsyncSession, *, before: datetime, max_attempts: int, limit: int = 50
) -> tuple[StepActionRecord, ...]:
    """Pending or transiently-failed actions older than ``before`` and still
    under ``max_attempts`` (the sweep scan). Covers both a crashed owner
    (stale 'pending') and a transient failure (e.g. Slack API error, 'failed')."""
    rows = (
        (
            await db.execute(
                select(WorkflowStepAction)
                .where(
                    WorkflowStepAction.status.in_(("pending", "failed")),
                    WorkflowStepAction.attempt_count < max_attempts,
                    WorkflowStepAction.updated_at < before,
                )
                .order_by(WorkflowStepAction.updated_at.asc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_action_record(row) for row in rows)


async def list_actions_for_run(
    db: AsyncSession, *, run_id: UUID
) -> tuple[StepActionRecord, ...]:
    rows = (
        (
            await db.execute(
                select(WorkflowStepAction)
                .where(WorkflowStepAction.run_id == run_id)
                .order_by(WorkflowStepAction.step_key.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_action_record(row) for row in rows)


# --- per-run gateway token (PR E / OPEN-3a) ------------------------------------


@dataclass(frozen=True)
class RunGatewayTokenRecord:
    id: UUID
    workflow_run_id: UUID
    owner_user_id: UUID
    organization_id: UUID | None
    # E3: per-slot namespace grant ``{"<slot>": {"integrations": [...]}}`` (§2.6).
    scope_json: dict[str, dict[str, object]]
    status: str
    expires_at: datetime


def _run_gateway_token_record(row: WorkflowRunGatewayToken) -> RunGatewayTokenRecord:
    scope = row.scope_json if isinstance(row.scope_json, dict) else {}
    return RunGatewayTokenRecord(
        id=row.id,
        workflow_run_id=row.workflow_run_id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        scope_json=dict(scope),
        status=row.status,
        expires_at=row.expires_at,
    )


async def create_run_gateway_token(
    db: AsyncSession,
    *,
    workflow_run_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID | None,
    token_hash: str,
    scope_json: dict[str, dict[str, object]],
    expires_at: datetime,
) -> RunGatewayTokenRecord:
    now = utcnow()
    row = WorkflowRunGatewayToken(
        workflow_run_id=workflow_run_id,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        token_hash=token_hash,
        scope_json=scope_json,
        status=WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _run_gateway_token_record(row)


async def get_active_run_gateway_token_by_hash(
    db: AsyncSession, *, token_hash: str, now: datetime
) -> RunGatewayTokenRecord | None:
    """An active, unexpired run gateway token by its hash (the ping/gateway auth)."""

    row = (
        await db.execute(
            select(WorkflowRunGatewayToken).where(
                WorkflowRunGatewayToken.token_hash == token_hash,
                WorkflowRunGatewayToken.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
                WorkflowRunGatewayToken.expires_at > now,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.last_used_at = now
    await db.flush()
    return _run_gateway_token_record(row)


async def refreeze_run_gateway_token_scope(
    db: AsyncSession, *, workflow_run_id: UUID, scope_json: dict[str, dict[str, object]]
) -> None:
    """L25 delivery re-freeze: set the active token's scope to the intersection."""

    rows = (
        (
            await db.execute(
                select(WorkflowRunGatewayToken).where(
                    WorkflowRunGatewayToken.workflow_run_id == workflow_run_id,
                    WorkflowRunGatewayToken.status
                    == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.scope_json = scope_json
        row.updated_at = now
    if rows:
        await db.flush()


async def expire_run_gateway_tokens_for_run(db: AsyncSession, *, workflow_run_id: UUID) -> int:
    """Flip a run's active gateway token(s) to expired. Idempotent: an already
    terminal run has no active token, so the update touches nothing."""

    rows = (
        (
            await db.execute(
                select(WorkflowRunGatewayToken).where(
                    WorkflowRunGatewayToken.workflow_run_id == workflow_run_id,
                    WorkflowRunGatewayToken.status
                    == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.status = WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_EXPIRED
        row.updated_at = now
    if rows:
        await db.flush()
    return len(rows)


async def list_in_flight_triggered_cloud_runs(
    db: AsyncSession, *, limit: int, delivered_before: datetime | None = None
) -> tuple[WorkflowRunRecord, ...]:
    """In-flight cloud runs originated by triggers (scheduled/polled) for phase-3 refresh.

    ``delivered_before`` excludes runs delivered after the given timestamp (skip
    runs just delivered this tick -- they need time to execute).
    """
    stmt = (
        select(WorkflowRun)
        .where(
            WorkflowRun.status.in_(_IN_FLIGHT_STATUSES),
            WorkflowRun.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
            WorkflowRun.trigger_id.is_not(None),
        )
    )
    if delivered_before is not None:
        stmt = stmt.where(WorkflowRun.delivered_at < delivered_before)
    stmt = stmt.order_by(WorkflowRun.updated_at.asc()).limit(max(1, limit))
    rows = (await db.execute(stmt)).scalars().all()
    return tuple(_run_record(row) for row in rows)
