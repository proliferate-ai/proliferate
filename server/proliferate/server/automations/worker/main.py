"""Automation worker entrypoint."""

from __future__ import annotations

import argparse
import asyncio
import signal
from collections.abc import Sequence

from proliferate.db import engine as db_engine
from proliferate.db.migrations import validate_database_schema
from proliferate.integrations.sentry import (
    flush_server_sentry,
    init_server_sentry,
)
from proliferate.server.automations.cloud_executor import (
    CloudExecutorConfig,
    build_cloud_executor_config,
    run_cloud_executor_loop,
)
from proliferate.server.automations.worker.scheduler import run_scheduler_loop
from proliferate.utils.logging import configure_server_logging


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
                validate_schema=_validate_schema,
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
                        validate_schema=_validate_schema,
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
