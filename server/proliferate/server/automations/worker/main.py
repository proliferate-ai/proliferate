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
        await run_scheduler_loop(
            interval_seconds=args.interval_seconds,
            batch_size=args.batch_size,
            stop_event=stop_event,
            validate_schema=_validate_schema,
        )
    finally:
        flush_server_sentry()


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
        choices=("scheduler",),
        default="scheduler",
    )
    parser.add_argument("--interval-seconds", type=_positive_float, default=15.0)
    parser.add_argument("--batch-size", type=_positive_int, default=100)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    asyncio.run(_amain(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
