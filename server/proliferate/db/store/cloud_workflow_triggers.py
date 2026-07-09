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

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_TRIGGER_KIND_POLL,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
)
from proliferate.db.models.cloud.workflows import (
    Workflow,
    WorkflowTrigger,
    WorkflowTriggerItem,
)
from proliferate.db.store import organizations as organizations_store
from proliferate.utils.time import utcnow


async def _organization_id_for_owner(db: AsyncSession, *, owner_user_id: UUID) -> UUID | None:
    """Workflows are user-scoped today (no ``organization_id`` column on the row) —
    mirrors ``gateway_grants._organization_id_for_owner``, the house pattern for
    deriving the owner's org for org-aware lookups/telemetry."""

    membership = await organizations_store.get_current_membership_for_user(db, owner_user_id)
    return membership.organization.id if membership is not None else None


@dataclass(frozen=True)
class WorkflowTriggerRecord:
    id: UUID
    workflow_id: UUID
    kind: str
    enabled: bool
    concurrency_policy: str
    target_mode: str
    repo_full_name: str | None
    target_workspace_id: UUID | None
    input_presets_json: dict[str, object] | None
    schedule_rrule: str | None
    schedule_timezone: str | None
    schedule_summary: str | None
    next_run_at: datetime | None
    last_scheduled_at: datetime | None
    last_skipped_at: datetime | None
    last_skip_reason: str | None
    args_json: dict[str, object]
    # poll config (kind == 'poll'). poll_auth_ciphertext is intentionally NOT
    # surfaced on the record — the secret never leaves the DB except to the poller.
    poll_url: str | None
    poll_auth_header: str | None
    poll_has_auth: bool
    poll_interval_secs: int | None
    poll_item_schema_json: dict[str, object] | None
    last_poll_at: datetime | None
    last_poll_error: str | None
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class DueScheduleTrigger:
    """A row-locked, due schedule trigger plus the owner context StartRun needs."""

    id: UUID
    workflow_id: UUID
    workflow_owner_user_id: UUID
    workflow_organization_id: UUID | None
    workflow_archived: bool
    concurrency_policy: str
    target_mode: str
    target_workspace_id: UUID | None
    schedule_rrule: str
    schedule_timezone: str
    args_json: dict[str, object]


@dataclass(frozen=True)
class DuePollTrigger:
    """A row-locked, due poll trigger plus the owner context the poller needs.

    ``poll_auth_ciphertext`` IS carried here — the poller decrypts it to build the
    request auth header. It never leaves this process boundary (never on the API).
    """

    id: UUID
    workflow_id: UUID
    workflow_owner_user_id: UUID
    workflow_organization_id: UUID | None
    workflow_archived: bool
    target_mode: str
    target_workspace_id: UUID | None
    poll_url: str
    poll_auth_header: str | None
    poll_auth_ciphertext: str | None
    poll_interval_secs: int
    poll_item_schema_json: dict[str, object] | None
    poll_cursor: str | None
    args_json: dict[str, object]


@dataclass(frozen=True)
class WorkflowTriggerItemRecord:
    trigger_id: UUID
    item_id: str
    run_id: UUID | None
    status: str
    error_message: str | None
    received_at: datetime


def _record(row: WorkflowTrigger) -> WorkflowTriggerRecord:
    return WorkflowTriggerRecord(
        id=row.id,
        workflow_id=row.workflow_id,
        kind=row.kind,
        enabled=row.enabled,
        concurrency_policy=row.concurrency_policy,
        target_mode=row.target_mode,
        repo_full_name=row.repo_full_name,
        target_workspace_id=row.target_workspace_id,
        input_presets_json=(
            dict(row.input_presets_json) if row.input_presets_json is not None else None
        ),
        schedule_rrule=row.schedule_rrule,
        schedule_timezone=row.schedule_timezone,
        schedule_summary=row.schedule_summary,
        next_run_at=row.next_run_at,
        last_scheduled_at=row.last_scheduled_at,
        last_skipped_at=row.last_skipped_at,
        last_skip_reason=row.last_skip_reason,
        args_json=dict(row.args_json or {}),
        poll_url=row.poll_url,
        poll_auth_header=row.poll_auth_header,
        poll_has_auth=row.poll_auth_ciphertext is not None,
        poll_interval_secs=row.poll_interval_secs,
        poll_item_schema_json=(
            dict(row.poll_item_schema_json) if row.poll_item_schema_json is not None else None
        ),
        last_poll_at=row.last_poll_at,
        last_poll_error=row.last_poll_error,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _item_record(row: WorkflowTriggerItem) -> WorkflowTriggerItemRecord:
    return WorkflowTriggerItemRecord(
        trigger_id=row.trigger_id,
        item_id=row.item_id,
        run_id=row.run_id,
        status=row.status,
        error_message=row.error_message,
        received_at=row.received_at,
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
    repo_full_name: str | None = None,
    target_workspace_id: UUID | None,
    input_presets_json: dict[str, object] | None = None,
    schedule_rrule: str | None = None,
    schedule_timezone: str | None = None,
    schedule_summary: str | None = None,
    next_run_at: datetime | None = None,
    poll_url: str | None = None,
    poll_auth_header: str | None = None,
    poll_auth_ciphertext: str | None = None,
    poll_interval_secs: int | None = None,
    poll_item_schema_json: dict[str, object] | None = None,
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
        repo_full_name=repo_full_name,
        target_workspace_id=target_workspace_id,
        input_presets_json=input_presets_json,
        schedule_rrule=schedule_rrule,
        schedule_timezone=schedule_timezone,
        schedule_summary=schedule_summary,
        next_run_at=next_run_at,
        poll_url=poll_url,
        poll_auth_header=poll_auth_header,
        poll_auth_ciphertext=poll_auth_ciphertext,
        poll_interval_secs=poll_interval_secs,
        poll_item_schema_json=poll_item_schema_json,
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
    repo_full_name: str | None = None,
    target_workspace_id: UUID | None = None,
    clear_target_workspace: bool = False,
    input_presets_json: dict[str, object] | None = None,
    write_input_presets: bool = False,
    schedule_rrule: str | None = None,
    schedule_timezone: str | None = None,
    schedule_summary: str | None = None,
    next_run_at: datetime | None = None,
    args_json: dict[str, object] | None = None,
    write_poll_config: bool = False,
    poll_url: str | None = None,
    poll_auth_header: str | None = None,
    poll_interval_secs: int | None = None,
    poll_item_schema_json: dict[str, object] | None = None,
    update_poll_auth: bool = False,
    poll_auth_ciphertext: str | None = None,
) -> WorkflowTriggerRecord | None:
    """Apply a trigger update. Only provided fields are written.

    ``clear_target_workspace`` lets a switch to a local target null the workspace
    (the plain ``target_workspace_id=None`` default is indistinguishable from "no
    change" otherwise).

    Poll config is written as a unit when ``write_poll_config`` is set (the
    service re-validates the whole merged config): the item schema / auth
    header may be nulled by passing ``None``. The encrypted auth value is
    written separately, gated on ``update_poll_auth`` — a poll edit that does not
    touch the secret must keep the stored ciphertext (never re-supplied on reads).
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
    if repo_full_name is not None:
        row.repo_full_name = repo_full_name
    if clear_target_workspace:
        row.target_workspace_id = None
    elif target_workspace_id is not None:
        row.target_workspace_id = target_workspace_id
    # write_input_presets lets the caller set presets to a fresh dict (incl. {})
    # unambiguously; a bare None default means "no change".
    if write_input_presets:
        row.input_presets_json = input_presets_json
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
    if write_poll_config:
        row.poll_url = poll_url
        row.poll_auth_header = poll_auth_header
        row.poll_interval_secs = poll_interval_secs
        row.poll_item_schema_json = poll_item_schema_json
    if update_poll_auth:
        row.poll_auth_ciphertext = poll_auth_ciphertext
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
    organization_id = await _organization_id_for_owner(db, owner_user_id=workflow.owner_user_id)
    return DueScheduleTrigger(
        id=row.id,
        workflow_id=row.workflow_id,
        workflow_owner_user_id=workflow.owner_user_id,
        workflow_organization_id=organization_id,
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


# --- poller lane ---------------------------------------------------------------


def _poll_due_clause(now: datetime) -> ColumnElement[bool]:
    """Due = never polled, or elapsed seconds since last poll >= the interval.

    Uses ``extract(epoch from (now - last_poll_at))`` so the per-row interval is
    applied without fragile interval-literal arithmetic."""

    elapsed_secs = func.extract("epoch", now - WorkflowTrigger.last_poll_at)
    return or_(
        WorkflowTrigger.last_poll_at.is_(None),
        elapsed_secs >= WorkflowTrigger.poll_interval_secs,
    )


async def list_due_poll_trigger_ids(
    db: AsyncSession, *, now: datetime, limit: int
) -> list[UUID]:
    """Enabled poll triggers whose next poll is due.

    Due = never polled (``last_poll_at IS NULL``) or ``last_poll_at + interval``
    has passed. Never-polled triggers sort first (NULL orders before timestamps).
    """

    rows = (
        (
            await db.execute(
                select(WorkflowTrigger.id)
                .where(
                    WorkflowTrigger.kind == WORKFLOW_TRIGGER_KIND_POLL,
                    WorkflowTrigger.enabled.is_(True),
                    _poll_due_clause(now),
                )
                .order_by(WorkflowTrigger.last_poll_at.asc().nullsfirst())
                .limit(max(1, limit))
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def claim_due_poll_trigger(
    db: AsyncSession, *, trigger_id: UUID, now: datetime
) -> DuePollTrigger | None:
    """Row-lock one due poll trigger for polling. Requires an open transaction.

    ``SKIP LOCKED`` means a beat racing another poller simply moves on. Returns
    ``None`` if the trigger was taken, disabled, or is no longer due. The interval
    gate is re-checked under the lock (the id list may be stale by the time we
    claim), so a just-polled trigger is not polled again the same beat.
    """

    row = (
        await db.execute(
            select(WorkflowTrigger)
            .where(
                WorkflowTrigger.id == trigger_id,
                WorkflowTrigger.kind == WORKFLOW_TRIGGER_KIND_POLL,
                WorkflowTrigger.enabled.is_(True),
                _poll_due_clause(now),
            )
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if row is None or row.poll_url is None or row.poll_interval_secs is None:
        return None
    workflow = await db.get(Workflow, row.workflow_id)
    if workflow is None:
        return None
    organization_id = await _organization_id_for_owner(db, owner_user_id=workflow.owner_user_id)
    return DuePollTrigger(
        id=row.id,
        workflow_id=row.workflow_id,
        workflow_owner_user_id=workflow.owner_user_id,
        workflow_organization_id=organization_id,
        workflow_archived=workflow.archived_at is not None,
        target_mode=row.target_mode,
        target_workspace_id=row.target_workspace_id,
        poll_url=row.poll_url,
        poll_auth_header=row.poll_auth_header,
        poll_auth_ciphertext=row.poll_auth_ciphertext,
        poll_interval_secs=row.poll_interval_secs,
        poll_item_schema_json=(
            dict(row.poll_item_schema_json) if row.poll_item_schema_json is not None else None
        ),
        poll_cursor=row.poll_cursor,
        args_json=dict(row.args_json or {}),
    )


async def insert_trigger_item(
    db: AsyncSession, *, trigger_id: UUID, item_id: str, status: str
) -> bool:
    """The seen-set CAS: INSERT ... ON CONFLICT DO NOTHING on the PK.

    Returns ``True`` when this call inserted the row (first sighting of the item
    for this trigger), ``False`` when the item was already recorded (a replay).
    The row is inserted with a provisional ``status`` the caller finalizes via
    ``mark_item`` once the item's fate is known.
    """

    stmt = (
        pg_insert(WorkflowTriggerItem)
        .values(
            trigger_id=trigger_id,
            item_id=item_id,
            status=status,
            received_at=utcnow(),
        )
        .on_conflict_do_nothing(index_elements=["trigger_id", "item_id"])
        .returning(WorkflowTriggerItem.item_id)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def mark_item(
    db: AsyncSession,
    *,
    trigger_id: UUID,
    item_id: str,
    status: str,
    error_message: str | None = None,
    run_id: UUID | None = None,
) -> None:
    """Finalize a seen-set item's outcome (spawned / invalid / error)."""

    row = await db.get(WorkflowTriggerItem, (trigger_id, item_id))
    if row is None:
        return
    row.status = status
    row.error_message = error_message
    row.run_id = run_id
    await db.flush()


async def persist_poll_cursor(
    db: AsyncSession,
    *,
    trigger_id: UUID,
    cursor: str | None,
    polled_at: datetime,
    error: str | None = None,
) -> None:
    """Advance the opaque cursor + last_poll_at in the SAME transaction as the
    item rows. A clean poll clears ``last_poll_error``; an HTTP/shape failure
    passes ``error`` (and leaves the cursor untouched by passing the old value)."""

    row = await db.get(WorkflowTrigger, trigger_id)
    if row is None:
        return
    row.poll_cursor = cursor
    row.last_poll_at = polled_at
    row.last_poll_error = error
    row.updated_at = utcnow()
    await db.flush()


async def list_trigger_items(
    db: AsyncSession, *, trigger_id: UUID, limit: int = 100, offset: int = 0
) -> tuple[WorkflowTriggerItemRecord, ...]:
    """A trigger's seen-set items, newest first (for the per-item trigger UI)."""

    rows = (
        (
            await db.execute(
                select(WorkflowTriggerItem)
                .where(WorkflowTriggerItem.trigger_id == trigger_id)
                .order_by(WorkflowTriggerItem.received_at.desc())
                .limit(max(1, limit))
                .offset(max(0, offset))
            )
        )
        .scalars()
        .all()
    )
    return tuple(_item_record(row) for row in rows)
