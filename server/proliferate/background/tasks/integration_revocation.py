"""Celery wrappers for bounded integration revocation and deadline cleanup."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import ParamSpec, Protocol, TypeVar, cast

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from proliferate.background.celery_app import celery_app
from proliferate.background.config import (
    INTEGRATION_REVOCATION_PROCESS_TASK,
    INTEGRATION_REVOCATION_SWEEP_TASK,
)
from proliferate.config import settings
from proliferate.server.integration_gateway.connections.revocation import (
    run_revocation_deadline_sweep,
    run_revocation_job,
)

P = ParamSpec("P")
R = TypeVar("R")


class _RetryTask(Protocol):
    def retry(self, *, countdown: float) -> BaseException: ...


def _task(**options: object) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Preserve task signatures across Celery's untyped decorator boundary."""

    return cast(
        "Callable[[Callable[P, R]], Callable[P, R]]",
        celery_app.task(**options),
    )


async def _run_job(job_id: str) -> float | None:
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        return await run_revocation_job(session_factory, job_id=job_id)
    finally:
        await engine.dispose()


async def _run_sweep() -> None:
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        await run_revocation_deadline_sweep(session_factory)
    finally:
        await engine.dispose()


@_task(bind=True, name=INTEGRATION_REVOCATION_PROCESS_TASK, max_retries=None)
def process(task: _RetryTask, job_id: str) -> None:
    retry_after = asyncio.run(_run_job(job_id))
    if retry_after is not None:
        raise task.retry(countdown=retry_after)


@_task(name=INTEGRATION_REVOCATION_SWEEP_TASK)
def sweep() -> None:
    asyncio.run(_run_sweep())
