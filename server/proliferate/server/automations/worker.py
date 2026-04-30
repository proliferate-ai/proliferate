"""Automation worker entrypoint."""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
from collections.abc import Sequence

from proliferate.db import engine as db_engine
from proliferate.db.migrations import validate_database_schema
from proliferate.integrations.sentry import (
    capture_server_sentry_exception,
    flush_server_sentry,
    init_server_sentry,
)
from proliferate.server.automations.cloud_executor import (
    CloudExecutorConfig,
    build_cloud_executor_config,
    run_cloud_executor_loop,
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
    consecutive_failures = 0
    while not stop_event.is_set():
        try:
            if not schema_validated:
                await _validate_schema()
                schema_validated = True
            result = await run_scheduler_tick(batch_size=batch_size)
            consecutive_failures = 0
            if result.created_runs:
                logger.info("Automation scheduler created runs count=%s", result.created_runs)
            if result.swept_dispatching_runs:
                logger.warning(
                    "Automation scheduler swept dispatching runs count=%s",
                    result.swept_dispatching_runs,
                )
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
        if args.role == "scheduler":
            await run_scheduler_loop(
                interval_seconds=args.interval_seconds,
                batch_size=args.batch_size,
                stop_event=stop_event,
            )
        elif args.role == "cloud-executor":
            await _validate_schema()
            await run_cloud_executor_loop(
                stop_event=stop_event,
                config=_cloud_executor_config_from_args(args),
            )
        else:
            await _validate_schema()
            cloud_executor_config = _cloud_executor_config_from_args(args)
            tasks = [
                asyncio.create_task(
                    run_scheduler_loop(
                        interval_seconds=args.interval_seconds,
                        batch_size=args.batch_size,
                        stop_event=stop_event,
                    )
                ),
                asyncio.create_task(
                    run_cloud_executor_loop(
                        stop_event=stop_event,
                        config=cloud_executor_config,
                    )
                ),
            ]
            await stop_event.wait()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        flush_server_sentry()


def _cloud_executor_config_from_args(args: argparse.Namespace) -> CloudExecutorConfig:
    return build_cloud_executor_config(
        executor_id=args.cloud_executor_id,
        claim_ttl_seconds=args.cloud_claim_ttl_seconds,
        heartbeat_interval_seconds=args.cloud_heartbeat_seconds,
        concurrency=args.cloud_concurrency,
        poll_interval_seconds=args.cloud_poll_seconds,
        sweep_limit=args.cloud_sweep_limit,
        branch_prefix=args.cloud_branch_prefix,
        max_branch_slug_chars=args.cloud_branch_slug_chars,
    )


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return parsed


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return parsed


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Proliferate automation workers.")
    parser.add_argument(
        "--role",
        choices=("scheduler", "cloud-executor", "all"),
        default="scheduler",
    )
    parser.add_argument("--interval-seconds", type=float, default=15.0)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--cloud-executor-id", default=None)
    parser.add_argument("--cloud-claim-ttl-seconds", type=_positive_float, default=None)
    parser.add_argument("--cloud-heartbeat-seconds", type=_positive_float, default=None)
    parser.add_argument("--cloud-concurrency", type=_positive_int, default=None)
    parser.add_argument("--cloud-poll-seconds", type=_positive_float, default=None)
    parser.add_argument("--cloud-sweep-limit", type=_positive_int, default=None)
    parser.add_argument("--cloud-branch-prefix", default=None)
    parser.add_argument("--cloud-branch-slug-chars", type=_positive_int, default=None)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    asyncio.run(_amain(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
