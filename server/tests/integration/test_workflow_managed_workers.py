"""Real-Postgres task/checkpoint proof with scripted typed target seams."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.store import workflow_managed_delivery as delivery_store
from proliferate.db.store import workflow_managed_execution as managed_store
from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.integrations.anyharness.errors import WorkflowRuntimeError
from proliferate.integrations.anyharness.models import (
    WorkflowRunProjection,
    WorkflowWorkspaceAcceptance,
)
from proliferate.server.workflows.worker import cancellation, delivery, observation
from proliferate.server.workflows.worker.coordination import RuntimeAccess
from tests.integration.cloud_api_helpers import register_and_login
from tests.integration.test_workflow_managed_execution_api import (
    _create_invocation,
    _headers,
)
from tests.integration.test_workflow_managed_execution_store import (
    _advance_to_run_put_started,
)


def _projection(
    invocation_id: UUID,
    *,
    version: int,
    status: str,
) -> WorkflowRunProjection:
    return WorkflowRunProjection(
        value={
            "id": str(invocation_id),
            "status": status,
            "stateVersion": version,
            "workspaceId": "workspace-a",
            "sessionId": "session-a",
            "promptId": "prompt-a",
            "turnId": "turn-a",
            "cancelRequestedAt": None,
            "failureCode": None,
            "interruptionCode": None,
            "stopReason": None,
            "startedAt": "2026-07-16T00:00:00Z",
            "finishedAt": (
                "2026-07-16T00:01:00Z" if status in {"completed", "cancelled"} else None
            ),
            "steps": [
                {
                    "index": 0,
                    "status": status,
                    "failureCode": None,
                    "interruptionCode": None,
                    "startedAt": "2026-07-16T00:00:00Z",
                    "finishedAt": (
                        "2026-07-16T00:01:00Z" if status in {"completed", "cancelled"} else None
                    ),
                }
            ],
        }
    )


async def _seed_target_plan(
    client: AsyncClient,
    db: AsyncSession,
    owner: dict[str, str],
) -> tuple[UUID, UUID]:
    _definition_id, invocation_text = await _create_invocation(client, owner)
    invocation_id = UUID(invocation_text)
    assert (
        await client.post(
            f"/v1/workflow-invocations/{invocation_id}/deliver",
            headers=_headers(owner),
        )
    ).status_code == 200
    sandbox_id = uuid4()
    assert (
        await delivery_store.advance_delivery(
            db,
            invocation_id=invocation_id,
            expected_generation=1,
            expected_checkpoint="none",
            next_checkpoint="target_plan_frozen",
            target_plan_json={
                "kind": "scratch",
                "cloudSandboxId": str(sandbox_id),
            },
            target_cloud_sandbox_id=sandbox_id,
        )
        is not None
    )
    await db.commit()
    return invocation_id, sandbox_id


@pytest.mark.asyncio
async def test_cancel_before_runtime_work_invalidates_stale_delivery_task(
    client: AsyncClient,
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-worker-pre-cancel@example.com")
    _definition_id, invocation_text = await _create_invocation(client, owner)
    invocation_id = UUID(invocation_text)
    assert (
        await client.post(
            f"/v1/workflow-invocations/{invocation_id}/deliver",
            headers=_headers(owner),
        )
    ).status_code == 200
    cancelled = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/cancel",
        headers=_headers(owner),
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["managedExecution"]["deliveryStatus"] == "delivery_cancelled"
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    calls = 0

    async def forbidden_freeze(*_args: object, **_kwargs: object) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(delivery, "freeze_target_plan", forbidden_freeze)
    await delivery.run_delivery_task(
        factory,
        invocation_id=invocation_id,
        generation=1,
    )
    assert calls == 0
    async with factory() as db:
        settled = await managed_store.get_managed_execution(
            db,
            invocation_id=invocation_id,
        )
    assert settled is not None
    assert settled.delivery_generation == 2
    assert settled.delivery_status == "delivery_cancelled"


@pytest.mark.asyncio
async def test_delivery_replays_lost_responses_and_observation_stops_terminal(
    client: AsyncClient,
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-worker-delivery@example.com")
    invocation_id, sandbox_id = await _seed_target_plan(client, db_session, owner)
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    access = RuntimeAccess(
        sandbox_id=sandbox_id,
        runtime_url="https://runtime.invalid",
        access_token="secret-token",
        execution_store_id="store-a",
    )

    async def runtime_access(*_args: object, **_kwargs: object) -> RuntimeAccess:
        return access

    workspace_calls = 0

    async def put_workspace(*_args: object, **_kwargs: object) -> WorkflowWorkspaceAcceptance:
        nonlocal workspace_calls
        workspace_calls += 1
        if workspace_calls == 1:
            raise WorkflowRuntimeError("workflow_workspace_put_unreachable", retryable=True)
        return WorkflowWorkspaceAcceptance(workspace_id="workspace-a")

    cloud_workspace_id = uuid4()

    async def bind_workspace(*_args: object, **_kwargs: object) -> CloudWorkspaceValue:
        now = datetime.now(UTC)
        return CloudWorkspaceValue(
            id=cloud_workspace_id,
            owner_user_id=UUID(owner["user_id"]),
            workspace_kind="scratch",
            repo_environment_id=None,
            display_name=f"Workflow run {invocation_id}",
            git_branch="main",
            git_base_branch=None,
            anyharness_workspace_id="workspace-a",
            created_at=now,
            updated_at=now,
            archived_at=None,
        )

    run_calls = 0

    async def put_run(*_args: object, **_kwargs: object) -> WorkflowRunProjection:
        nonlocal run_calls
        run_calls += 1
        if run_calls == 1:
            raise WorkflowRuntimeError("workflow_run_put_unreachable", retryable=True)
        return _projection(invocation_id, version=1, status="running")

    monkeypatch.setattr(delivery, "runtime_access", runtime_access)
    monkeypatch.setattr(delivery, "put_workflow_workspace", put_workspace)
    monkeypatch.setattr(
        delivery.workflow_binding,
        "bind_managed_workflow_workspace",
        bind_workspace,
    )
    monkeypatch.setattr(delivery, "put_workflow_run", put_run)

    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=2)
    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=2)
    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=3)
    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=4)
    async with factory() as db:
        after_workspace_loss = await managed_store.get_managed_execution(
            db,
            invocation_id=invocation_id,
        )
        assert after_workspace_loss is not None
        assert after_workspace_loss.delivery_generation == 5
        retry = await db.scalar(
            select(BackgroundOutboxTask).where(
                BackgroundOutboxTask.idempotency_key == f"workflow:deliver:{invocation_id}:5"
            )
        )
        assert retry is not None
        assert 4.5 <= (retry.available_at - retry.created_at).total_seconds() <= 5.5

    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=5)
    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=5)
    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=6)
    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=7)
    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=8)
    await delivery.run_delivery_task(factory, invocation_id=invocation_id, generation=8)
    assert workspace_calls == 2
    assert run_calls == 2

    observations = iter(
        [
            _projection(invocation_id, version=2, status="running"),
            _projection(invocation_id, version=3, status="completed"),
        ]
    )

    async def get_run(*_args: object, **_kwargs: object) -> WorkflowRunProjection:
        return next(observations)

    monkeypatch.setattr(observation, "runtime_access", runtime_access)
    monkeypatch.setattr(observation, "get_workflow_run", get_run)
    await observation.run_observation_task(
        factory,
        invocation_id=invocation_id,
        generation=1,
    )
    await observation.run_observation_task(
        factory,
        invocation_id=invocation_id,
        generation=1,
    )
    await observation.run_observation_task(
        factory,
        invocation_id=invocation_id,
        generation=2,
    )
    await observation.run_observation_task(
        factory,
        invocation_id=invocation_id,
        generation=3,
    )
    async with factory() as db:
        terminal = await managed_store.get_managed_execution(
            db,
            invocation_id=invocation_id,
        )
        assert terminal is not None
        assert terminal.execution_status == "completed"
        observe_successors = await db.scalar(
            select(func.count())
            .select_from(BackgroundOutboxTask)
            .where(BackgroundOutboxTask.task_name == "workflows.observe")
        )
        assert observe_successors == 2


@pytest.mark.asyncio
async def test_cancel_reconciles_run_put_ambiguity_once(
    client: AsyncClient,
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-worker-cancel@example.com")
    invocation_id, sandbox_id = await _advance_to_run_put_started(
        client,
        db_session,
        owner,
    )
    requested = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/cancel",
        headers=_headers(owner),
    )
    assert requested.status_code == 200
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    access = RuntimeAccess(
        sandbox_id=sandbox_id,
        runtime_url="https://runtime.invalid",
        access_token="secret-token",
        execution_store_id="store-a",
    )
    calls = {"get": 0, "put": 0, "cancel": 0}

    async def runtime_access(*_args: object, **_kwargs: object) -> RuntimeAccess:
        return access

    async def get_run(*_args: object, **_kwargs: object) -> WorkflowRunProjection:
        calls["get"] += 1
        raise WorkflowRuntimeError("workflow_run_get_not_found", not_found=True)

    async def put_run(*_args: object, **_kwargs: object) -> WorkflowRunProjection:
        calls["put"] += 1
        return _projection(invocation_id, version=1, status="running")

    async def cancel_run(*_args: object, **_kwargs: object) -> WorkflowRunProjection:
        calls["cancel"] += 1
        return _projection(invocation_id, version=2, status="cancelled")

    monkeypatch.setattr(cancellation, "runtime_access", runtime_access)
    monkeypatch.setattr(cancellation, "get_workflow_run", get_run)
    monkeypatch.setattr(cancellation, "put_workflow_run", put_run)
    monkeypatch.setattr(cancellation, "cancel_workflow_run", cancel_run)
    await cancellation.run_cancel_task(
        factory,
        invocation_id=invocation_id,
        generation=1,
    )
    await cancellation.run_cancel_task(
        factory,
        invocation_id=invocation_id,
        generation=1,
    )
    assert calls == {"get": 1, "put": 1, "cancel": 1}
    async with factory() as db:
        settled = await managed_store.get_managed_execution(
            db,
            invocation_id=invocation_id,
        )
        assert settled is not None
        assert settled.delivery_checkpoint == "accepted"
        assert settled.execution_status == "cancelled"
