"""Relay-surface ownership and telemetry tests.

These cover the single store-touching relay surface (``run_relay_tick``), the
bounded backlog/operational gauges, and the server store law that the thin Beat
task wrapper never imports a store. Split from ``test_background_outbox.py``
solely to satisfy the repo-shape 600-line source cap (``check_max_lines.py``).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.background.config import (
    DEFAULT_QUEUE,
    HEALTH_NOOP_TASK,
    PERIODIC_DEFAULT_QUEUE,
    WORKFLOW_CANCEL_TASK,
    WORKFLOW_DELIVER_TASK,
    WORKFLOW_OBSERVE_TASK,
)
from proliferate.background.relay import (
    SUPPORTED_OUTBOX_TASKS,
    RelayMessage,
    relay_once,
    run_relay_tick,
)
from proliferate.db.store.background_outbox import (
    OUTBOX_STATUS_PENDING,
    OUTBOX_STATUS_PUBLISHED,
    OUTBOX_STATUS_PUBLISHING,
    enqueue_outbox_task,
    get_outbox_backlog_snapshot,
    load_outbox_task,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def _session_factory(test_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(test_engine, expire_on_commit=False)


@pytest.mark.asyncio
async def test_backlog_snapshot_reports_supported_pending_by_family(
    db_session: AsyncSession,
) -> None:
    # Two pending health-noop rows plus one committed unsupported name. The
    # per-family breakdown reports only allowlisted families and never widens to
    # the unsupported task name, keeping the emitted metric low-cardinality.
    for index in range(2):
        await enqueue_outbox_task(
            db_session,
            task_name=HEALTH_NOOP_TASK,
            queue=PERIODIC_DEFAULT_QUEUE,
            idempotency_key=f"family:noop:{index}",
        )
    await enqueue_outbox_task(
        db_session,
        task_name="background.not.enabled",
        queue=DEFAULT_QUEUE,
        idempotency_key="family:unsupported",
    )
    await db_session.commit()

    snapshot = await get_outbox_backlog_snapshot(
        db_session,
        supported_task_names=SUPPORTED_OUTBOX_TASKS,
    )
    assert snapshot.supported_pending_by_family == {
        HEALTH_NOOP_TASK: 2,
        WORKFLOW_DELIVER_TASK: 0,
        WORKFLOW_OBSERVE_TASK: 0,
        WORKFLOW_CANCEL_TASK: 0,
    }
    assert snapshot.supported_oldest_pending_age_by_family[HEALTH_NOOP_TASK] >= 0
    assert snapshot.supported_oldest_pending_age_by_family[WORKFLOW_DELIVER_TASK] == 0
    assert "background.not.enabled" not in snapshot.supported_pending_by_family


@pytest.mark.asyncio
async def test_run_relay_tick_publishes_and_snapshots(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # run_relay_tick is the single relay-owned surface the thin task calls: it
    # drains a batch and reads bounded snapshots, returning already-safe fields.
    # The publisher is stubbed here (no broker) but the store path is real.
    from proliferate.background import relay as relay_module

    published: list[str] = []
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

    tick = await run_relay_tick(session_factory=_session_factory(test_engine))

    assert published == [str(task.id)]
    assert tick.claimed == 1
    assert tick.published == 1
    assert tick.failed == 0
    assert tick.supported_pending_by_family == {
        HEALTH_NOOP_TASK: 0,
        WORKFLOW_DELIVER_TASK: 0,
        WORKFLOW_OBSERVE_TASK: 0,
        WORKFLOW_CANCEL_TASK: 0,
    }
    assert tick.supported_oldest_pending_age_by_family == {
        HEALTH_NOOP_TASK: 0.0,
        WORKFLOW_DELIVER_TASK: 0.0,
        WORKFLOW_OBSERVE_TASK: 0.0,
        WORKFLOW_CANCEL_TASK: 0.0,
    }
    assert tick.managed_workflows.queued_or_delivering_count == 0


def test_task_wrapper_never_imports_store() -> None:
    # Server store law: background/relay.py is the only background module that
    # touches a store; the thin task wrapper must not import db.store at all.
    source = (
        REPO_ROOT / "server" / "proliferate" / "background" / "tasks" / "relay.py"
    ).read_text()
    assert "db.store" not in source
    assert "background_outbox" not in source


def test_relay_publisher_stamps_broker_publish_timestamp() -> None:
    # OBS-01(c): the relay stamps the broker-publish wall-clock time as a Celery
    # header so the worker can emit a broker-residence age (the achievable
    # "Celery queue oldest task age" signal). Confirm the header is sent and
    # parses back to a finite epoch value.
    from proliferate.background import relay as relay_module
    from proliferate.background.config import BACKGROUND_PUBLISH_TS_HEADER
    from proliferate.background.task_metrics import parse_publish_timestamp

    captured: dict[str, object] = {}

    class _App:
        def send_task(self, name: str, **kwargs: object) -> None:
            captured.update(kwargs)

    publisher = relay_module.CeleryTaskPublisher(app=_App())
    message = relay_module.RelayMessage(
        outbox_id=__import__("uuid").uuid4(),
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
        celery_task_id="cid",
        args=(),
        kwargs={},
        publish_claim_id=__import__("uuid").uuid4(),
    )
    publisher.publish(message)

    headers = captured["headers"]
    assert isinstance(headers, dict)
    stamped = parse_publish_timestamp(headers[BACKGROUND_PUBLISH_TS_HEADER])
    assert stamped is not None and stamped > 0


def test_build_queue_age_metric_is_safe_and_bounded() -> None:
    from proliferate.background.task_metrics import (
        build_queue_age_metric,
        parse_publish_timestamp,
    )

    payload = build_queue_age_metric(HEALTH_NOOP_TASK, 12.3456)
    assert payload == {
        "background_queue_age": {
            "task_name": HEALTH_NOOP_TASK,
            "age_seconds": 12.346,
        }
    }
    # Negative clock skew clamps to zero rather than emitting a bogus negative age.
    assert (
        build_queue_age_metric(HEALTH_NOOP_TASK, -5.0)["background_queue_age"]["age_seconds"]
        == 0.0
    )
    # Malformed/absent stamps are ignored, never raise or emit a bogus age.
    assert parse_publish_timestamp(None) is None
    assert parse_publish_timestamp("not-a-float") is None
    assert parse_publish_timestamp("inf") is None
    assert parse_publish_timestamp("123.5") == 123.5


def test_task_prerun_emits_queue_age_from_header(monkeypatch: pytest.MonkeyPatch) -> None:
    # The worker task_prerun handler reads the stamped header off task.request and
    # emits a broker-residence age line. A task with no stamp emits nothing.
    import time as _time

    from proliferate.background import task_metrics
    from proliferate.background.config import BACKGROUND_PUBLISH_TS_HEADER

    emitted: list[str] = []
    monkeypatch.setattr(task_metrics._metrics_logger, "info", emitted.append)
    monkeypatch.setattr(_time, "time", lambda: 1000.0)

    class _Request:
        def __init__(self, headers: dict[str, str]) -> None:
            self._headers = headers

        def get(self, key: str) -> object:
            return self._headers.get(key)

    class _Task:
        name = HEALTH_NOOP_TASK

        def __init__(self, headers: dict[str, str]) -> None:
            self.request = _Request(headers)

    task_metrics._on_task_prerun(task=_Task({BACKGROUND_PUBLISH_TS_HEADER: "990.0"}))
    assert len(emitted) == 1
    payload = __import__("json").loads(emitted[0])
    assert payload["background_queue_age"]["task_name"] == HEALTH_NOOP_TASK
    assert payload["background_queue_age"]["age_seconds"] == 10.0

    emitted.clear()
    task_metrics._on_task_prerun(task=_Task({}))
    assert emitted == []


def test_celery_publisher_passes_bounded_confirm_timeout_to_send_task() -> None:
    # BG4-PUBLISH-CONFIRM-01: the publisher must publish under confirm semantics.
    # It threads the app's configured bounded confirm_timeout to send_task so an
    # unconfirmed publish (nack/timeout/ambiguity) raises instead of returning as
    # if durably accepted.
    from proliferate.background import relay as relay_module

    captured: dict[str, object] = {}

    class _Conf:
        broker_transport_options = {"confirm_publish": True, "confirm_timeout": 7.5}

    class _App:
        conf = _Conf()

        def send_task(self, name: str, **kwargs: object) -> None:
            captured.update(kwargs)

    publisher = relay_module.CeleryTaskPublisher(app=_App())
    publisher.publish(
        RelayMessage(
            outbox_id=__import__("uuid").uuid4(),
            task_name=HEALTH_NOOP_TASK,
            queue=PERIODIC_DEFAULT_QUEUE,
            celery_task_id="cid",
            args=(),
            kwargs={},
            publish_claim_id=__import__("uuid").uuid4(),
        )
    )
    assert captured["confirm_timeout"] == 7.5


@pytest.mark.asyncio
async def test_relay_confirm_nack_drives_row_to_retry_not_published(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
) -> None:
    # BG4-PUBLISH-CONFIRM-01: a broker NACK / confirm-timeout surfaces from the
    # publisher as the confirm-ambiguity exception. The relay must route it to the
    # retry path (row back to pending, due in the future) and NEVER mark it
    # published on an unconfirmed publish.
    from amqp.exceptions import MessageNacked

    class _NackingPublisher:
        def publish(self, message: RelayMessage) -> None:
            raise MessageNacked("broker refused to durably accept the publish")

    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()

    result = await relay_once(
        session_factory=_session_factory(test_engine),
        publisher=_NackingPublisher(),
        retry_jitter_seconds=0.0,
    )

    assert result.published == 0
    assert result.failed == 1
    db_session.expire_all()
    row = await load_outbox_task(db_session, task.id)
    assert row is not None
    # Retryable, not published: an unconfirmed publish must stay claimable.
    assert row.status == OUTBOX_STATUS_PENDING


@pytest.mark.asyncio
async def test_relay_confirmed_publish_with_failed_db_mark_stays_claimable(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # BG4-PUBLISH-CONFIRM-01 at-least-once contract: if the broker CONFIRMS the
    # publish but the subsequent DB mark_published write fails, the row must NOT
    # be lost — it stays in `publishing` with its lease, so a later tick reclaims
    # and re-publishes it (a duplicate is expected and acceptable).
    from proliferate.background import relay as relay_module

    published: list[str] = []

    class _ConfirmingPublisher:
        def publish(self, message: RelayMessage) -> None:
            published.append(message.celery_task_id)

    async def _boom(*_args: object, **_kwargs: object) -> bool:
        raise RuntimeError("db write failed after confirmed publish")

    monkeypatch.setattr(relay_module, "mark_outbox_task_published", _boom)

    task = await enqueue_outbox_task(
        db_session,
        task_name=HEALTH_NOOP_TASK,
        queue=PERIODIC_DEFAULT_QUEUE,
    )
    await db_session.commit()

    with pytest.raises(RuntimeError, match="db write failed"):
        await relay_once(
            session_factory=_session_factory(test_engine),
            publisher=_ConfirmingPublisher(),
        )

    # The publish was confirmed once; the row stays claimable (publishing lease),
    # so it is neither lost nor marked published on a failed DB write.
    assert published == [str(task.id)]
    db_session.expire_all()
    row = await load_outbox_task(db_session, task.id)
    assert row is not None
    assert row.status == OUTBOX_STATUS_PUBLISHING
    assert row.status != OUTBOX_STATUS_PUBLISHED
