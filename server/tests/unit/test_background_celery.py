from __future__ import annotations

from pathlib import Path

from celery import Celery
from kombu import Queue

from proliferate.background.config import (
    BACKGROUND_RELAY_TASK,
    CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
    DEFAULT_QUEUE,
    HEALTH_NOOP_TASK,
    NOTIFICATIONS_QUEUE,
    NOTIFICATIONS_SEND_SLACK_TASK,
    PERIODIC_DEFAULT_QUEUE,
    build_celery_config,
    enabled_worker_queues,
)
from proliferate.background.beat_schedule import RELAY_SCHEDULE_ENTRY, build_beat_schedule
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
    assert HEALTH_NOOP_TASK in celery_app.tasks
    assert BACKGROUND_RELAY_TASK in celery_app.tasks
    assert NOTIFICATIONS_SEND_SLACK_TASK in celery_app.tasks
    assert celery_app.tasks[HEALTH_NOOP_TASK].run() == "ok"


def test_celery_routes_and_queues_match_ratified_names() -> None:
    from proliferate.background.celery_app import celery_app

    queue_names = {queue.name for queue in celery_app.conf.task_queues}
    assert queue_names == {
        PERIODIC_DEFAULT_QUEUE,
        DEFAULT_QUEUE,
        NOTIFICATIONS_QUEUE,
    }
    assert celery_app.conf.task_routes == {
        HEALTH_NOOP_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
        BACKGROUND_RELAY_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
        NOTIFICATIONS_SEND_SLACK_TASK: {"queue": NOTIFICATIONS_QUEUE},
        CUSTOMERIO_ENGAGEMENT_SYNC_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
    }
    assert (
        celery_app.amqp.router.route({}, HEALTH_NOOP_TASK, args=(), kwargs={})["queue"].name
        == PERIODIC_DEFAULT_QUEUE
    )
    assert celery_app.conf.beat_scheduler == "redbeat.RedBeatScheduler"
    assert celery_app.conf.result_backend is None


def test_beat_schedule_has_exactly_one_relay_entry_by_default() -> None:
    schedule = build_beat_schedule(_test_settings())

    assert set(schedule) == {RELAY_SCHEDULE_ENTRY}
    relay_entries = [
        name for name, entry in schedule.items() if entry["task"] == BACKGROUND_RELAY_TASK
    ]
    assert relay_entries == [RELAY_SCHEDULE_ENTRY]
    assert schedule[RELAY_SCHEDULE_ENTRY]["schedule"] == 1.0


def test_beat_schedule_keeps_single_relay_entry_with_customerio_enabled() -> None:
    schedule = build_beat_schedule(
        _test_settings(customerio_site_id="site", customerio_api_key="key")
    )

    relay_entries = [
        name for name, entry in schedule.items() if entry["task"] == BACKGROUND_RELAY_TASK
    ]
    assert relay_entries == [RELAY_SCHEDULE_ENTRY]
    assert "customerio-engagement-sync" in schedule


def test_celery_config_reads_settings_without_result_backend() -> None:
    config = _test_settings(
        celery_broker_url="amqp://worker:secret@rabbitmq:5672/proliferate",
        celery_worker_queues="default, notifications",
        redbeat_redis_url="redis://redis:6379/3",
        celery_task_always_eager=True,
    )

    celery_config = build_celery_config(config)
    queues = celery_config["task_queues"]

    assert celery_config["broker_url"] == "amqp://worker:secret@rabbitmq:5672/proliferate"
    assert celery_config["redbeat_redis_url"] == "redis://redis:6379/3"
    assert celery_config["result_backend"] is None
    assert celery_config["task_always_eager"] is True
    assert enabled_worker_queues(config) == ("default", "notifications")
    assert isinstance(queues, tuple)
    assert all(isinstance(queue, Queue) for queue in queues)
    assert {queue.name for queue in queues} == {"default", "notifications"}


def test_celery_config_enables_publisher_confirms_with_bounded_timeout() -> None:
    # Regression for BG4-PUBLISH-CONFIRM-01: without publisher confirms a bare
    # socket write looks like durable broker acceptance and the outbox row is
    # marked published even if RabbitMQ never accepted the message. The broker
    # transport options MUST enable confirm mode with a positive, bounded confirm
    # timeout so a nack/timeout/ambiguity raises instead of silently returning.
    options = build_celery_config(_test_settings())["broker_transport_options"]
    assert isinstance(options, dict)
    assert options["confirm_publish"] is True
    confirm_timeout = options["confirm_timeout"]
    assert isinstance(confirm_timeout, (int, float))
    assert 0 < confirm_timeout < float("inf")


def test_celery_config_confirm_timeout_is_settings_configurable() -> None:
    options = build_celery_config(_test_settings(celery_broker_confirm_timeout_seconds=3.5))[
        "broker_transport_options"
    ]
    assert options["confirm_timeout"] == 3.5


def test_celery_config_rejects_nonpositive_confirm_timeout() -> None:
    try:
        build_celery_config(_test_settings(celery_broker_confirm_timeout_seconds=0))
    except ValueError as exc:
        assert "confirm_timeout" in str(exc)
    else:
        raise AssertionError("expected a nonpositive confirm timeout to be rejected")


def test_celery_config_rejects_redis_broker() -> None:
    config = _test_settings(celery_broker_url="redis://127.0.0.1:6379/0")

    try:
        build_celery_config(config)
    except ValueError as exc:
        assert "AMQP RabbitMQ URL" in str(exc)
    else:
        raise AssertionError("expected Redis broker URL to be rejected")


def test_background_package_imports_no_workflow_domain() -> None:
    # This infrastructure slice must not couple to the Workflow domain: no
    # Workflow task names or business modules may be imported from the background
    # package. Guards against accidental scope creep the frozen spec forbids.
    background_dir = Path(__file__).resolve().parents[2] / "proliferate" / "background"
    offenders: list[str] = []
    for source in background_dir.rglob("*.py"):
        for line in source.read_text().splitlines():
            stripped = line.strip()
            if not (stripped.startswith("import ") or stripped.startswith("from ")):
                continue
            if "workflow" in stripped.lower():
                offenders.append(f"{source.name}: {stripped}")
    assert offenders == []


def test_celery_queue_selector_rejects_unknown_queue() -> None:
    config = _test_settings(celery_worker_queues="default,unknown")

    try:
        enabled_worker_queues(config)
    except ValueError as exc:
        assert "unknown" in str(exc)
    else:
        raise AssertionError("expected unknown queue to be rejected")


def test_task_metric_payload_is_safe_and_low_cardinality() -> None:
    # The worker-side outcome telemetry must carry only a safe task name and
    # error code (exception class name), never the raw exception text or payload.
    from proliferate.background.task_metrics import build_task_metric

    success = build_task_metric("success", task_name=HEALTH_NOOP_TASK)["background_task"]
    assert success == {
        "outcome": "success",
        "task_name": HEALTH_NOOP_TASK,
        "error_code": "none",
        "count": 1,
    }

    # The safe error code is the exception class name; the raw message (which may
    # carry a broker URL, credentials, or payload) never appears.
    boom = RuntimeError("amqps://user:secret@broker:5671 refused")
    failure = build_task_metric(
        "failure", task_name=HEALTH_NOOP_TASK, error_code=type(boom).__name__
    )["background_task"]
    assert failure["error_code"] == "RuntimeError"
    serialized = str(failure)
    assert "secret" not in serialized
    assert "amqps://" not in serialized


def test_task_metrics_handlers_are_connected() -> None:
    # Importing celery_app must connect the success/retry/failure signal
    # handlers so the worker emits outcome telemetry in production.
    import proliferate.background.celery_app  # noqa: F401
    from celery.signals import task_failure, task_retry, task_success

    class _Sender:
        name = HEALTH_NOOP_TASK

    # A connected receiver returns a (receiver, response) pair when the signal
    # fires; an unconnected signal returns an empty list.
    assert task_success.send(sender=_Sender())
    assert task_retry.send(sender=_Sender(), reason=RuntimeError("x"))
    assert task_failure.send(sender=_Sender(), exception=RuntimeError("x"))
