from __future__ import annotations

from uuid import UUID, uuid4

from celery import Celery
from kombu import Queue

from proliferate.background.config import (
    AUTOMATIONS_EXECUTE_RUN_TASK,
    AUTOMATIONS_EXECUTION_QUEUE,
    BILLING_RECONCILE_PASS_TASK,
    DEFAULT_QUEUE,
    HEALTH_NOOP_TASK,
    NOTIFICATIONS_QUEUE,
    NOTIFICATIONS_SEND_SLACK_TASK,
    PERIODIC_DEFAULT_QUEUE,
    RUNTIME_WAKE_QUEUE,
    RUNTIME_WAKE_TARGET_TASK,
    SUPPORT_TRACKER_RECONCILE_PASS_TASK,
    build_celery_config,
    enabled_worker_queues,
)
from proliferate.background.beat_schedule import build_beat_schedule
from proliferate.config import Settings


def _test_settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "_env_file": None,
        "debug": True,
        "jwt_secret": "test-secret",
        "cloud_secret_key": "test-cloud-secret",
    }
    defaults.update(overrides)
    return Settings(**defaults)


def test_celery_app_import_registers_noop_task_without_broker_connection() -> None:
    from proliferate.background.celery_app import celery_app

    assert isinstance(celery_app, Celery)
    assert AUTOMATIONS_EXECUTE_RUN_TASK in celery_app.tasks
    assert HEALTH_NOOP_TASK in celery_app.tasks
    assert NOTIFICATIONS_SEND_SLACK_TASK in celery_app.tasks
    assert RUNTIME_WAKE_TARGET_TASK in celery_app.tasks
    assert SUPPORT_TRACKER_RECONCILE_PASS_TASK in celery_app.tasks
    assert celery_app.tasks[HEALTH_NOOP_TASK].run() == "ok"


def test_automation_execute_task_dispatches_payload(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from proliferate.background.tasks import automations

    calls: list[UUID] = []
    run_id = uuid4()

    async def fake_execute_cloud_automation_run(parsed_run_id: UUID) -> bool:
        calls.append(parsed_run_id)
        return True

    monkeypatch.setattr(
        automations,
        "execute_cloud_automation_run",
        fake_execute_cloud_automation_run,
    )

    assert automations.execute_run.run(run_id=str(run_id)) is True
    assert calls == [run_id]


def test_runtime_wake_task_dispatches_payload(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from proliferate.background.tasks import runtime

    calls: list[tuple[UUID, UUID | None]] = []
    target_id = uuid4()
    command_id = uuid4()

    async def fake_run_managed_target_wake_job(
        target_id: UUID,
        *,
        command_id: UUID | None = None,
    ) -> None:
        calls.append((target_id, command_id))

    monkeypatch.setattr(
        runtime,
        "run_managed_target_wake_job",
        fake_run_managed_target_wake_job,
    )

    runtime.wake_target.run(target_id=str(target_id), command_id=str(command_id))

    assert calls == [(target_id, command_id)]


def test_support_tracker_task_dispatches_reconcile_pass(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from proliferate.background.tasks import support

    calls: list[str] = []

    async def fake_run_support_tracker_reconcile_pass() -> int:
        calls.append("reconcile")
        return 3

    monkeypatch.setattr(
        support,
        "run_support_tracker_reconcile_pass",
        fake_run_support_tracker_reconcile_pass,
    )

    assert support.reconcile_tracker.run() == 3
    assert calls == ["reconcile"]


def test_celery_routes_and_queues_match_ratified_names() -> None:
    from proliferate.background.celery_app import celery_app

    queue_names = {queue.name for queue in celery_app.conf.task_queues}
    assert queue_names == {
        PERIODIC_DEFAULT_QUEUE,
        DEFAULT_QUEUE,
        NOTIFICATIONS_QUEUE,
        RUNTIME_WAKE_QUEUE,
        AUTOMATIONS_EXECUTION_QUEUE,
    }
    assert celery_app.conf.task_routes == {
        HEALTH_NOOP_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
        NOTIFICATIONS_SEND_SLACK_TASK: {"queue": NOTIFICATIONS_QUEUE},
        RUNTIME_WAKE_TARGET_TASK: {"queue": RUNTIME_WAKE_QUEUE},
        AUTOMATIONS_EXECUTE_RUN_TASK: {"queue": AUTOMATIONS_EXECUTION_QUEUE},
        BILLING_RECONCILE_PASS_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
        SUPPORT_TRACKER_RECONCILE_PASS_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
    }
    assert (
        celery_app.amqp.router.route({}, HEALTH_NOOP_TASK, args=(), kwargs={})["queue"].name
        == PERIODIC_DEFAULT_QUEUE
    )
    assert celery_app.conf.beat_scheduler == "redbeat.RedBeatScheduler"
    assert celery_app.conf.result_backend is None


def test_beat_schedule_registers_enabled_support_tracker() -> None:
    schedule = build_beat_schedule(
        _test_settings(
            support_tracker_enabled=True,
            support_tracker_reconciler_interval_seconds=0.5,
        )
    )

    assert schedule == {
        "support-tracker-reconcile": {
            "task": SUPPORT_TRACKER_RECONCILE_PASS_TASK,
            "schedule": 1.0,
            "options": {"queue": PERIODIC_DEFAULT_QUEUE},
        }
    }


def test_beat_schedule_omits_disabled_support_tracker() -> None:
    assert build_beat_schedule(_test_settings(support_tracker_enabled=False)) == {}


def test_celery_config_reads_settings_without_result_backend() -> None:
    config = _test_settings(
        celery_broker_url="amqp://worker:secret@rabbitmq:5672/proliferate",
        celery_worker_queues="default, notifications ,runtime.wake",
        redbeat_redis_url="redis://redis:6379/3",
        celery_task_always_eager=True,
    )

    celery_config = build_celery_config(config)
    queues = celery_config["task_queues"]

    assert celery_config["broker_url"] == "amqp://worker:secret@rabbitmq:5672/proliferate"
    assert celery_config["redbeat_redis_url"] == "redis://redis:6379/3"
    assert celery_config["result_backend"] is None
    assert celery_config["task_always_eager"] is True
    assert enabled_worker_queues(config) == ("default", "notifications", "runtime.wake")
    assert isinstance(queues, tuple)
    assert all(isinstance(queue, Queue) for queue in queues)
    assert {queue.name for queue in queues} == {"default", "notifications", "runtime.wake"}


def test_celery_config_rejects_redis_broker() -> None:
    config = _test_settings(celery_broker_url="redis://127.0.0.1:6379/0")

    try:
        build_celery_config(config)
    except ValueError as exc:
        assert "AMQP RabbitMQ URL" in str(exc)
    else:
        raise AssertionError("expected Redis broker URL to be rejected")


def test_celery_queue_selector_rejects_unknown_queue() -> None:
    config = _test_settings(celery_worker_queues="default,unknown")

    try:
        enabled_worker_queues(config)
    except ValueError as exc:
        assert "unknown" in str(exc)
    else:
        raise AssertionError("expected unknown queue to be rejected")
