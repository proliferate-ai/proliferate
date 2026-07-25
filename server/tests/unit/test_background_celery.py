from __future__ import annotations

from celery import Celery
from kombu import Queue

from proliferate.background.config import (
    BILLING_RECONCILE_PASS_TASK,
    CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
    DEFAULT_QUEUE,
    HEALTH_NOOP_TASK,
    NOTIFICATIONS_QUEUE,
    NOTIFICATIONS_SEND_SLACK_TASK,
    PERIODIC_DEFAULT_QUEUE,
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
    assert HEALTH_NOOP_TASK in celery_app.tasks
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
        NOTIFICATIONS_SEND_SLACK_TASK: {"queue": NOTIFICATIONS_QUEUE},
        BILLING_RECONCILE_PASS_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
        CUSTOMERIO_ENGAGEMENT_SYNC_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
    }
    assert (
        celery_app.amqp.router.route({}, HEALTH_NOOP_TASK, args=(), kwargs={})["queue"].name
        == PERIODIC_DEFAULT_QUEUE
    )
    assert celery_app.conf.beat_scheduler == "redbeat.RedBeatScheduler"
    assert celery_app.conf.result_backend is None


def test_beat_schedule_empty_by_default() -> None:
    assert build_beat_schedule(_test_settings()) == {}


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
