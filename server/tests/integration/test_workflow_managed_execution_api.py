"""Managed Workflow API/outbox contracts over real PostgreSQL."""

from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.store import workflow_managed_delivery as delivery_store
from proliferate.db.store import workflow_managed_projection as projection_store
from tests.integration.cloud_api_helpers import register_and_login


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _definition() -> dict[str, object]:
    return {
        "title": "Managed run",
        "description": "",
        "defaultRepoConfigId": None,
        "inputs": [{"name": "ticket", "type": "string", "required": True}],
        "stages": [
            {
                "harnessConfig": {"agentKind": "claude", "modelId": None, "effort": None},
                "steps": [
                    {
                        "kind": "agent.prompt",
                        "prompt": "Investigate {{inputs.ticket}}",
                        "goal": None,
                    }
                ],
            }
        ],
    }


async def _create_invocation(
    client: AsyncClient,
    tokens: dict[str, str],
) -> tuple[str, str]:
    definition = await client.post(
        "/v1/workflows",
        headers=_headers(tokens),
        json=_definition(),
    )
    invocation_id = str(uuid4())
    invocation = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(tokens),
        json={
            "schemaVersion": 1,
            "workflowDefinitionId": definition.json()["id"],
            "expectedRevision": 1,
            "arguments": {"ticket": "PROL-123"},
            "target": {"kind": "managedCloud"},
        },
    )
    assert invocation.status_code == 201
    return definition.json()["id"], invocation_id


@pytest.mark.asyncio
async def test_gate_off_blocks_only_new_delivery(
    client: AsyncClient,
) -> None:
    owner = await register_and_login(client, "managed-gate@example.com")
    _definition_id, invocation_id = await _create_invocation(client, owner)
    delivery = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/deliver",
        headers=_headers(owner),
    )
    assert delivery.status_code == 503
    assert delivery.json()["detail"]["code"] == "workflow_managed_runs_unavailable"
    detail = await client.get(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
    )
    assert detail.status_code == 200
    assert detail.json()["managedExecution"]["deliveryStatus"] == "prepared"
    cancelled = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/cancel",
        headers=_headers(owner),
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["managedExecution"]["deliveryStatus"] == "delivery_cancelled"


@pytest.mark.asyncio
async def test_concurrent_deliver_commits_one_logical_outbox_task(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-deliver@example.com")
    definition_id, invocation_id = await _create_invocation(client, owner)
    results = await asyncio.gather(
        client.post(
            f"/v1/workflow-invocations/{invocation_id}/deliver",
            headers=_headers(owner),
        ),
        client.post(
            f"/v1/workflow-invocations/{invocation_id}/deliver",
            headers=_headers(owner),
        ),
    )
    assert [result.status_code for result in results] == [200, 200]
    assert all(
        result.json()["managedExecution"]["deliveryStatus"] == "queued" for result in results
    )
    count = await db_session.scalar(
        select(func.count())
        .select_from(BackgroundOutboxTask)
        .where(BackgroundOutboxTask.idempotency_key == f"workflow:deliver:{invocation_id}:1")
    )
    assert count == 1
    history = await client.get(
        "/v1/workflow-invocations",
        params={"workflowDefinitionId": definition_id},
        headers=_headers(owner),
    )
    assert history.status_code == 200
    assert [item["id"] for item in history.json()["items"]] == [invocation_id]
    assert history.json()["nextCursor"] is None


@pytest.mark.asyncio
async def test_checkpoint_store_rejects_skip_regress_and_custody_overwrite(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-cas@example.com")
    _definition_id, invocation_id_text = await _create_invocation(client, owner)
    invocation_id = UUID(invocation_id_text)
    await client.post(
        f"/v1/workflow-invocations/{invocation_id}/deliver",
        headers=_headers(owner),
    )
    skipped = await delivery_store.advance_delivery(
        db_session,
        invocation_id=invocation_id,
        expected_generation=1,
        expected_checkpoint="none",
        next_checkpoint="workspace_ready",
    )
    assert skipped is None
    sandbox_id = uuid4()
    plan = {"kind": "scratch", "cloudSandboxId": str(sandbox_id)}
    frozen = await delivery_store.advance_delivery(
        db_session,
        invocation_id=invocation_id,
        expected_generation=1,
        expected_checkpoint="none",
        next_checkpoint="target_plan_frozen",
        target_plan_json=plan,
        target_cloud_sandbox_id=sandbox_id,
    )
    assert frozen is not None
    overwritten = await delivery_store.advance_delivery(
        db_session,
        invocation_id=invocation_id,
        expected_generation=2,
        expected_checkpoint="target_plan_frozen",
        next_checkpoint="target_bound",
        target_plan_json={"kind": "scratch", "cloudSandboxId": str(uuid4())},
        target_execution_store_id="store-a",
    )
    assert overwritten is None
    missing_store = await delivery_store.advance_delivery(
        db_session,
        invocation_id=invocation_id,
        expected_generation=2,
        expected_checkpoint="target_plan_frozen",
        next_checkpoint="target_bound",
    )
    assert missing_store is None


@pytest.mark.asyncio
async def test_stale_observer_cannot_mark_recovered_target_lost(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workflow_managed_runs_enabled", True)
    owner = await register_and_login(client, "managed-target-cas@example.com")
    _definition_id, invocation_id_text = await _create_invocation(client, owner)
    invocation_id = UUID(invocation_id_text)
    await client.post(
        f"/v1/workflow-invocations/{invocation_id}/deliver",
        headers=_headers(owner),
    )
    sandbox_id = uuid4()
    cloud_workspace_id = uuid4()
    transitions = [
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
    ]
    for generation, current, successor, values in transitions:
        assert (
            await delivery_store.advance_delivery(
                db_session,
                invocation_id=invocation_id,
                expected_generation=generation,
                expected_checkpoint=current,
                next_checkpoint=successor,
                **values,
            )
            is not None
        )
    accepted = await delivery_store.mark_delivery_accepted(
        db_session,
        invocation_id=invocation_id,
        expected_generation=6,
        projection={
            "id": str(invocation_id),
            "status": "running",
            "stateVersion": 1,
            "workspaceId": "workspace-a",
            "steps": [],
        },
    )
    assert accepted is not None
    recovered = await projection_store.mark_observation_unreachable(
        db_session,
        invocation_id=invocation_id,
        expected_generation=1,
        error_code="temporary",
    )
    assert recovered is not None
    stale_loss = await projection_store.mark_target_lost(
        db_session,
        invocation_id=invocation_id,
        operation="observe",
        expected_generation=1,
        expected_cloud_sandbox_id=sandbox_id,
        expected_execution_store_id="store-a",
        error_code="stale",
    )
    assert stale_loss is None
