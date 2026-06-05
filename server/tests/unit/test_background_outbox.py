from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.background.config import HEALTH_NOOP_TASK, PERIODIC_DEFAULT_QUEUE
from proliferate.background.relay import RelayMessage, relay_once
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.store.background_outbox import (
    OUTBOX_STATUS_FAILED,
    OUTBOX_STATUS_PENDING,
    OUTBOX_STATUS_PUBLISHED,
    claim_due_outbox_tasks,
    enqueue_outbox_task,
    load_outbox_task,
    mark_outbox_task_published,
)
from proliferate.utils.time import utcnow


@dataclass
class RecordingPublisher:
    messages: list[RelayMessage] = field(default_factory=list)

    def publish(self, message: RelayMessage) -> None:
        self.messages.append(message)


@dataclass
class FailingPublisher:
    message: str = "broker unavailable"

    def publish(self, message: RelayMessage) -> None:
        raise RuntimeError(self.message)


def _session_factory(test_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(test_engine, expire_on_commit=False)


async def _expire_publish_lease(db: AsyncSession, outbox_id) -> None:
    await db.execute(
        update(BackgroundOutboxTask)
        .where(BackgroundOutboxTask.id == outbox_id)
        .values(lock_expires_at=utcnow() - timedelta(seconds=1))
    )
    await db.commit()


async def _load_fresh_outbox_task(db: AsyncSession, outbox_id):
    db.expire_all()
    return await load_outbox_task(db, outbox_id)


@pytest.mark.asyncio
async def test_enqueue_outbox_task_is_idempotent_by_key(db_session: AsyncSession) -> None:
    first = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        idempotency_key="noop:one",
    )
    second = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        idempotency_key="noop:one",
    )

    assert second.id == first.id
    assert second.status == OUTBOX_STATUS_PENDING


@pytest.mark.asyncio
async def test_stale_publish_claim_cannot_mark_new_claim_published(
    db_session: AsyncSession,
) -> None:
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()

    first_claim = (
        await claim_due_outbox_tasks(
            db_session,
            worker_id="relay-one",
            limit=1,
            lease_seconds=1,
        )
    )[0]
    assert first_claim.publish_claim_id is not None
    await db_session.commit()
    await _expire_publish_lease(db_session, task.id)
    second_claim = (
        await claim_due_outbox_tasks(
            db_session,
            worker_id="relay-two",
            limit=1,
            lease_seconds=60,
        )
    )[0]
    assert second_claim.publish_claim_id is not None
    assert second_claim.publish_claim_id != first_claim.publish_claim_id

    stale_marked = await mark_outbox_task_published(
        db_session,
        outbox_id=task.id,
        publish_claim_id=first_claim.publish_claim_id,
        published_task_id=str(task.id),
    )
    current_marked = await mark_outbox_task_published(
        db_session,
        outbox_id=task.id,
        publish_claim_id=second_claim.publish_claim_id,
        published_task_id=str(task.id),
    )

    assert stale_marked is False
    assert current_marked is True
    published = await _load_fresh_outbox_task(db_session, task.id)
    assert published is not None
    assert published.status == OUTBOX_STATUS_PUBLISHED


@pytest.mark.asyncio
async def test_relay_once_publishes_noop_and_marks_published(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        args_json=("hello",),
        kwargs_json={"ok": True},
    )
    await db_session.commit()
    publisher = RecordingPublisher()

    result = await relay_once(
        session_factory=_session_factory(test_engine),
        publisher=publisher,
    )

    assert result.claimed == 1
    assert result.published == 1
    assert result.failed == 0
    assert [message.celery_task_id for message in publisher.messages] == [str(task.id)]
    assert publisher.messages[0].args == ("hello",)
    assert publisher.messages[0].kwargs == {"ok": True}
    published = await _load_fresh_outbox_task(db_session, task.id)
    assert published is not None
    assert published.status == OUTBOX_STATUS_PUBLISHED


@pytest.mark.asyncio
async def test_relay_recovers_crash_before_publish(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()
    claimed = await claim_due_outbox_tasks(
        db_session,
        worker_id="relay-crashed",
        limit=1,
        lease_seconds=1,
    )
    assert len(claimed) == 1
    await db_session.commit()
    publisher = RecordingPublisher()
    assert publisher.messages == []

    await _expire_publish_lease(db_session, task.id)
    result = await relay_once(
        session_factory=_session_factory(test_engine),
        publisher=publisher,
    )

    assert result.claimed == 1
    assert result.published == 1
    assert [message.celery_task_id for message in publisher.messages] == [str(task.id)]
    published = await _load_fresh_outbox_task(db_session, task.id)
    assert published is not None
    assert published.status == OUTBOX_STATUS_PUBLISHED


@pytest.mark.asyncio
async def test_relay_duplicates_after_publish_before_mark(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()
    claimed = (
        await claim_due_outbox_tasks(
            db_session,
            worker_id="relay-crashed-after-publish",
            limit=1,
            lease_seconds=1,
        )
    )[0]
    assert claimed.publish_claim_id is not None
    publisher = RecordingPublisher()
    publisher.publish(
        RelayMessage(
            outbox_id=claimed.id,
            task_name=claimed.task_name,
            queue=claimed.queue,
            celery_task_id=claimed.celery_task_id,
            args=claimed.args_json,
            kwargs=claimed.kwargs_json,
            publish_claim_id=claimed.publish_claim_id,
        )
    )
    await db_session.commit()

    await _expire_publish_lease(db_session, task.id)
    result = await relay_once(
        session_factory=_session_factory(test_engine),
        publisher=publisher,
    )

    assert result.claimed == 1
    assert result.published == 1
    assert [message.celery_task_id for message in publisher.messages] == [
        str(task.id),
        str(task.id),
    ]
    published = await _load_fresh_outbox_task(db_session, task.id)
    assert published is not None
    assert published.status == OUTBOX_STATUS_PUBLISHED


@pytest.mark.asyncio
async def test_relay_records_publish_failure_for_retry(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()

    result = await relay_once(
        session_factory=_session_factory(test_engine),
        publisher=FailingPublisher(),
        retry_delay_seconds=60,
        max_attempts=5,
    )

    failed = await _load_fresh_outbox_task(db_session, task.id)
    assert result.claimed == 1
    assert result.published == 0
    assert result.failed == 1
    assert failed is not None
    assert failed.status == OUTBOX_STATUS_PENDING
    db_session.expire_all()
    row = await db_session.scalar(
        select(BackgroundOutboxTask).where(BackgroundOutboxTask.id == task.id)
    )
    assert row is not None
    assert row.last_error_code == "RuntimeError"
    assert row.last_error_message == "broker unavailable"


@pytest.mark.asyncio
async def test_relay_rejects_non_whitelisted_task_without_publishing(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    task = await enqueue_outbox_task(
        db_session,
        task_name="runtime.wake_target",
        queue="runtime.wake",
    )
    await db_session.commit()
    publisher = RecordingPublisher()

    result = await relay_once(
        session_factory=_session_factory(test_engine),
        publisher=publisher,
    )

    rejected = await _load_fresh_outbox_task(db_session, task.id)
    assert result.claimed == 1
    assert result.published == 0
    assert result.failed == 1
    assert publisher.messages == []
    assert rejected is not None
    assert rejected.status == OUTBOX_STATUS_FAILED
