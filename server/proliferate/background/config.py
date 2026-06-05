"""Celery, queue, and redbeat configuration."""

from __future__ import annotations

from collections.abc import Sequence

from kombu import Exchange, Queue

from proliferate.config import Settings, settings

PERIODIC_DEFAULT_QUEUE = "periodic.default"
DEFAULT_QUEUE = "default"
NOTIFICATIONS_QUEUE = "notifications"
RUNTIME_WAKE_QUEUE = "runtime.wake"
AUTOMATIONS_EXECUTION_QUEUE = "automations.execution"
KNOWN_QUEUE_NAMES = (
    PERIODIC_DEFAULT_QUEUE,
    DEFAULT_QUEUE,
    NOTIFICATIONS_QUEUE,
    RUNTIME_WAKE_QUEUE,
    AUTOMATIONS_EXECUTION_QUEUE,
)

HEALTH_NOOP_TASK = "background.health.noop"
NOTIFICATIONS_SEND_SLACK_TASK = "notifications.send_slack"
RUNTIME_WAKE_TARGET_TASK = "runtime.wake_target"
AUTOMATIONS_EXECUTE_RUN_TASK = "automations.execute_run"
BILLING_RECONCILE_PASS_TASK = "billing.reconcile_pass"

TASK_ROUTES: dict[str, dict[str, str]] = {
    HEALTH_NOOP_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
    NOTIFICATIONS_SEND_SLACK_TASK: {"queue": NOTIFICATIONS_QUEUE},
    RUNTIME_WAKE_TARGET_TASK: {"queue": RUNTIME_WAKE_QUEUE},
    AUTOMATIONS_EXECUTE_RUN_TASK: {"queue": AUTOMATIONS_EXECUTION_QUEUE},
    BILLING_RECONCILE_PASS_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
}


def parse_queue_names(raw_queues: str) -> tuple[str, ...]:
    return tuple(queue.strip() for queue in raw_queues.split(",") if queue.strip())


def enabled_worker_queues(config: Settings = settings) -> tuple[str, ...]:
    queue_names = parse_queue_names(config.celery_worker_queues)
    unknown = sorted(set(queue_names) - set(KNOWN_QUEUE_NAMES))
    if unknown:
        raise ValueError(f"Unknown Celery worker queue(s): {', '.join(unknown)}")
    return queue_names


def validate_celery_urls(config: Settings) -> None:
    broker_url = config.celery_broker_url.lower()
    if not broker_url.startswith(("amqp://", "amqps://")):
        raise ValueError("celery_broker_url must be an AMQP RabbitMQ URL")
    redbeat_url = config.redbeat_redis_url.lower()
    if not redbeat_url.startswith(("redis://", "rediss://")):
        raise ValueError("redbeat_redis_url must be a Redis URL")


def build_task_queues(queue_names: Sequence[str]) -> tuple[Queue, ...]:
    return tuple(
        Queue(
            name,
            Exchange(name, type="direct", durable=True),
            routing_key=name,
            durable=True,
        )
        for name in queue_names
    )


def build_celery_config(config: Settings = settings) -> dict[str, object]:
    validate_celery_urls(config)
    queue_names = enabled_worker_queues(config)
    return {
        "broker_url": config.celery_broker_url,
        "result_backend": None,
        "task_default_queue": DEFAULT_QUEUE,
        "task_queues": build_task_queues(queue_names),
        "task_routes": TASK_ROUTES,
        "task_acks_late": True,
        "task_reject_on_worker_lost": True,
        "worker_prefetch_multiplier": 1,
        "task_always_eager": config.celery_task_always_eager,
        "task_time_limit": config.celery_task_time_limit_seconds,
        "task_soft_time_limit": config.celery_task_soft_time_limit_seconds,
        "broker_connection_retry_on_startup": True,
        "beat_scheduler": "redbeat.RedBeatScheduler",
        "redbeat_redis_url": config.redbeat_redis_url,
        "redbeat_key_prefix": config.redbeat_key_prefix,
        "timezone": "UTC",
        "enable_utc": True,
    }
