"""Real-Postgres successor timing proof for managed Workflow workers."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.store import workflow_managed_delivery as delivery_store
from proliferate.integrations.anyharness.errors import WorkflowRuntimeError
from proliferate.server.workflows.worker import cancellation, observation
from tests.integration.cloud_api_helpers import register_and_login
from tests.integration.test_workflow_managed_execution_api import _headers
from tests.integration.test_workflow_managed_execution_store import (
    _advance_to_run_put_started,
)
from tests.integration.test_workflow_managed_workers import _projection


async def _accepted_run(
    client: AsyncClient,
    db: AsyncSession,
    owner: dict[str, str],
) -> UUID:
    invocation_id, _sandbox_id = await _advance_to_run_put_started(client, db, owner)
    accepted = await delivery_store.mark_delivery_accepted(
        db,
        invocation_id=invocation_id,
        expected_generation=6,
        projection=_projection(invocation_id, version=1, status="running").value,
    )
    assert accepted is not None
    await db.commit()
    return invocation_id


async def _successor_delays(
    factory: async_sessionmaker[AsyncSession],
    *,
    operation: str,
    invocation_id: UUID,
    generations: range,
) -> list[int]:
    values: list[int] = []
    async with factory() as db:
        for generation in generations:
            row = await db.scalar(
                select(BackgroundOutboxTask).where(
                    BackgroundOutboxTask.idempotency_key
                    == f"workflow:{operation}:{invocation_id}:{generation}"
                )
            )
            assert row is not None
            values.append(round((row.available_at - row.created_at).total_seconds()))
    return values


@pytest.mark.asyncio
async def test_observe_and_cancel_access_backoff_use_consecutive_failures(
    client: AsyncClient,
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-worker-backoff@example.com")
    invocation_id = await _accepted_run(client, db_session, owner)
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def unavailable(*_args: object, **_kwargs: object) -> None:
        raise WorkflowRuntimeError("workflow_runtime_unreachable", retryable=True)

    monkeypatch.setattr(observation, "runtime_access", unavailable)
    for generation in range(1, 6):
        await observation.run_observation_task(
            factory,
            invocation_id=invocation_id,
            generation=generation,
        )
    assert await _successor_delays(
        factory,
        operation="observe",
        invocation_id=invocation_id,
        generations=range(2, 7),
    ) == [5, 10, 20, 40, 60]

    requested = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/cancel",
        headers=_headers(owner),
    )
    assert requested.status_code == 200
    monkeypatch.setattr(cancellation, "runtime_access", unavailable)
    for generation in range(1, 6):
        await cancellation.run_cancel_task(
            factory,
            invocation_id=invocation_id,
            generation=generation,
        )
    assert await _successor_delays(
        factory,
        operation="cancel",
        invocation_id=invocation_id,
        generations=range(2, 7),
    ) == [5, 10, 20, 40, 60]
