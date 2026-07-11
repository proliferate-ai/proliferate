"""Persistence for workflows, immutable versions, and the run ledger."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_LOCAL_ACTIVE_CLAIM_STATUSES,
    WORKFLOW_LOCAL_RECLAIMABLE_STATUSES,
    WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
    WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_EXPIRED,
    WORKFLOW_RUN_STATUS_CLAIMABLE,
    WORKFLOW_RUN_STATUS_CLAIMED,
    WORKFLOW_RUN_STATUS_MISSED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_TERMINAL_STATUSES,
    WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS,
    WORKFLOW_TARGET_MODE_LOCAL,
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


class WorkflowLedgerImmutableError(ValueError):
    """Raised when a caller tries to mutate an immutable run-ledger field.

    Once a run row exists, its logical ``resolved_plan_json`` and ``plan_hash``
    are frozen (feature spec §5.2 — the plan + its content hash are immutable
    delivery identity). The delivery-time gateway fold now targets the private
    envelope, so nothing legitimately rewrites the logical plan after creation.
    """


@dataclass(frozen=True)
class WorkflowRecord:
    id: UUID
    owner_user_id: UUID | None
    created_by_user_id: UUID | None
    name: str
    description: str | None
    current_version_id: UUID | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    is_seed: bool = False
    seed_slug: str | None = None


@dataclass(frozen=True)
class WorkflowVersionRecord:
    id: UUID
    workflow_id: UUID
    version_n: int
    definition_json: dict[str, object]
    created_by_user_id: UUID | None
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
    # Desktop-executor claim plane (2a); set only on local scheduled runs.
    executor_id: str | None = None
    claim_id: UUID | None = None
    claimed_at: datetime | None = None
    claim_expires_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    # WS2b: the secret-free plan's immutable identity + the PRIVATE envelope.
    # ``plan_hash`` is the SHA-256 over RFC 8785 canonical JSON of the logical
    # plan; ``plan_version`` is the delivery-identity plan schema version (2).
    # ``private_envelope_json`` holds the run's gateway block (plaintext bearer)
    # and is NEVER exposed by ordinary run APIs. The desired/delivery state axes
    # (§8.1) begin here at StartRun; public status still derives from ``status``.
    plan_hash: str | None = None
    plan_version: int | None = None
    desired_state: str | None = None
    delivery_state: str | None = None
    private_envelope_json: dict[str, object] | None = None
    # WS2c: the remaining §8.1 axes + delivery identity read side. ``observed_*``
    # is the runtime-observed mirror written only by the revisioned report path;
    # ``execution_health``/``preaccept_cancel_state`` are server-owned coordination.
    binding_hash: str | None = None
    execution_generation: int | None = None
    observed_state: str | None = None
    observed_quiescence_state: str | None = None
    observed_revision: int | None = None
    execution_health: str | None = None
    preaccept_cancel_state: str | None = None


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
        is_seed=row.is_seed,
        seed_slug=row.seed_slug,
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
        executor_id=row.executor_id,
        claim_id=row.claim_id,
        claimed_at=row.claimed_at,
        claim_expires_at=row.claim_expires_at,
        last_heartbeat_at=row.last_heartbeat_at,
        plan_hash=row.plan_hash,
        plan_version=row.plan_version,
        desired_state=row.desired_state,
        delivery_state=row.delivery_state,
        private_envelope_json=(
            dict(row.private_envelope_json) if row.private_envelope_json is not None else None
        ),
        binding_hash=row.binding_hash,
        execution_generation=row.execution_generation,
        observed_state=row.observed_state,
        observed_quiescence_state=row.observed_quiescence_state,
        observed_revision=row.observed_revision,
        execution_health=row.execution_health,
        preaccept_cancel_state=row.preaccept_cancel_state,
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
    include_seeds: bool = True,
) -> tuple[WorkflowRecord, ...]:
    """The owner's own workflows, plus (by default) the code-defined seed rows.

    Seeds are org-agnostic (``is_seed=True``, ``owner_user_id IS NULL``) so they
    are unioned in rather than filtered by owner — this is also the strip/picker
    source query (track 1f): seeds show up alongside the org's most-recently-run
    workflows, annotated via ``WorkflowRecord.is_seed``.
    """
    condition = Workflow.owner_user_id == owner_user_id
    if include_seeds:
        condition = condition | (Workflow.is_seed.is_(True))
    stmt = select(Workflow).where(condition)
    if not include_archived:
        stmt = stmt.where(Workflow.archived_at.is_(None))
    stmt = stmt.order_by(Workflow.is_seed.asc(), Workflow.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return tuple(_workflow_record(row) for row in rows)


async def list_seed_workflows(db: AsyncSession) -> tuple[WorkflowRecord, ...]:
    """All non-archived seed workflow rows (reconciler read + strip/picker)."""

    stmt = (
        select(Workflow)
        .where(Workflow.is_seed.is_(True), Workflow.archived_at.is_(None))
        .order_by(Workflow.seed_slug.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return tuple(_workflow_record(row) for row in rows)


async def get_seed_workflow_by_slug(db: AsyncSession, *, seed_slug: str) -> WorkflowRecord | None:
    row = await db.scalar(
        select(Workflow).where(Workflow.is_seed.is_(True), Workflow.seed_slug == seed_slug)
    )
    return None if row is None else _workflow_record(row)


async def upsert_seed_workflow(
    db: AsyncSession,
    *,
    seed_slug: str,
    name: str,
    description: str | None,
    definition_json: dict[str, object],
) -> tuple[WorkflowRecord, WorkflowVersionRecord]:
    """Insert or update the seeded workflow for ``seed_slug`` (track 1f).

    Matches on ``is_seed=True`` + ``seed_slug``, mirroring the integration seed
    reconciler's ``source='seed'`` + namespace match. Idempotent: an unchanged
    definition is a no-op version bump is skipped when the definition is
    byte-identical to the current version's ``definition_json``. A changed
    definition appends a new immutable version (same append-only discipline as
    an authored edit) and repoints ``current_version_id``.
    """

    now = utcnow()
    workflow = await db.scalar(
        select(Workflow).where(Workflow.is_seed.is_(True), Workflow.seed_slug == seed_slug)
    )
    if workflow is None:
        workflow = Workflow(
            owner_user_id=None,
            created_by_user_id=None,
            name=name,
            description=description,
            is_seed=True,
            seed_slug=seed_slug,
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
            created_by_user_id=None,
            created_at=now,
        )
        db.add(version)
        await db.flush()
        workflow.current_version_id = version.id
        await db.flush()
        return _workflow_record(workflow), _version_record(version)

    # Existing seed row: reactivate if archived, refresh mutable meta, and only
    # append a new version when the definition actually changed.
    workflow.archived_at = None
    workflow.name = name
    workflow.description = description
    current_version = (
        await db.get(WorkflowVersion, workflow.current_version_id)
        if workflow.current_version_id
        else None
    )
    if current_version is not None and current_version.definition_json == definition_json:
        workflow.updated_at = now
        await db.flush()
        return _workflow_record(workflow), _version_record(current_version)

    next_n = (
        await db.execute(
            select(func.coalesce(func.max(WorkflowVersion.version_n), 0)).where(
                WorkflowVersion.workflow_id == workflow.id
            )
        )
    ).scalar_one() + 1
    version = WorkflowVersion(
        workflow_id=workflow.id,
        version_n=next_n,
        definition_json=definition_json,
        created_by_user_id=None,
        created_at=now,
    )
    db.add(version)
    await db.flush()
    workflow.current_version_id = version.id
    workflow.updated_at = now
    await db.flush()
    return _workflow_record(workflow), _version_record(version)


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
    status: str = WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    plan_hash: str | None = None,
    plan_version: int | None = None,
    desired_state: str | None = None,
    delivery_state: str | None = None,
    private_envelope_json: dict[str, object] | None = None,
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
        status=status,
        step_cursor=None,
        # For cloud runs the delivery target workspace is known up front and
        # never changes; recording it lets delivery + refresh resolve the sandbox
        # workspace without re-reading the cloud_workspace row.
        anyharness_workspace_id=anyharness_workspace_id,
        # WS2b: immutable plan identity + secret-free-plan state axes, stamped at
        # creation (the logical plan + its hash never change afterward).
        plan_hash=plan_hash,
        plan_version=plan_version,
        desired_state=desired_state,
        delivery_state=delivery_state,
        private_envelope_json=private_envelope_json,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _run_record(row)


async def create_missed_run(
    db: AsyncSession,
    *,
    workflow_id: UUID,
    workflow_version_id: UUID,
    executor_user_id: UUID,
    trigger_id: UUID,
    scheduled_for: datetime,
    trigger_kind: str,
    target_mode: str,
    args_json: dict[str, object],
) -> bool:
    """Record a terminal ``missed`` history row for an un-fired schedule slot (1c).

    An honest run-history marker for an occurrence the scheduler could not fire on
    time (an older slot under ``run_latest``, every slot under ``skip_all``). It
    wakes no sandbox and delivers no plan, so it carries an empty ``resolved_plan``
    and is born ``finished``. Deduped by the ``(trigger_id, scheduled_for)`` partial
    unique index via ``ON CONFLICT DO NOTHING`` — a re-tick over the same slot is a
    no-op. Returns ``True`` when this call inserted the row.
    """

    now = utcnow()
    stmt = (
        pg_insert(WorkflowRun)
        .values(
            id=uuid4(),
            workflow_id=workflow_id,
            workflow_version_id=workflow_version_id,
            trigger_kind=trigger_kind,
            trigger_id=trigger_id,
            scheduled_for=scheduled_for,
            executor_user_id=executor_user_id,
            args_json=args_json,
            target_mode=target_mode,
            resolved_plan_json={},
            status=WORKFLOW_RUN_STATUS_MISSED,
            created_at=now,
            updated_at=now,
            finished_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=["trigger_id", "scheduled_for"],
            index_where=text("trigger_id IS NOT NULL AND scheduled_for IS NOT NULL"),
        )
        .returning(WorkflowRun.id)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


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
    private_envelope_json: dict[str, object] | None = None,
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
    desired_state: str | None = None,
    delivery_state: str | None = None,
    observed_state: str | None = None,
    observed_quiescence_state: str | None = None,
    execution_health: str | None = None,
    preaccept_cancel_state: str | None = None,
    clear_error: bool = False,
) -> WorkflowRunRecord | None:
    """Apply a run update. Only non-None arguments are written.

    ``clear_error`` is the one exception to the non-None rule: it nulls a prior
    ``delivery_failed`` marker when a re-delivery finally lands.

    The independent state axes (§8.1; WS2c) are written alongside the legacy
    ``status`` here — ``status`` stays authoritative for public status until the
    API cutover. ``observed_state`` is set only by the accepted-observation path
    (worker/service.report_observed_run); ``execution_health`` = ``orphaned``
    never rides in the same call as an observed_* write (§8.1: orphaned is a
    server-owned coordination marker and never overwrites a runtime observation).

    IMMUTABLE-LEDGER GUARD (WS2b, feature spec §5.2): the logical
    ``resolved_plan_json`` is frozen once the run row exists — it and its
    ``plan_hash`` are the run's delivery identity. Every run is born with its
    plan set (``create_run``/``create_missed_run``), so any ``update_run`` attempt
    to rewrite it is a bug. The delivery-time gateway fold + claim rotation now
    write ``private_envelope_json`` instead, so no legitimate caller mutates the
    plan after creation. Raises rather than silently corrupting the ledger.
    """

    row = await db.get(WorkflowRun, run_id)
    if row is None:
        return None
    if resolved_plan_json is not None:
        raise WorkflowLedgerImmutableError(
            f"resolved_plan_json is immutable after creation (run {run_id}); the "
            "delivery-time gateway fold writes private_envelope_json instead."
        )
    if status is not None:
        row.status = status
    if step_cursor is not None:
        row.step_cursor = step_cursor
    if step_outputs_json is not None:
        row.step_outputs_json = step_outputs_json
    if private_envelope_json is not None:
        row.private_envelope_json = private_envelope_json
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
    if desired_state is not None:
        row.desired_state = desired_state
    if delivery_state is not None:
        row.delivery_state = delivery_state
    if observed_state is not None:
        row.observed_state = observed_state
    if observed_quiescence_state is not None:
        row.observed_quiescence_state = observed_quiescence_state
    if execution_health is not None:
        row.execution_health = execution_health
    if preaccept_cancel_state is not None:
        row.preaccept_cancel_state = preaccept_cancel_state
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


# --- desktop executor claim plane (track 2a; local scheduled runs) ---------------
#
# Ports the automations claim machinery (automation_run_claims.py) to workflow
# runs. These are direct, row-locked mutations — NOT runtime self-reports — so they
# do not funnel through the run_status transition guard; the claim/heartbeat rules
# live here. A cloud run never matches (every predicate pins target_mode=local).


async def claim_local_workflow_runs(
    db: AsyncSession,
    *,
    user_id: UUID,
    executor_id: str,
    claim_ttl: timedelta,
    limit: int,
    now: datetime,
) -> tuple[WorkflowRunRecord, ...]:
    """Atomically claim a batch of this owner's local runs for a desktop executor.

    Selects two kinds of run (``FOR UPDATE SKIP LOCKED``, FIFO by slot): a fresh
    ``claimable`` run, or a ``claimed`` run whose heartbeat lapsed past its TTL
    (the laptop closed pre-run — reclaimable). Each claimed row gets a *new*
    ``claim_id`` so a stale executor's later heartbeat/report is rejected, which is
    what makes the reclaim happen exactly once: two racing claimers contend on the
    row lock, the loser's ``SKIP LOCKED`` (or the now-fresh claim on re-read) drops
    it. A ``running`` run is deliberately NOT reclaimable — silently re-running it
    would double-execute; it waits for take-over (D15), like a stuck cloud run.
    """

    predicates = [
        WorkflowRun.target_mode == WORKFLOW_TARGET_MODE_LOCAL,
        WorkflowRun.executor_user_id == user_id,
        or_(
            WorkflowRun.status == WORKFLOW_RUN_STATUS_CLAIMABLE,
            and_(
                WorkflowRun.status.in_(tuple(WORKFLOW_LOCAL_RECLAIMABLE_STATUSES)),
                WorkflowRun.claim_expires_at.is_not(None),
                WorkflowRun.claim_expires_at <= now,
            ),
        ),
    ]
    rows = list(
        (
            await db.execute(
                select(WorkflowRun)
                .where(*predicates)
                .order_by(*_RUN_ORDER)
                .limit(max(1, limit))
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    expires_at = now + claim_ttl
    claimed: list[WorkflowRunRecord] = []
    for row in rows:
        row.status = WORKFLOW_RUN_STATUS_CLAIMED
        row.executor_id = executor_id
        row.claim_id = uuid4()
        row.claimed_at = now
        row.claim_expires_at = expires_at
        row.last_heartbeat_at = now
        row.updated_at = now
        claimed.append(_run_record(row))
    await db.flush()
    return tuple(claimed)


async def heartbeat_local_workflow_run(
    db: AsyncSession,
    *,
    run_id: UUID,
    claim_id: UUID,
    user_id: UUID,
    claim_ttl: timedelta,
    now: datetime,
) -> WorkflowRunRecord | None:
    """Extend a live claim's TTL. Returns the run when the heartbeat is accepted,
    ``None`` when the (run_id, claim_id) pair no longer owns an active local claim
    (reclaimed by another executor, terminal, or expired) — the executor must then
    stop, its claim is gone.
    """

    row = (
        await db.execute(
            select(WorkflowRun)
            .where(
                WorkflowRun.id == run_id,
                WorkflowRun.claim_id == claim_id,
                WorkflowRun.executor_user_id == user_id,
                WorkflowRun.target_mode == WORKFLOW_TARGET_MODE_LOCAL,
                WorkflowRun.status.in_(tuple(WORKFLOW_LOCAL_ACTIVE_CLAIM_STATUSES)),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.claim_expires_at is None or row.claim_expires_at <= now:
        # An expired claim is NOT silently revived: the run is already reclaimable
        # by another executor, so the stale holder must lose. (Matches the
        # automations ``claim_is_active`` guard.)
        return None
    row.claim_expires_at = now + claim_ttl
    row.last_heartbeat_at = now
    row.updated_at = now
    await db.flush()
    return _run_record(row)


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


async def list_actions_for_run(db: AsyncSession, *, run_id: UUID) -> tuple[StepActionRecord, ...]:
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
                    WorkflowRunGatewayToken.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
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
                    WorkflowRunGatewayToken.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
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
    stmt = select(WorkflowRun).where(
        WorkflowRun.status.in_(_IN_FLIGHT_STATUSES),
        WorkflowRun.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
        WorkflowRun.trigger_id.is_not(None),
    )
    if delivered_before is not None:
        stmt = stmt.where(WorkflowRun.delivered_at < delivered_before)
    stmt = stmt.order_by(WorkflowRun.updated_at.asc()).limit(max(1, limit))
    rows = (await db.execute(stmt)).scalars().all()
    return tuple(_run_record(row) for row in rows)
