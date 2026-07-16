"""Outbox-to-Celery relay for broker-delivered background work."""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from celery import Celery
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.celery_app import celery_app
from proliferate.background.config import (
    BACKGROUND_PUBLISH_TS_HEADER,
    HEALTH_NOOP_TASK,
    WORKFLOW_CANCEL_TASK,
    WORKFLOW_DELIVER_TASK,
    WORKFLOW_OBSERVE_TASK,
)
from proliferate.db.store.background_outbox import (
    BackgroundOutboxTaskValue,
    claim_due_outbox_tasks,
    get_outbox_backlog_snapshot,
    mark_outbox_task_publish_failed,
    mark_outbox_task_published,
)
from proliferate.db.store.workflow_managed_observability import (
    ManagedWorkflowTelemetrySnapshot,
    get_managed_workflow_telemetry_snapshot,
)

# Task names the relay is allowed to publish. A committed row for any other name
# is parked terminally (``failed`` / ``unsupported_task``) and never published,
# so an unknown or retired task cannot loop forever against a worker that would
# reject it. Add a name here only once a worker can import and run it. The relay
# task itself (``background.relay``) is Beat-scheduled directly and is never
# enqueued through the outbox, so it is intentionally absent.
SUPPORTED_OUTBOX_TASKS = frozenset(
    {
        HEALTH_NOOP_TASK,
        WORKFLOW_DELIVER_TASK,
        WORKFLOW_OBSERVE_TASK,
        WORKFLOW_CANCEL_TASK,
    }
)
DEFAULT_RELAY_BATCH_SIZE = 50
DEFAULT_RELAY_LEASE_SECONDS = 60.0
# Capped exponential backoff for supported broker failures. There is no attempt
# ceiling: a correctness-sensitive committed task retries indefinitely until the
# broker recovers. Delay is deterministic from the attempt count plus bounded
# jitter to avoid a synchronized retry stampede across relay ticks.
DEFAULT_RELAY_RETRY_BASE_SECONDS = 2.0
DEFAULT_RELAY_RETRY_CAP_SECONDS = 300.0
DEFAULT_RELAY_RETRY_JITTER_SECONDS = 5.0

UNSUPPORTED_TASK_ERROR_CODE = "unsupported_task"
UNSUPPORTED_TASK_ERROR_MESSAGE = "Outbox task name is not enabled for relay."
PUBLISH_FAILED_ERROR_CODE = "publish_failed"
# Deliberately generic and secret-free: the raw exception string may embed the
# broker URL, credentials, or payload, so it is never persisted. The stable
# class name is kept separately as the safe code.
PUBLISH_FAILED_ERROR_MESSAGE = "Broker publish failed; will retry."


def compute_retry_delay_seconds(
    attempt: int,
    *,
    base_seconds: float = DEFAULT_RELAY_RETRY_BASE_SECONDS,
    cap_seconds: float = DEFAULT_RELAY_RETRY_CAP_SECONDS,
    jitter_seconds: float = DEFAULT_RELAY_RETRY_JITTER_SECONDS,
    rng: Callable[[], float] = random.random,
) -> float:
    """Capped exponential backoff with bounded additive jitter.

    ``attempt`` is the 1-based attempt count already recorded by the claim. The
    exponential term is ``base * 2**(attempt - 1)`` clamped to ``cap``; jitter
    adds ``[0, jitter_seconds)``. No ceiling is applied to the attempt count, so
    the delay simply saturates at ``cap`` and the task keeps retrying.
    """

    safe_attempt = max(1, attempt)
    # Clamp the exponent before the shift so a very high attempt count cannot
    # overflow into an enormous float; the value is capped immediately after.
    exponent = min(safe_attempt - 1, 32)
    exponential = base_seconds * float(2**exponent)
    capped = min(exponential, cap_seconds)
    return capped + jitter_seconds * rng()


def classify_publish_error(exc: BaseException) -> tuple[str, str]:
    """Map a publish exception to a stable safe code and bounded safe message.

    The code is the exception class name (stable, low-cardinality, and free of
    secrets). The message is a fixed generic phrase. Neither includes the raw
    exception text, broker URL, credentials, or task payload.
    """

    code = f"{PUBLISH_FAILED_ERROR_CODE}:{type(exc).__name__}"
    return code[:128], PUBLISH_FAILED_ERROR_MESSAGE


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
        # Stamp the broker-publish wall-clock time as a Celery header so the
        # worker can emit a broker-residence LATENCY on consume (a lagging
        # per-task signal, not a current oldest-queued-age gauge). A plain
        # timestamp, no secret.
        #
        # The broker connection runs with publisher confirms enabled
        # (``confirm_publish`` in ``broker_transport_options``), so this publish
        # goes through py-amqp's ``basic_publish_confirm``: it waits for the
        # broker to durably ack the message and raises ``MessageNacked`` on a
        # nack. Passing ``confirm_timeout`` bounds that wait, so a stuck confirm
        # (ack ambiguity) raises rather than returning as if durably accepted.
        # An unconfirmed publish therefore ALWAYS raises here, and ``relay_once``
        # routes the exception to the retry path instead of marking the row
        # published on a bare socket write.
        self.app.send_task(
            message.task_name,
            args=message.args,
            kwargs=message.kwargs,
            task_id=message.celery_task_id,
            queue=message.queue,
            headers={BACKGROUND_PUBLISH_TS_HEADER: repr(time.time())},
            confirm_timeout=self._confirm_timeout(),
        )

    def _confirm_timeout(self) -> float | None:
        # Single-source the bounded confirm timeout from the app's configured
        # broker transport options so the publish wait matches the connection's
        # confirm mode. Absent/misconfigured falls back to ``None`` (the
        # connection-level default) rather than failing the publish outright.
        conf = getattr(self.app, "conf", None)
        options = getattr(conf, "broker_transport_options", None) or {}
        timeout = options.get("confirm_timeout")
        if isinstance(timeout, (int, float)) and timeout > 0:
            return float(timeout)
        return None


@dataclass(frozen=True)
class RelayOnceResult:
    claimed: int
    published: int
    failed: int
    recovered: int = 0


@dataclass(frozen=True)
class RelayTickResult:
    """Everything a Beat tick needs to emit as safe metrics.

    ``relay`` (the store law's only relay module) owns the store interaction:
    it drains one bounded batch and reads the backlog snapshot behind this one
    surface. The task wrapper stays thin — it constructs the boundary, invokes
    ``run_relay_tick``, and emits these already-safe fields.
    """

    claimed: int
    published: int
    failed: int
    recovered: int
    due_pending: int
    publishing: int
    expired_publishing: int
    failed_rows: int
    oldest_due_pending_age_seconds: float
    supported_pending_by_family: dict[str, int]
    supported_oldest_pending_age_by_family: dict[str, float]
    managed_workflows: ManagedWorkflowTelemetrySnapshot


async def run_relay_tick(
    *,
    session_factory: async_sessionmaker[AsyncSession],
    batch_size: int = DEFAULT_RELAY_BATCH_SIZE,
    lease_seconds: float = DEFAULT_RELAY_LEASE_SECONDS,
    retry_base_seconds: float = DEFAULT_RELAY_RETRY_BASE_SECONDS,
    retry_cap_seconds: float = DEFAULT_RELAY_RETRY_CAP_SECONDS,
    retry_jitter_seconds: float = DEFAULT_RELAY_RETRY_JITTER_SECONDS,
) -> RelayTickResult:
    """Drain one bounded batch and read the backlog snapshot in one surface.

    This is the single store-touching entry point the Beat task calls. It keeps
    ``background/relay.py`` the only background module that reaches a store
    (server layer law); the thin task wrapper never imports ``db.store``.
    """

    result = await relay_once(
        session_factory=session_factory,
        publisher=CeleryTaskPublisher(),
        batch_size=batch_size,
        lease_seconds=lease_seconds,
        retry_base_seconds=retry_base_seconds,
        retry_cap_seconds=retry_cap_seconds,
        retry_jitter_seconds=retry_jitter_seconds,
    )
    async with session_factory() as db:
        snapshot = await get_outbox_backlog_snapshot(
            db,
            supported_task_names=SUPPORTED_OUTBOX_TASKS,
        )
        managed_workflows = await get_managed_workflow_telemetry_snapshot(db)
    return RelayTickResult(
        claimed=result.claimed,
        published=result.published,
        failed=result.failed,
        recovered=result.recovered,
        due_pending=snapshot.due_pending_count,
        publishing=snapshot.publishing_count,
        expired_publishing=snapshot.expired_publishing_count,
        failed_rows=snapshot.failed_count,
        oldest_due_pending_age_seconds=snapshot.oldest_due_pending_age_seconds,
        supported_pending_by_family=dict(snapshot.supported_pending_by_family),
        supported_oldest_pending_age_by_family=dict(
            snapshot.supported_oldest_pending_age_by_family
        ),
        managed_workflows=managed_workflows,
    )


async def relay_once(
    *,
    session_factory: async_sessionmaker[AsyncSession],
    publisher: TaskPublisher,
    worker_id: str = "background-relay",
    batch_size: int = DEFAULT_RELAY_BATCH_SIZE,
    lease_seconds: float = DEFAULT_RELAY_LEASE_SECONDS,
    retry_base_seconds: float = DEFAULT_RELAY_RETRY_BASE_SECONDS,
    retry_cap_seconds: float = DEFAULT_RELAY_RETRY_CAP_SECONDS,
    retry_jitter_seconds: float = DEFAULT_RELAY_RETRY_JITTER_SECONDS,
    rng: Callable[[], float] = random.random,
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
    recovered = sum(1 for task in claimed if task.recovered_from_lease)
    for task in claimed:
        if task.task_name not in SUPPORTED_OUTBOX_TASKS:
            if await _mark_failed(
                session_factory,
                task,
                error_code=UNSUPPORTED_TASK_ERROR_CODE,
                error_message=UNSUPPORTED_TASK_ERROR_MESSAGE,
                retry_delay_seconds=0.0,
                terminal=True,
            ):
                failed += 1
            continue

        message = _relay_message(task)
        try:
            publisher.publish(message)
        except Exception as exc:
            error_code, error_message = classify_publish_error(exc)
            retry_delay_seconds = compute_retry_delay_seconds(
                task.attempt_count,
                base_seconds=retry_base_seconds,
                cap_seconds=retry_cap_seconds,
                jitter_seconds=retry_jitter_seconds,
                rng=rng,
            )
            if await _mark_failed(
                session_factory,
                task,
                error_code=error_code,
                error_message=error_message,
                retry_delay_seconds=retry_delay_seconds,
                terminal=False,
            ):
                failed += 1
            continue

        if await _mark_published(session_factory, message):
            published += 1

    return RelayOnceResult(
        claimed=len(claimed),
        published=published,
        failed=failed,
        recovered=recovered,
    )


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
    terminal: bool,
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
            terminal=terminal,
        )
