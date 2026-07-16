"""Persistence helpers for broker-delivered background work."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.utils.time import utcnow

OUTBOX_STATUS_PENDING = "pending"
OUTBOX_STATUS_PUBLISHING = "publishing"
OUTBOX_STATUS_PUBLISHED = "published"
OUTBOX_STATUS_FAILED = "failed"

OutboxStatus = Literal["pending", "publishing", "published", "failed"]


class BackgroundOutboxTaskStatus(StrEnum):
    PENDING = OUTBOX_STATUS_PENDING
    PUBLISHING = OUTBOX_STATUS_PUBLISHING
    PUBLISHED = OUTBOX_STATUS_PUBLISHED
    FAILED = OUTBOX_STATUS_FAILED


@dataclass(frozen=True)
class BackgroundOutboxTaskValue:
    id: UUID
    task_name: str
    queue: str
    args_json: tuple[object, ...]
    kwargs_json: dict[str, object]
    idempotency_key: str | None
    status: BackgroundOutboxTaskStatus
    available_at: datetime
    attempt_count: int
    publish_claim_id: UUID | None
    locked_by: str | None
    published_task_id: str | None
    # True when this row was claimed by recovering an expired publishing lease
    # rather than a fresh pending row. Used only for telemetry; defaulted so the
    # frozen value stays constructible from any code path.
    recovered_from_lease: bool = False

    @property
    def celery_task_id(self) -> str:
        return str(self.id)


def _normalize_available_at(available_at: datetime | None, *, now: datetime) -> datetime:
    """Return an aware UTC instant for the outbox ``available_at`` column.

    Omission means "due now". A supplied naive datetime is interpreted as UTC;
    an aware datetime is converted to UTC. The wall-clock instant is preserved
    unchanged so an explicit future ``available_at`` schedules exactly as asked.
    """

    if available_at is None:
        return now
    if available_at.tzinfo is None:
        return available_at.replace(tzinfo=UTC)
    return available_at.astimezone(UTC)


def _task_value(
    record: BackgroundOutboxTask,
    *,
    recovered_from_lease: bool = False,
) -> BackgroundOutboxTaskValue:
    return BackgroundOutboxTaskValue(
        id=record.id,
        task_name=record.task_name,
        queue=record.queue,
        args_json=tuple(record.args_json),
        kwargs_json=dict(record.kwargs_json),
        idempotency_key=record.idempotency_key,
        status=BackgroundOutboxTaskStatus(record.status),
        available_at=record.available_at,
        attempt_count=record.attempt_count,
        publish_claim_id=record.publish_claim_id,
        locked_by=record.locked_by,
        published_task_id=record.published_task_id,
        recovered_from_lease=recovered_from_lease,
    )


async def enqueue_outbox_task(
    db: AsyncSession,
    *,
    task_name: str,
    queue: str,
    args_json: tuple[object, ...] = (),
    kwargs_json: dict[str, object] | None = None,
    task_id: UUID | None = None,
    idempotency_key: str | None = None,
    available_at: datetime | None = None,
) -> BackgroundOutboxTaskValue:
    now = utcnow()
    outbox_id = task_id or uuid4()
    values = {
        "id": outbox_id,
        "task_name": task_name,
        "queue": queue,
        "args_json": list(args_json),
        "kwargs_json": dict(kwargs_json or {}),
        "idempotency_key": idempotency_key,
        "status": OUTBOX_STATUS_PENDING,
        "available_at": _normalize_available_at(available_at, now=now),
        "attempt_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    statement = pg_insert(BackgroundOutboxTask).values(**values)
    if idempotency_key is not None:
        statement = statement.on_conflict_do_nothing(
            index_elements=[BackgroundOutboxTask.idempotency_key],
            index_where=BackgroundOutboxTask.idempotency_key.is_not(None),
        )
    else:
        statement = statement.on_conflict_do_nothing(
            index_elements=[BackgroundOutboxTask.id],
        )
    inserted_id = await db.scalar(statement.returning(BackgroundOutboxTask.id))
    await db.flush()

    if inserted_id is not None:
        value = await load_outbox_task(db, inserted_id)
    elif idempotency_key is not None:
        value = await load_outbox_task_by_idempotency_key(db, idempotency_key)
    else:
        value = await load_outbox_task(db, outbox_id)

    if value is None:
        raise RuntimeError("Background outbox task was not persisted.")
    return value


async def load_outbox_task(
    db: AsyncSession,
    outbox_id: UUID,
) -> BackgroundOutboxTaskValue | None:
    record = await db.get(BackgroundOutboxTask, outbox_id)
    return None if record is None else _task_value(record)


async def load_outbox_task_by_idempotency_key(
    db: AsyncSession,
    idempotency_key: str,
) -> BackgroundOutboxTaskValue | None:
    record = (
        await db.execute(
            select(BackgroundOutboxTask).where(
                BackgroundOutboxTask.idempotency_key == idempotency_key
            )
        )
    ).scalar_one_or_none()
    return None if record is None else _task_value(record)


async def claim_due_outbox_tasks(
    db: AsyncSession,
    *,
    worker_id: str,
    limit: int,
    lease_seconds: float,
) -> tuple[BackgroundOutboxTaskValue, ...]:
    now = utcnow()
    rows = (
        await db.execute(
            select(BackgroundOutboxTask)
            .where(
                or_(
                    and_(
                        BackgroundOutboxTask.status == OUTBOX_STATUS_PENDING,
                        BackgroundOutboxTask.available_at <= now,
                    ),
                    and_(
                        BackgroundOutboxTask.status == OUTBOX_STATUS_PUBLISHING,
                        BackgroundOutboxTask.lock_expires_at.is_not(None),
                        BackgroundOutboxTask.lock_expires_at <= now,
                    ),
                )
            )
            .order_by(
                BackgroundOutboxTask.available_at.asc(),
                BackgroundOutboxTask.created_at.asc(),
                BackgroundOutboxTask.id.asc(),
            )
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    ).scalars()
    locked_until = now + timedelta(seconds=lease_seconds)
    values: list[BackgroundOutboxTaskValue] = []
    for row in rows:
        recovered = row.status == OUTBOX_STATUS_PUBLISHING
        row.status = OUTBOX_STATUS_PUBLISHING
        row.publish_claim_id = uuid4()
        row.locked_by = worker_id
        row.locked_at = now
        row.lock_expires_at = locked_until
        row.attempt_count += 1
        row.updated_at = now
        values.append(_task_value(row, recovered_from_lease=recovered))
    await db.flush()
    return tuple(values)


async def mark_outbox_task_published(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    publish_claim_id: UUID,
    published_task_id: str,
) -> bool:
    record = await _load_for_update(db, outbox_id)
    if record is None:
        return False
    if record.publish_claim_id != publish_claim_id:
        return False
    now = utcnow()
    record.status = OUTBOX_STATUS_PUBLISHED
    record.publish_claim_id = None
    record.published_task_id = published_task_id
    record.published_at = now
    record.locked_by = None
    record.locked_at = None
    record.lock_expires_at = None
    record.last_error_code = None
    record.last_error_message = None
    record.updated_at = now
    await db.flush()
    return True


async def mark_outbox_task_publish_failed(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    publish_claim_id: UUID,
    error_code: str,
    error_message: str,
    retry_delay_seconds: float,
    terminal: bool,
) -> bool:
    """Record a publish failure under the claim guard.

    ``terminal`` decides the outcome rather than an attempt ceiling: supported
    correctness-sensitive tasks retry indefinitely (``terminal=False``) with a
    caller-computed capped backoff delay, while an unsupported task name is
    parked terminally (``terminal=True``). ``error_code`` and ``error_message``
    are already bounded and secret-safe at the call site; they are additionally
    truncated here as defense in depth.
    """

    record = await _load_for_update(db, outbox_id)
    if record is None:
        return False
    if record.publish_claim_id != publish_claim_id:
        return False
    now = utcnow()
    record.status = OUTBOX_STATUS_FAILED if terminal else OUTBOX_STATUS_PENDING
    record.publish_claim_id = None
    if not terminal:
        record.available_at = now + timedelta(seconds=retry_delay_seconds)
    record.locked_by = None
    record.locked_at = None
    record.lock_expires_at = None
    record.last_error_code = error_code[:128]
    record.last_error_message = error_message[:512]
    record.updated_at = now
    await db.flush()
    return True


@dataclass(frozen=True)
class OutboxBacklogSnapshot:
    """Low-cardinality gauges for background-plane health telemetry."""

    due_pending_count: int
    publishing_count: int
    expired_publishing_count: int
    failed_count: int
    oldest_due_pending_age_seconds: float
    # Pending-row counts keyed by supported task family. Cardinality is bounded
    # by the caller's supported-task allowlist: only recognized families appear,
    # so this never widens to an unbounded set of arbitrary task names.
    supported_pending_by_family: dict[str, int] = field(default_factory=dict)
    supported_oldest_pending_age_by_family: dict[str, float] = field(
        default_factory=dict
    )


async def get_outbox_backlog_snapshot(
    db: AsyncSession,
    *,
    supported_task_names: Collection[str] = (),
) -> OutboxBacklogSnapshot:
    """Return backlog gauges for the relay to emit as safe metrics.

    All values are process-independent aggregates over the whole table so any
    relay tick observes the same picture. ``oldest_due_pending_age_seconds`` is
    the SLO signal alarmed on in hosted infrastructure.

    ``supported_task_names`` bounds the per-family pending breakdown: every name
    in the allowlist is reported (zero when absent) and no other name is ever
    projected, so the emitted metric stays low-cardinality and secret-safe.
    """

    now = utcnow()
    oldest_due = await db.scalar(
        select(func.min(BackgroundOutboxTask.available_at)).where(
            BackgroundOutboxTask.status == OUTBOX_STATUS_PENDING,
            BackgroundOutboxTask.available_at <= now,
        )
    )
    due_pending = await db.scalar(
        select(func.count())
        .select_from(BackgroundOutboxTask)
        .where(
            BackgroundOutboxTask.status == OUTBOX_STATUS_PENDING,
            BackgroundOutboxTask.available_at <= now,
        )
    )
    publishing = await db.scalar(
        select(func.count())
        .select_from(BackgroundOutboxTask)
        .where(BackgroundOutboxTask.status == OUTBOX_STATUS_PUBLISHING)
    )
    expired_publishing = await db.scalar(
        select(func.count())
        .select_from(BackgroundOutboxTask)
        .where(
            BackgroundOutboxTask.status == OUTBOX_STATUS_PUBLISHING,
            BackgroundOutboxTask.lock_expires_at.is_not(None),
            BackgroundOutboxTask.lock_expires_at <= now,
        )
    )
    failed = await db.scalar(
        select(func.count())
        .select_from(BackgroundOutboxTask)
        .where(BackgroundOutboxTask.status == OUTBOX_STATUS_FAILED)
    )
    supported_pending_by_family: dict[str, int] = {name: 0 for name in supported_task_names}
    supported_oldest_pending_age_by_family: dict[str, float] = {
        name: 0.0 for name in supported_task_names
    }
    if supported_pending_by_family:
        family_rows = await db.execute(
            select(
                BackgroundOutboxTask.task_name,
                func.count(),
                func.min(BackgroundOutboxTask.created_at),
            )
            .where(
                BackgroundOutboxTask.status == OUTBOX_STATUS_PENDING,
                BackgroundOutboxTask.task_name.in_(list(supported_pending_by_family)),
            )
            .group_by(BackgroundOutboxTask.task_name)
        )
        for task_name, count, oldest_created_at in family_rows.all():
            supported_pending_by_family[task_name] = int(count or 0)
            supported_oldest_pending_age_by_family[task_name] = max(
                0.0, (now - oldest_created_at).total_seconds()
            )
    oldest_age = 0.0 if oldest_due is None else max(0.0, (now - oldest_due).total_seconds())
    return OutboxBacklogSnapshot(
        due_pending_count=int(due_pending or 0),
        publishing_count=int(publishing or 0),
        expired_publishing_count=int(expired_publishing or 0),
        failed_count=int(failed or 0),
        oldest_due_pending_age_seconds=oldest_age,
        supported_pending_by_family=supported_pending_by_family,
        supported_oldest_pending_age_by_family=supported_oldest_pending_age_by_family,
    )


async def _load_for_update(
    db: AsyncSession,
    outbox_id: UUID,
) -> BackgroundOutboxTask | None:
    return (
        await db.execute(
            select(BackgroundOutboxTask)
            .where(BackgroundOutboxTask.id == outbox_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
