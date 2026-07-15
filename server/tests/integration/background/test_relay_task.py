"""End-to-end wiring test for the Beat-fired ``background.relay`` task.

The thin task builds its own engine from ``settings.database_url`` and drives one
``relay_once`` batch. Here that URL is pointed at the migrated test database and
the broker publish is stubbed, so the test exercises the real session-factory
construction, claim, publish, mark-published, and metrics emission path without
a live RabbitMQ.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background import relay as relay_module
from proliferate.background.config import HEALTH_NOOP_TASK, PERIODIC_DEFAULT_QUEUE
from proliferate.background.tasks.relay import relay
from proliferate.config import settings
from proliferate.db.store.background_outbox import (
    OUTBOX_STATUS_PUBLISHED,
    enqueue_outbox_task,
    load_outbox_task,
)
from tests.postgres import TEST_DATABASE_URL


@pytest.mark.asyncio
async def test_relay_task_publishes_committed_health_noop(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    published: list[str] = []
    monkeypatch.setattr(settings, "database_url", TEST_DATABASE_URL)
    monkeypatch.setattr(
        relay_module.CeleryTaskPublisher,
        "publish",
        lambda self, message: published.append(message.celery_task_id),
    )

    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()

    # The task calls ``asyncio.run`` internally, so run it off the test's loop.
    metrics = await asyncio.to_thread(relay)

    assert published == [str(task.id)]
    assert metrics["claimed"] == 1
    assert metrics["published"] == 1
    assert metrics["failed"] == 0
    assert "oldest_due_pending_age_seconds" in metrics
    # Scheduler-store/relay liveness heartbeat and the bounded per-family
    # backlog gauge are emitted every tick for the hosted metric plane.
    assert metrics["relay_heartbeat"] == 1
    assert metrics["supported_pending_by_family"] == {"background_health_noop": 0}

    db_session.expire_all()
    row = await load_outbox_task(db_session, task.id)
    assert row is not None
    assert row.status == OUTBOX_STATUS_PUBLISHED


@pytest.mark.asyncio
async def test_enqueue_health_module_commits_row(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The candidate-plane deploy proof enqueues a deterministic health no-op via
    # `python -m proliferate.background.enqueue_health`. Exercise its store path
    # against the migrated test DB: a committed pending health-noop row appears
    # under the deterministic idempotency key, and a replay returns the same row.
    from proliferate.background import enqueue_health

    monkeypatch.setattr(settings, "database_url", TEST_DATABASE_URL)

    outbox_id = await enqueue_health._enqueue("deploy-proof-key")
    replay_id = await enqueue_health._enqueue("deploy-proof-key")
    assert outbox_id == replay_id

    db_session.expire_all()
    from uuid import UUID

    row = await load_outbox_task(db_session, UUID(outbox_id))
    assert row is not None
    assert row.task_name == HEALTH_NOOP_TASK
    assert row.status.value == "pending"
