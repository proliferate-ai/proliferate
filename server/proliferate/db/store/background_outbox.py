"""Persistence helpers for broker-delivered background work."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import and_, or_, select
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

    @property
    def celery_task_id(self) -> str:
        return str(self.id)


def _task_value(record: BackgroundOutboxTask) -> BackgroundOutboxTaskValue:
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
        "available_at": now,
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
        row.status = OUTBOX_STATUS_PUBLISHING
        row.publish_claim_id = uuid4()
        row.locked_by = worker_id
        row.locked_at = now
        row.lock_expires_at = locked_until
        row.attempt_count += 1
        row.updated_at = now
        values.append(_task_value(row))
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
    max_attempts: int,
) -> bool:
    record = await _load_for_update(db, outbox_id)
    if record is None:
        return False
    if record.publish_claim_id != publish_claim_id:
        return False
    now = utcnow()
    exhausted = record.attempt_count >= max_attempts
    record.status = OUTBOX_STATUS_FAILED if exhausted else OUTBOX_STATUS_PENDING
    record.publish_claim_id = None
    record.available_at = now + timedelta(seconds=retry_delay_seconds)
    record.locked_by = None
    record.locked_at = None
    record.lock_expires_at = None
    record.last_error_code = error_code[:128]
    record.last_error_message = error_message
    record.updated_at = now
    await db.flush()
    return True


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
