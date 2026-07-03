"""Cloud-lane delivery + refresh tests (spec 3.2).

Delivery/refresh talk to sandbox anyharness through the gateway. The tests patch
``ensure_cloud_sandbox_gateway_access`` (no live wake) and swap the module's
``_delivery_client`` factory for an ``httpx.MockTransport`` so the real request/
response handling in the module is exercised end to end.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workflows as store
from proliferate.integrations.anyharness import workflow_runs as runtime_workflow_runs
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.gateway.service import CloudSandboxGatewayAccess
from proliferate.server.cloud.workflows import delivery, service
from proliferate.server.cloud.workflows.models import WorkflowCreateRequest

pytestmark = pytest.mark.asyncio


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"wf-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


def _definition() -> dict:
    return {
        "setup": {"harness": "claude", "model": "sonnet", "session_binding": "fresh"},
        "steps": [{"kind": "agent.prompt", "prompt": "do the thing"}],
    }


async def _make_workflow(db: AsyncSession, user: User):
    workflow, _versions = await service.create_workflow(
        db, user, WorkflowCreateRequest(name="cloud-wf", definition=_definition())
    )
    return workflow


async def _make_cloud_run(
    db: AsyncSession,
    user: User,
    *,
    anyharness_workspace_id: str | None = "sandbox-ws-1",
):
    workflow = await _make_workflow(db, user)
    assert workflow.current_version_id is not None
    return await store.create_run(
        db,
        workflow_id=workflow.id,
        workflow_version_id=workflow.current_version_id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="personal_cloud",
        resolved_plan_json={"run_id": "x", "steps": []},
        anyharness_workspace_id=anyharness_workspace_id,
    )


async def _make_ready_cloud_workspace(
    db: AsyncSession, user: User, *, anyharness_workspace_id: str | None
) -> CloudWorkspace:
    repo_config = RepoConfig(
        user_id=user.id,
        git_provider="github",
        git_owner="acme",
        git_repo_name="widgets",
    )
    db.add(repo_config)
    await db.flush()
    repo_environment = RepoEnvironment(
        repo_config_id=repo_config.id,
        environment_kind="cloud",
        local_path=None,
    )
    db.add(repo_environment)
    await db.flush()
    workspace = CloudWorkspace(
        owner_user_id=user.id,
        repo_environment_id=repo_environment.id,
        display_name="widgets",
        git_branch="feature/x",
        anyharness_workspace_id=anyharness_workspace_id,
    )
    db.add(workspace)
    await db.flush()
    return workspace


def _patch_gateway(monkeypatch: pytest.MonkeyPatch, *, raises: Exception | None = None) -> None:
    async def _access(*_args: object, **_kwargs: object) -> CloudSandboxGatewayAccess:
        if raises is not None:
            raise raises
        return CloudSandboxGatewayAccess(
            upstream_base_url="https://sandbox.test",
            upstream_token="sandbox-token",
            runtime_generation=1,
        )

    monkeypatch.setattr(delivery, "ensure_cloud_sandbox_gateway_access", _access)


def _patch_client(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def _recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    def _factory(base_url: str, token: str, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"authorization": f"Bearer {token}"},
            timeout=timeout,
            transport=httpx.MockTransport(_recording),
        )

    # Patch the integration boundary's client factory so the real request/response
    # mapping in ``integrations.anyharness.workflow_runs`` is exercised.
    monkeypatch.setattr(runtime_workflow_runs, "_client", _factory)
    return seen


# --- delivery ------------------------------------------------------------------


async def test_deliver_cloud_run_marks_delivered_on_202(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    _patch_gateway(monkeypatch)
    seen = _patch_client(
        monkeypatch,
        lambda request: httpx.Response(202, json={"runId": str(run.id), "status": "running"}),
    )

    delivered = await delivery.deliver_cloud_run(db_session, user, run)

    assert delivered.status == "delivered"
    assert delivered.delivered_at is not None
    assert delivered.error_code is None
    # The plan + resolved sandbox workspace id travelled in the body.
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "POST"
    assert request.url.path == "/v1/workflow-runs"
    import json

    body = json.loads(request.content)
    assert body["workspaceId"] == "sandbox-ws-1"
    assert body["plan"] == run.resolved_plan_json


async def test_deliver_cloud_run_records_failure_on_wake_error(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    _patch_gateway(
        monkeypatch,
        raises=CloudApiError("cloud_sandbox_missing", "no sandbox", status_code=409),
    )
    _patch_client(monkeypatch, lambda request: httpx.Response(202))

    result = await delivery.deliver_cloud_run(db_session, user, run)

    # Non-terminal so it stays retryable; carries the typed marker.
    assert result.status == "pending_delivery"
    assert result.error_code == "delivery_failed"
    assert "no sandbox" in (result.error_message or "")


async def test_deliver_cloud_run_records_failure_on_transport_error(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    _patch_gateway(monkeypatch)

    def _boom(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    _patch_client(monkeypatch, _boom)

    result = await delivery.deliver_cloud_run(db_session, user, run)
    assert result.status == "pending_delivery"
    assert result.error_code == "delivery_failed"


async def test_deliver_cloud_run_rejected_status_is_failure(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda request: httpx.Response(400, json={"detail": "bad plan"}))

    result = await delivery.deliver_cloud_run(db_session, user, run)
    assert result.status == "pending_delivery"
    assert result.error_code == "delivery_failed"


async def test_deliver_cloud_run_is_idempotent(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    _patch_gateway(monkeypatch)
    seen = _patch_client(
        monkeypatch, lambda request: httpx.Response(202, json={"status": "running"})
    )

    first = await delivery.deliver_cloud_run(db_session, user, run)
    assert first.status == "delivered"
    # Re-delivering an already-delivered run is a no-op: no second POST, still delivered.
    second = await delivery.deliver_cloud_run(db_session, user, first)
    assert second.status == "delivered"
    assert second.delivered_at == first.delivered_at
    assert len(seen) == 1


async def test_redeliver_clears_prior_failure(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    _patch_gateway(monkeypatch)

    calls = {"n": 0}

    def _handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(202, json={"status": "running"})

    _patch_client(monkeypatch, _handler)

    failed = await delivery.deliver_cloud_run(db_session, user, run)
    assert failed.error_code == "delivery_failed"
    # Retry from the failed-but-pending state lands and clears the marker.
    retried = await delivery.deliver_cloud_run(db_session, user, failed)
    assert retried.status == "delivered"
    assert retried.error_code is None


async def test_deliver_rejects_local_run(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    assert workflow.current_version_id is not None
    local = await store.create_run(
        db_session,
        workflow_id=workflow.id,
        workflow_version_id=workflow.current_version_id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={"steps": []},
    )
    with pytest.raises(CloudApiError) as exc:
        await delivery.deliver_cloud_run(db_session, user, local)
    assert exc.value.code == "delivery_not_supported"


# --- refresh -------------------------------------------------------------------


async def test_refresh_syncs_running_snapshot(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    await service.mark_run_delivered(db_session, user, run.id)
    _patch_gateway(monkeypatch)
    _patch_client(
        monkeypatch,
        lambda request: httpx.Response(
            200,
            json={
                "runId": str(run.id),
                "status": "running",
                "stepCursor": 1,
                "sessionIds": ["sess-1"],
                "workspaceId": "sandbox-ws-1",
                "steps": [
                    {
                        "stepIndex": 0,
                        "kind": "agent.prompt",
                        "status": "completed",
                        "output": {"session_id": "sess-1"},
                    }
                ],
            },
        ),
    )

    run = await service.get_run(db_session, user, run.id)
    synced = await delivery.refresh_cloud_run(db_session, user, run)

    assert synced.status == "running"
    assert synced.step_cursor == 1
    assert synced.started_at is not None
    assert synced.anyharness_session_ids == ["sess-1"]
    assert synced.step_outputs_json == {"0": {"session_id": "sess-1"}}


async def test_refresh_syncs_terminal_snapshot(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    await service.mark_run_delivered(db_session, user, run.id)
    _patch_gateway(monkeypatch)
    _patch_client(
        monkeypatch,
        lambda request: httpx.Response(
            200, json={"runId": str(run.id), "status": "completed", "stepCursor": 1}
        ),
    )

    run = await service.get_run(db_session, user, run.id)
    synced = await delivery.refresh_cloud_run(db_session, user, run)
    assert synced.status == "completed"
    assert synced.finished_at is not None


async def test_refresh_noop_on_terminal_run(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    await service.mark_run_delivered(db_session, user, run.id)
    from proliferate.server.cloud.workflows.models import RunStatusRequest

    await service.report_run_status(db_session, user, run.id, RunStatusRequest(status="running"))
    await service.report_run_status(db_session, user, run.id, RunStatusRequest(status="failed"))

    called = {"n": 0}

    def _handler(_request: httpx.Request) -> httpx.Response:
        called["n"] += 1
        return httpx.Response(200, json={"status": "running"})

    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, _handler)

    run = await service.get_run(db_session, user, run.id)
    synced = await delivery.refresh_cloud_run(db_session, user, run)
    # Terminal on the server: refresh short-circuits before any sandbox read.
    assert synced.status == "failed"
    assert called["n"] == 0


async def test_refresh_ignores_unknown_sandbox_run(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    await service.mark_run_delivered(db_session, user, run.id)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda request: httpx.Response(404))

    run = await service.get_run(db_session, user, run.id)
    synced = await delivery.refresh_cloud_run(db_session, user, run)
    # 404 = sandbox has no such run yet; ledger left untouched (still delivered).
    assert synced.status == "delivered"


async def test_refresh_rejects_local_run(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    assert workflow.current_version_id is not None
    local = await store.create_run(
        db_session,
        workflow_id=workflow.id,
        workflow_version_id=workflow.current_version_id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={"steps": []},
    )
    with pytest.raises(CloudApiError) as exc:
        await delivery.refresh_cloud_run(db_session, user, local)
    assert exc.value.code == "refresh_not_supported"


# --- StartRun target workspace validation --------------------------------------


async def test_start_run_cloud_requires_target_workspace(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
            db_session, user, workflow.id, args={}, target_mode="personal_cloud"
        )
    assert exc.value.code == "target_workspace_required"
    assert exc.value.status_code == 400


async def test_start_run_cloud_rejects_unowned_workspace(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    other = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    foreign_ws = await _make_ready_cloud_workspace(
        db_session, other, anyharness_workspace_id="sandbox-ws-x"
    )
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
            db_session,
            user,
            workflow.id,
            args={},
            target_mode="personal_cloud",
            target_workspace_id=foreign_ws.id,
        )
    assert exc.value.code == "target_workspace_not_found"
    assert exc.value.status_code == 404


async def test_start_run_cloud_rejects_unmaterialized_workspace(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(db_session, user, anyharness_workspace_id=None)
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
            db_session,
            user,
            workflow.id,
            args={},
            target_mode="personal_cloud",
            target_workspace_id=workspace.id,
        )
    assert exc.value.code == "target_workspace_not_ready"
    assert exc.value.status_code == 409


async def test_start_run_cloud_stamps_sandbox_workspace_id(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id="sandbox-ws-9"
    )
    run = await service.start_run(
        db_session,
        user,
        workflow.id,
        args={},
        target_mode="personal_cloud",
        target_workspace_id=workspace.id,
    )
    assert run.status == "pending_delivery"
    assert run.anyharness_workspace_id == "sandbox-ws-9"
