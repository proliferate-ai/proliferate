"""Automation worker entrypoint."""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
from collections.abc import Sequence

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.migrations import validate_database_schema
from proliferate.integrations.sentry import (
    capture_server_sentry_exception,
    flush_server_sentry,
    init_server_sentry,
)
from proliferate.server.automations.service import run_scheduler_tick
from proliferate.utils.logging import configure_server_logging

logger = logging.getLogger(__name__)
FAILURE_ESCALATION_THRESHOLD = 3
MAX_FAILURE_BACKOFF_SECONDS = 300.0


async def _validate_schema() -> None:
    try:
        async with db_engine.engine.begin() as conn:
            await conn.run_sync(validate_database_schema)
    except RuntimeError:
        raise
    except OSError as exc:
        raise RuntimeError(
            "Could not connect to PostgreSQL for the automation worker. "
            "Start Postgres and run `make server-migrate` before starting the worker."
        ) from exc


async def run_scheduler_loop(
    *,
    interval_seconds: float,
    batch_size: int,
    stop_event: asyncio.Event,
) -> None:
    logger.info(
        "Automation scheduler worker started interval_seconds=%s batch_size=%s",
        interval_seconds,
        batch_size,
    )
    schema_validated = False
    disabled_logged = False
    consecutive_failures = 0
    while not stop_event.is_set():
        if not settings.automations_enabled:
            if not disabled_logged:
                logger.info("Automations are disabled; automation scheduler worker is idle.")
                disabled_logged = True
            schema_validated = False
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
            except TimeoutError:
                continue
            continue
        disabled_logged = False
        try:
            if not schema_validated:
                await _validate_schema()
                schema_validated = True
            result = await run_scheduler_tick(batch_size=batch_size)
            consecutive_failures = 0
            if result.created_runs:
                logger.info("Automation scheduler created runs count=%s", result.created_runs)
            next_delay = interval_seconds
        except Exception as exc:
            consecutive_failures += 1
            next_delay = min(
                interval_seconds * (2 ** (consecutive_failures - 1)),
                MAX_FAILURE_BACKOFF_SECONDS,
            )
            logger.exception(
                "Automation scheduler tick failed consecutive_failures=%s next_delay_seconds=%s",
                consecutive_failures,
                next_delay,
            )
            if consecutive_failures >= FAILURE_ESCALATION_THRESHOLD:
                capture_server_sentry_exception(
                    exc,
                    level="error",
                    tags={"worker": "automation_scheduler"},
                    extras={"consecutive_failures": consecutive_failures},
                    fingerprint=["automation-scheduler", "tick-failed"],
                )
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=next_delay)
        except TimeoutError:
            continue


def _install_signal_handlers(stop_event: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop_event.set)


async def _amain(args: argparse.Namespace) -> None:
    configure_server_logging()
    init_server_sentry()
    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    try:
        await run_scheduler_loop(
            interval_seconds=args.interval_seconds,
            batch_size=args.batch_size,
            stop_event=stop_event,
        )
    finally:
        flush_server_sentry()


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Proliferate automation workers.")
    parser.add_argument("--role", choices=("scheduler",), default="scheduler")
    parser.add_argument("--interval-seconds", type=float, default=15.0)
    parser.add_argument("--batch-size", type=int, default=100)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    asyncio.run(_amain(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
