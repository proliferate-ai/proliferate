"""Real-Postgres lifecycle/CAS proof for managed Workflow execution."""

from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.store import workflow_managed_delivery as delivery_store
from proliferate.db.store import workflow_managed_execution as managed_store
from proliferate.db.store import workflow_managed_observability as observability_store
from proliferate.db.store import workflow_managed_projection as projection_store
from tests.integration.cloud_api_helpers import register_and_login
from tests.integration.test_workflow_managed_execution_api import (
    _create_invocation,
    _headers,
)


def _projection(
    invocation_id: UUID,
    *,
    version: int,
    status: str = "running",
) -> dict[str, object]:
    return {
        "id": str(invocation_id),
        "status": status,
        "stateVersion": version,
        "workspaceId": "workspace-a",
        "steps": [],
    }


async def _advance_to_run_put_started(
    client: AsyncClient,
    db: AsyncSession,
    owner: dict[str, str],
) -> tuple[UUID, UUID]:
    _definition_id, invocation_text = await _create_invocation(client, owner)
    invocation_id = UUID(invocation_text)
    delivered = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/deliver",
        headers=_headers(owner),
    )
    assert delivered.status_code == 200
    sandbox_id = uuid4()
    cloud_workspace_id = uuid4()
    transitions = (
        (
            1,
            "none",
            "target_plan_frozen",
            {
                "target_plan_json": {
                    "kind": "scratch",
                    "cloudSandboxId": str(sandbox_id),
                },
                "target_cloud_sandbox_id": sandbox_id,
            },
        ),
        (
            2,
            "target_plan_frozen",
            "target_bound",
            {"target_execution_store_id": "store-a"},
        ),
        (3, "target_bound", "workspace_put_started", {}),
        (
            4,
            "workspace_put_started",
            "workspace_ready",
            {
                "target_workspace_id": "workspace-a",
                "cloud_workspace_id": cloud_workspace_id,
            },
        ),
        (5, "workspace_ready", "run_put_started", {}),
    )
    for generation, current, successor, values in transitions:
        assert await delivery_store.advance_delivery(
            db,
            invocation_id=invocation_id,
            expected_generation=generation,
            expected_checkpoint=current,
            next_checkpoint=successor,
            **values,
        ) is not None
    await db.commit()
    return invocation_id, sandbox_id


@pytest.mark.asyncio
async def test_projection_store_enforces_full_monotonic_matrix(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-projection@example.com")
    invocation_id, _sandbox_id = await _advance_to_run_put_started(
        client,
        db_session,
        owner,
    )
    first = _projection(invocation_id, version=1)
    accepted = await delivery_store.mark_delivery_accepted(
        db_session,
        invocation_id=invocation_id,
        expected_generation=6,
        projection=first,
    )
    assert accepted is not None
    assert accepted.observation_generation == 1

    higher = _projection(invocation_id, version=2, status="completed")
    applied = await projection_store.apply_projection(
        db_session,
        invocation_id=invocation_id,
        expected_observation_generation=1,
        projection=higher,
        decision="apply",
    )
    assert applied is not None
    assert applied.latest_projection_json == higher

    heartbeat = await projection_store.apply_projection(
        db_session,
        invocation_id=invocation_id,
        expected_observation_generation=2,
        projection=higher,
        decision="heartbeat",
    )
    assert heartbeat is not None
    assert heartbeat.consecutive_unchanged_count == 1

    conflict = _projection(invocation_id, version=2, status="failed")
    conflicted = await projection_store.apply_projection(
        db_session,
        invocation_id=invocation_id,
        expected_observation_generation=3,
        projection=conflict,
        decision="conflict",
    )
    assert conflicted is not None
    assert conflicted.latest_projection_json == higher
    assert conflicted.last_observation_error_code == "equal_version_projection_conflict"

    stale = _projection(invocation_id, version=1)
    ignored = await projection_store.apply_projection(
        db_session,
        invocation_id=invocation_id,
        expected_observation_generation=4,
        projection=stale,
        decision="stale",
    )
    assert ignored is not None
    assert ignored.latest_projection_json == higher
    wrong_decision = await projection_store.apply_projection(
        db_session,
        invocation_id=invocation_id,
        expected_observation_generation=5,
        projection=stale,
        decision="apply",
    )
    assert wrong_decision is None


@pytest.mark.asyncio
async def test_projection_generation_cas_serializes_concurrent_callbacks(
    client: AsyncClient,
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-projection-race@example.com")
    invocation_id, _sandbox_id = await _advance_to_run_put_started(
        client,
        db_session,
        owner,
    )
    accepted = await delivery_store.mark_delivery_accepted(
        db_session,
        invocation_id=invocation_id,
        expected_generation=6,
        projection=_projection(invocation_id, version=1),
    )
    assert accepted is not None
    await db_session.commit()
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    candidates = (
        _projection(invocation_id, version=2),
        _projection(invocation_id, version=3),
    )

    async def apply(candidate: dict[str, object]) -> dict[str, object] | None:
        async with factory() as db, db.begin():
            result = await projection_store.apply_projection(
                db,
                invocation_id=invocation_id,
                expected_observation_generation=1,
                projection=candidate,
                decision="apply",
            )
            return None if result is None else result.latest_projection_json

    results = await asyncio.gather(*(apply(candidate) for candidate in candidates))
    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    async with factory() as db:
        settled = await managed_store.get_managed_execution(
            db,
            invocation_id=invocation_id,
        )
    assert settled is not None
    assert settled.observation_generation == 2
    assert settled.latest_projection_json == winners[0]


@pytest.mark.asyncio
async def test_managed_telemetry_snapshot_reports_pending_and_invariant_truth(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-telemetry@example.com")
    invocation_id, _sandbox_id = await _advance_to_run_put_started(
        client,
        db_session,
        owner,
    )
    accepted = await delivery_store.mark_delivery_accepted(
        db_session,
        invocation_id=invocation_id,
        expected_generation=6,
        projection=_projection(invocation_id, version=1),
    )
    assert accepted is not None
    unreachable = await projection_store.mark_observation_unreachable(
        db_session,
        invocation_id=invocation_id,
        expected_generation=1,
        error_code="workflow_runtime_unreachable",
    )
    assert unreachable is not None
    cancelled, enqueue_cancel = await delivery_store.request_cancellation(
        db_session,
        invocation_id=invocation_id,
    )
    assert cancelled is not None and enqueue_cancel
    conflict = await projection_store.apply_projection(
        db_session,
        invocation_id=invocation_id,
        expected_observation_generation=2,
        projection=_projection(invocation_id, version=1, status="failed"),
        decision="conflict",
    )
    assert conflict is not None

    snapshot = await observability_store.get_managed_workflow_telemetry_snapshot(
        db_session
    )
    assert snapshot.accepted_nonterminal_count == 1
    assert snapshot.pending_cancellation_count == 1
    assert snapshot.unreachable_count == 0
    assert snapshot.invariant_conflict_count == 1
    assert snapshot.oldest_accepted_observation_age_seconds >= 0
    assert snapshot.oldest_pending_cancellation_age_seconds >= 0


@pytest.mark.asyncio
async def test_cancel_run_boundary_is_idempotent_and_target_loss_is_truthful(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-cancel-boundary@example.com")
    invocation_id, sandbox_id = await _advance_to_run_put_started(
        client,
        db_session,
        owner,
    )

    first = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/cancel",
        headers=_headers(owner),
    )
    replay = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/cancel",
        headers=_headers(owner),
    )
    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json()
    assert first.json()["managedExecution"]["desiredState"] == "cancelled"
    count = await db_session.scalar(
        select(func.count())
        .select_from(BackgroundOutboxTask)
        .where(
            BackgroundOutboxTask.idempotency_key
            == f"workflow:cancel:{invocation_id}:1"
        )
    )
    assert count == 1

    lost = await projection_store.mark_target_lost(
        db_session,
        invocation_id=invocation_id,
        operation="cancel",
        expected_generation=1,
        expected_cloud_sandbox_id=sandbox_id,
        expected_execution_store_id="store-a",
        error_code="workflow_target_destroyed",
    )
    assert lost is not None
    stale_cancel = await projection_store.apply_cancel_projection(
        db_session,
        invocation_id=invocation_id,
        expected_cancel_generation=1,
        projection=_projection(invocation_id, version=1),
    )
    assert stale_cancel is None
    await db_session.commit()
    after_loss = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/cancel",
        headers=_headers(owner),
    )
    assert after_loss.status_code == 200
    assert after_loss.json()["managedExecution"]["freshness"]["status"] == "target_lost"

    active_id, active_sandbox_id = await _advance_to_run_put_started(
        client,
        db_session,
        owner,
    )
    active_lost = await projection_store.mark_target_lost(
        db_session,
        invocation_id=active_id,
        operation="deliver",
        expected_generation=6,
        expected_cloud_sandbox_id=active_sandbox_id,
        expected_execution_store_id="store-a",
        error_code="workflow_execution_store_changed",
    )
    assert active_lost is not None
    stale_accept = await delivery_store.mark_delivery_accepted(
        db_session,
        invocation_id=active_id,
        expected_generation=6,
        projection=_projection(active_id, version=1),
    )
    stale_observation = await projection_store.apply_projection(
        db_session,
        invocation_id=active_id,
        expected_observation_generation=0,
        projection=_projection(active_id, version=1),
        decision="apply",
    )
    assert stale_accept is None
    assert stale_observation is None
    await db_session.commit()
    rejected = await client.post(
        f"/v1/workflow-invocations/{active_id}/cancel",
        headers=_headers(owner),
    )
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "workflow_target_lost"
