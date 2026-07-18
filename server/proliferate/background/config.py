"""Celery, queue, and redbeat configuration."""

from __future__ import annotations

from collections.abc import Sequence

from kombu import Exchange, Queue

from proliferate.config import Settings, settings

PERIODIC_DEFAULT_QUEUE = "periodic.default"
DEFAULT_QUEUE = "default"
NOTIFICATIONS_QUEUE = "notifications"
KNOWN_QUEUE_NAMES = (
    PERIODIC_DEFAULT_QUEUE,
    DEFAULT_QUEUE,
    NOTIFICATIONS_QUEUE,
)

HEALTH_NOOP_TASK = "background.health.noop"
BACKGROUND_RELAY_TASK = "background.relay"

# Celery message header the relay stamps with the broker-publish wall-clock time
# (epoch seconds). The worker reads it on task_prerun to emit a broker-residence
# LATENCY (consume time minus publish time): a lagging per-task signal observed
# only when a task is consumed, so it goes silent when consumption stalls and is
# NOT a current "oldest queued task age". Amazon MQ exposes no native
# oldest-message-age metric, so current backlog is covered by the broker
# MessageCount depth alarm instead. It is a plain timestamp, never a secret.
BACKGROUND_PUBLISH_TS_HEADER = "x_background_publish_ts"
NOTIFICATIONS_SEND_SLACK_TASK = "notifications.send_slack"
CUSTOMERIO_ENGAGEMENT_SYNC_TASK = "customerio.engagement_sync"
CLOUD_SANDBOX_ORPHAN_REAP_TASK = "cloud_sandboxes.orphan_reap"
WORKFLOW_DELIVER_TASK = "workflows.deliver"
WORKFLOW_OBSERVE_TASK = "workflows.observe"
WORKFLOW_CANCEL_TASK = "workflows.cancel"

TASK_ROUTES: dict[str, dict[str, str]] = {
    HEALTH_NOOP_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
    BACKGROUND_RELAY_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
    NOTIFICATIONS_SEND_SLACK_TASK: {"queue": NOTIFICATIONS_QUEUE},
    CUSTOMERIO_ENGAGEMENT_SYNC_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
    CLOUD_SANDBOX_ORPHAN_REAP_TASK: {"queue": PERIODIC_DEFAULT_QUEUE},
    WORKFLOW_DELIVER_TASK: {"queue": DEFAULT_QUEUE},
    WORKFLOW_OBSERVE_TASK: {"queue": DEFAULT_QUEUE},
    WORKFLOW_CANCEL_TASK: {"queue": DEFAULT_QUEUE},
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
    confirm_timeout = float(config.celery_broker_confirm_timeout_seconds)
    if confirm_timeout <= 0:
        raise ValueError("celery_broker_confirm_timeout_seconds must be positive")
    return {
        "broker_url": config.celery_broker_url,
        # Enable AMQP publisher confirms on the broker connection. py-amqp then
        # publishes via ``basic_publish_confirm``, which waits for a broker ack
        # and raises on a nack; the relay additionally passes ``confirm_timeout``
        # per publish so ack ambiguity raises instead of hanging. Without this a
        # bare socket write would look like durable acceptance and the outbox row
        # would be marked published even if RabbitMQ never accepted the message.
        # TLS/stack-agnostic: no environment-specific value is hardcoded here.
        "broker_transport_options": {
            "confirm_publish": True,
            "confirm_timeout": confirm_timeout,
        },
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
