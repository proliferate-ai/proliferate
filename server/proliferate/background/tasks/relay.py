"""Beat-fired relay task: drain one bounded outbox batch and exit.

This wrapper is intentionally thin. Beat schedules ``background.relay`` on a
short interval; each firing constructs a session factory, runs a single bounded
``relay_once`` batch, emits safe counts/latency, and returns. Nothing here
sleeps, polls forever, or holds a transaction open across a broker publish.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from proliferate.background.celery_app import celery_app
from proliferate.background.config import BACKGROUND_RELAY_TASK
from proliferate.config import settings

if TYPE_CHECKING:
    from proliferate.background.relay import RelayTickResult

logger = logging.getLogger(__name__)


def _build_metrics_logger() -> logging.Logger:
    """Logger that writes bare JSON lines, bypassing Celery's log formatter.

    The hosted CloudWatch metric filters use JSON patterns
    (``{ $.background_relay.<field> = * }``), which only match when the whole
    log event is valid JSON. Celery's default formatter prefixes every record
    with ``[timestamp: level/process]``, so the metric line is emitted through a
    dedicated non-propagating handler with a message-only format instead.
    """

    metrics_logger = logging.getLogger("proliferate.background.relay_metrics")
    if not metrics_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        metrics_logger.addHandler(handler)
        metrics_logger.setLevel(logging.INFO)
        metrics_logger.propagate = False
    return metrics_logger


_metrics_logger = _build_metrics_logger()


def _safe_family_key(task_name: str) -> str:
    """Map a task name to a CloudWatch-JSON-safe field key.

    CloudWatch metric-filter selectors treat dots as path separators, so the
    emitted per-family key must not contain them. Task names are already fixed,
    low-cardinality registry values, so this is a stable one-to-one rename
    (``background.health.noop`` -> ``background_health_noop``).
    """

    return "".join(ch if ch.isalnum() else "_" for ch in task_name)


async def _run_relay_batch() -> RelayTickResult:
    # Imported lazily so this task module can be imported by ``celery_app`` while
    # ``proliferate.background.relay`` (which imports ``celery_app``) is still
    # initializing, without a circular import at module load. The task wrapper
    # touches no store: ``run_relay_tick`` is the single relay-owned surface that
    # drains the batch and reads bounded snapshots behind the server store law.
    from proliferate.background.relay import run_relay_tick

    # A fresh engine per firing keeps asyncpg connections bound to the loop
    # created by ``asyncio.run`` below. The relay task fires infrequently and
    # drains a small batch, so the connect cost is negligible and this avoids
    # reusing a global engine across short-lived per-tick event loops.
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        return await run_relay_tick(
            session_factory=session_factory,
            batch_size=settings.background_relay_batch_size,
            lease_seconds=settings.background_relay_lease_seconds,
            retry_base_seconds=settings.background_relay_retry_base_seconds,
            retry_cap_seconds=settings.background_relay_retry_cap_seconds,
            retry_jitter_seconds=settings.background_relay_retry_jitter_seconds,
        )
    finally:
        await engine.dispose()


@celery_app.task(name=BACKGROUND_RELAY_TASK)
def relay() -> dict[str, object]:
    """Run one bounded relay batch and emit low-cardinality metrics."""

    started = time.perf_counter()
    tick = asyncio.run(_run_relay_batch())
    latency_ms = int((time.perf_counter() - started) * 1000)
    metrics: dict[str, object] = {
        # A tick that completed at all proves Beat AND the scheduler store are
        # live: RedBeat/Valkey must be reachable for Beat to dispatch this task,
        # so a steady stream of `relay_heartbeat=1` lines is the direct
        # scheduler-store liveness signal. Its ABSENCE (no data) breaches the
        # heartbeat alarm — unlike the oldest-due SLO, which treats missing data
        # as not-breaching and therefore cannot detect a store outage.
        "relay_heartbeat": 1,
        "claimed": tick.claimed,
        "published": tick.published,
        "failed": tick.failed,
        "recovered_leases": tick.recovered,
        "latency_ms": latency_ms,
        "due_pending": tick.due_pending,
        "publishing": tick.publishing,
        "expired_publishing": tick.expired_publishing,
        "failed_rows": tick.failed_rows,
        "oldest_due_pending_age_seconds": round(tick.oldest_due_pending_age_seconds, 3),
        # Bounded by the supported-task allowlist, so cardinality is fixed. Keys
        # are dot-free so CloudWatch JSON metric filters can select each family.
        "supported_pending_by_family": {
            _safe_family_key(name): count
            for name, count in tick.supported_pending_by_family.items()
        },
        "supported_oldest_pending_age_by_family": {
            _safe_family_key(name): round(age, 3)
            for name, age in tick.supported_oldest_pending_age_by_family.items()
        },
        "managed_workflows": {
            "queued_or_delivering": tick.managed_workflows.queued_or_delivering_count,
            "oldest_queued_or_delivering_age_seconds": round(
                tick.managed_workflows.oldest_queued_or_delivering_age_seconds, 3
            ),
            "accepted_nonterminal": tick.managed_workflows.accepted_nonterminal_count,
            "oldest_accepted_observation_age_seconds": round(
                tick.managed_workflows.oldest_accepted_observation_age_seconds, 3
            ),
            "pending_cancellation": tick.managed_workflows.pending_cancellation_count,
            "oldest_pending_cancellation_age_seconds": round(
                tick.managed_workflows.oldest_pending_cancellation_age_seconds, 3
            ),
            "unreachable": tick.managed_workflows.unreachable_count,
            "target_lost": tick.managed_workflows.target_lost_count,
            "invariant_conflicts": tick.managed_workflows.invariant_conflict_count,
        },
    }
    # Safe to log: only counts, latency, and backlog ages. No args/kwargs, broker
    # URLs, credentials, or payloads. Hosted CloudWatch metric filters turn these
    # fields into the background-plane gauges and alarms; the JSON line below is
    # the exact shape those filters parse.
    logger.info("background.relay tick")
    _metrics_logger.info(json.dumps({"background_relay": metrics}))
    return metrics
