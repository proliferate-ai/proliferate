from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.background.config import (
    DEFAULT_QUEUE,
    HEALTH_NOOP_TASK,
    PERIODIC_DEFAULT_QUEUE,
)
from proliferate.background.relay import (
    PUBLISH_FAILED_ERROR_MESSAGE,
    RelayMessage,
    relay_once,
)
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.store.background_outbox import (
    OUTBOX_STATUS_FAILED,
    OUTBOX_STATUS_PENDING,
    OUTBOX_STATUS_PUBLISHED,
    claim_due_outbox_tasks,
    enqueue_outbox_task,
    get_outbox_backlog_snapshot,
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
    # The claim reclaimed an expired publishing lease, so it is counted as a
    # recovery for lease-expiry telemetry.
    assert result.recovered == 1
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
        retry_jitter_seconds=0.0,
    )

    failed = await _load_fresh_outbox_task(db_session, task.id)
    assert result.claimed == 1
    assert result.published == 0
    assert result.failed == 1
    assert failed is not None
    # Supported task -> retryable, never terminal, due time pushed into the future.
    assert failed.status == OUTBOX_STATUS_PENDING
    assert failed.available_at > utcnow()
    db_session.expire_all()
    row = await db_session.scalar(
        select(BackgroundOutboxTask).where(BackgroundOutboxTask.id == task.id)
    )
    assert row is not None
    # Stable safe code carries the exception class; the stored message is a fixed
    # generic phrase and never the raw broker error string.
    assert row.last_error_code == "publish_failed:RuntimeError"
    assert row.last_error_message == PUBLISH_FAILED_ERROR_MESSAGE
    assert "broker unavailable" not in (row.last_error_message or "")


@pytest.mark.asyncio
async def test_relay_publish_error_is_secret_safe(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    secret_url = "amqp://user:sup3rsecret@broker.internal:5672/vhost"
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()

    result = await relay_once(
        session_factory=_session_factory(test_engine),
        publisher=FailingPublisher(message=f"connection refused for {secret_url}"),
        retry_jitter_seconds=0.0,
    )

    assert result.failed == 1
    db_session.expire_all()
    row = await db_session.scalar(
        select(BackgroundOutboxTask).where(BackgroundOutboxTask.id == task.id)
    )
    assert row is not None
    stored = f"{row.last_error_code} {row.last_error_message}"
    assert secret_url not in stored
    assert "sup3rsecret" not in stored
    assert "amqp://" not in stored


@pytest.mark.asyncio
async def test_relay_supported_task_retries_beyond_five_attempts(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()
    factory = _session_factory(test_engine)

    # Drive far past the old five-attempt ceiling; a supported task must never
    # go terminal on broker failure.
    for _ in range(8):
        await relay_once(
            session_factory=factory,
            publisher=FailingPublisher(),
            retry_jitter_seconds=0.0,
        )
        # Force the row due again so the next tick reclaims it.
        await db_session.execute(
            update(BackgroundOutboxTask)
            .where(BackgroundOutboxTask.id == task.id)
            .values(available_at=utcnow() - timedelta(seconds=1))
        )
        await db_session.commit()

    row = await db_session.scalar(
        select(BackgroundOutboxTask).where(BackgroundOutboxTask.id == task.id)
    )
    assert row is not None
    assert row.attempt_count >= 8
    assert row.status == OUTBOX_STATUS_PENDING


@pytest.mark.asyncio
async def test_relay_backoff_is_capped_and_deterministic() -> None:
    from proliferate.background.relay import compute_retry_delay_seconds

    # Deterministic exponential with zero jitter: base * 2**(attempt-1).
    no_jitter = {"jitter_seconds": 0.0, "base_seconds": 2.0, "cap_seconds": 300.0}
    assert compute_retry_delay_seconds(1, **no_jitter) == 2.0
    assert compute_retry_delay_seconds(2, **no_jitter) == 4.0
    assert compute_retry_delay_seconds(4, **no_jitter) == 16.0
    # Saturates at the cap and never overflows for huge attempt counts.
    assert compute_retry_delay_seconds(100, **no_jitter) == 300.0
    # Bounded jitter stays within [delay, delay + jitter).
    delay = compute_retry_delay_seconds(
        1, base_seconds=2.0, cap_seconds=300.0, jitter_seconds=5.0, rng=lambda: 0.5
    )
    assert delay == 2.0 + 5.0 * 0.5


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_relay_rejects_unknown_task_without_publishing(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    task = await enqueue_outbox_task(
        db_session,
        task_name="runtime.unknown",
        queue=DEFAULT_QUEUE,
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
    db_session.expire_all()
    row = await db_session.scalar(
        select(BackgroundOutboxTask).where(BackgroundOutboxTask.id == task.id)
    )
    assert row is not None
    assert row.last_error_code == "unsupported_task"


@pytest.mark.asyncio
async def test_enqueue_defaults_available_at_to_now(db_session: AsyncSession) -> None:
    before = utcnow()
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    after = utcnow()

    assert task.available_at.tzinfo is not None
    assert before <= task.available_at <= after


@pytest.mark.asyncio
async def test_enqueue_persists_future_available_at_unchanged(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    future = utcnow() + timedelta(hours=2)
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        available_at=future,
    )
    await db_session.commit()

    assert task.available_at == future

    # A future row is not yet due, so a relay tick claims nothing.
    publisher = RecordingPublisher()
    result = await relay_once(
        session_factory=_session_factory(test_engine),
        publisher=publisher,
    )
    assert result.claimed == 0
    assert publisher.messages == []
    still_pending = await _load_fresh_outbox_task(db_session, task.id)
    assert still_pending is not None
    assert still_pending.status == OUTBOX_STATUS_PENDING


@pytest.mark.asyncio
async def test_enqueue_normalizes_naive_available_at_to_utc(
    db_session: AsyncSession,
) -> None:
    naive = datetime(2030, 1, 1, 12, 0, 0)
    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        available_at=naive,
    )

    assert task.available_at == naive.replace(tzinfo=UTC)


@pytest.mark.asyncio
async def test_idempotency_replay_does_not_move_due_time(
    db_session: AsyncSession,
) -> None:
    original_due = utcnow() + timedelta(hours=1)
    first = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        idempotency_key="due:once",
        available_at=original_due,
    )
    # A replay with a different (earlier) due time must return the original row
    # and leave its scheduled due time untouched.
    second = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        idempotency_key="due:once",
        available_at=utcnow(),
    )

    assert second.id == first.id
    assert second.available_at == original_due


@pytest.mark.asyncio
async def test_concurrent_relays_skip_locked_claim_each_row_once(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    for index in range(6):
        await enqueue_outbox_task(
            db_session,
            task_name=HEALTH_NOOP_TASK,
            queue=PERIODIC_DEFAULT_QUEUE,
            idempotency_key=f"concurrent:{index}",
        )
    await db_session.commit()
    factory = _session_factory(test_engine)

    async def _claim() -> tuple[str, ...]:
        async with factory() as db, db.begin():
            claimed = await claim_due_outbox_tasks(
                db,
                worker_id="concurrent",
                limit=6,
                lease_seconds=60,
            )
            return tuple(str(task.id) for task in claimed)

    # Two relays racing on the same due set must partition the rows: SKIP LOCKED
    # means no id is claimed twice and every id is claimed exactly once.
    first, second = await asyncio.gather(_claim(), _claim())
    claimed_ids = list(first) + list(second)
    assert sorted(claimed_ids) == sorted(set(claimed_ids))
    assert len(claimed_ids) == 6


@pytest.mark.asyncio
async def test_backlog_snapshot_reports_oldest_due_age(
    db_session: AsyncSession,
) -> None:
    stale = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        available_at=utcnow() - timedelta(seconds=120),
    )
    await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        available_at=utcnow() + timedelta(hours=1),
    )
    await db_session.commit()

    snapshot = await get_outbox_backlog_snapshot(db_session)
    assert snapshot.due_pending_count == 1
    assert snapshot.oldest_due_pending_age_seconds >= 100
    assert stale.available_at < utcnow()
