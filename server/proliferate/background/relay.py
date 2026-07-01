"""Outbox-to-Celery relay for broker-delivered background work."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from celery import Celery
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.celery_app import celery_app
from proliferate.background.config import (
    HEALTH_NOOP_TASK,
)
from proliferate.db.store.background_outbox import (
    BackgroundOutboxTaskValue,
    claim_due_outbox_tasks,
    mark_outbox_task_publish_failed,
    mark_outbox_task_published,
)

SUPPORTED_OUTBOX_TASKS = frozenset(
    {
        HEALTH_NOOP_TASK,
    }
)
DEFAULT_RELAY_BATCH_SIZE = 50
DEFAULT_RELAY_LEASE_SECONDS = 60.0
DEFAULT_RELAY_RETRY_DELAY_SECONDS = 30.0
DEFAULT_RELAY_MAX_ATTEMPTS = 5


@dataclass(frozen=True)
class RelayMessage:
    outbox_id: UUID
    task_name: str
    queue: str
    celery_task_id: str
    args: tuple[object, ...]
    kwargs: dict[str, object]
    publish_claim_id: UUID


class TaskPublisher(Protocol):
    def publish(self, message: RelayMessage) -> None: ...


@dataclass(frozen=True)
class CeleryTaskPublisher:
    app: Celery = celery_app

    def publish(self, message: RelayMessage) -> None:
        self.app.send_task(
            message.task_name,
            args=message.args,
            kwargs=message.kwargs,
            task_id=message.celery_task_id,
            queue=message.queue,
        )


@dataclass(frozen=True)
class RelayOnceResult:
    claimed: int
    published: int
    failed: int


async def relay_once(
    *,
    session_factory: async_sessionmaker[AsyncSession],
    publisher: TaskPublisher,
    worker_id: str = "background-relay",
    batch_size: int = DEFAULT_RELAY_BATCH_SIZE,
    lease_seconds: float = DEFAULT_RELAY_LEASE_SECONDS,
    retry_delay_seconds: float = DEFAULT_RELAY_RETRY_DELAY_SECONDS,
    max_attempts: int = DEFAULT_RELAY_MAX_ATTEMPTS,
) -> RelayOnceResult:
    async with session_factory() as db, db.begin():
        claimed = await claim_due_outbox_tasks(
            db,
            worker_id=worker_id,
            limit=batch_size,
            lease_seconds=lease_seconds,
        )

    published = 0
    failed = 0
    for task in claimed:
        if task.task_name not in SUPPORTED_OUTBOX_TASKS:
            if await _mark_failed(
                session_factory,
                task,
                error_code="unsupported_task",
                error_message=f"Outbox task {task.task_name} is not enabled for relay.",
                retry_delay_seconds=0,
                max_attempts=0,
            ):
                failed += 1
            continue

        message = _relay_message(task)
        try:
            publisher.publish(message)
        except Exception as exc:
            if await _mark_failed(
                session_factory,
                task,
                error_code=exc.__class__.__name__,
                error_message=str(exc),
                retry_delay_seconds=retry_delay_seconds,
                max_attempts=max_attempts,
            ):
                failed += 1
            continue

        if await _mark_published(session_factory, message):
            published += 1

    return RelayOnceResult(claimed=len(claimed), published=published, failed=failed)


def _relay_message(task: BackgroundOutboxTaskValue) -> RelayMessage:
    if task.publish_claim_id is None:
        raise RuntimeError("Outbox task was claimed without publish_claim_id.")
    return RelayMessage(
        outbox_id=task.id,
        task_name=task.task_name,
        queue=task.queue,
        celery_task_id=task.celery_task_id,
        args=task.args_json,
        kwargs=task.kwargs_json,
        publish_claim_id=task.publish_claim_id,
    )


async def _mark_published(
    session_factory: async_sessionmaker[AsyncSession],
    message: RelayMessage,
) -> bool:
    async with session_factory() as db, db.begin():
        return await mark_outbox_task_published(
            db,
            outbox_id=message.outbox_id,
            publish_claim_id=message.publish_claim_id,
            published_task_id=message.celery_task_id,
        )


async def _mark_failed(
    session_factory: async_sessionmaker[AsyncSession],
    task: BackgroundOutboxTaskValue,
    *,
    error_code: str,
    error_message: str,
    retry_delay_seconds: float,
    max_attempts: int,
) -> bool:
    if task.publish_claim_id is None:
        return False
    async with session_factory() as db, db.begin():
        return await mark_outbox_task_publish_failed(
            db,
            outbox_id=task.id,
            publish_claim_id=task.publish_claim_id,
            error_code=error_code,
            error_message=error_message,
            retry_delay_seconds=retry_delay_seconds,
            max_attempts=max_attempts,
        )
