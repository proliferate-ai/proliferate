"""Thin Celery wrappers for bounded managed Workflow operations."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from proliferate.background.celery_app import celery_app
from proliferate.background.config import (
    WORKFLOW_CANCEL_TASK,
    WORKFLOW_DELIVER_TASK,
    WORKFLOW_OBSERVE_TASK,
)
from proliferate.background.correlation import CorrelatedTask
from proliferate.config import settings
from proliferate.server.workflows.worker.service import (
    run_cancel_task,
    run_delivery_task,
    run_observation_task,
)

WorkflowOperation = Callable[..., Awaitable[None]]


class WorkflowTask(CorrelatedTask):
    """Retry any escaped crash so a current generation is never stranded."""

    abstract = True
    autoretry_for = (Exception,)
    retry_backoff = True
    retry_backoff_max = 60
    retry_jitter = True
    max_retries = None


async def _run(operation: WorkflowOperation, invocation_id: str, generation: int) -> None:
    parsed_id = UUID(invocation_id)
    if generation < 0:
        return
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        await operation(
            session_factory,
            invocation_id=parsed_id,
            generation=generation,
        )
    finally:
        await engine.dispose()


@celery_app.task(base=WorkflowTask, name=WORKFLOW_DELIVER_TASK)
def deliver(invocation_id: str, generation: int) -> None:
    asyncio.run(_run(run_delivery_task, invocation_id, generation))


@celery_app.task(base=WorkflowTask, name=WORKFLOW_OBSERVE_TASK)
def observe(invocation_id: str, generation: int) -> None:
    asyncio.run(_run(run_observation_task, invocation_id, generation))


@celery_app.task(base=WorkflowTask, name=WORKFLOW_CANCEL_TASK)
def cancel(invocation_id: str, generation: int) -> None:
    asyncio.run(_run(run_cancel_task, invocation_id, generation))
