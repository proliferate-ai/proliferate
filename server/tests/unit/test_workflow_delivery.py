"""Feature-off delivery/report/control boundary tests plus shared factories."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workflows as store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import delivery, service
from proliferate.server.cloud.workflows import api as workflow_api
from proliferate.server.cloud.workflows.access import RunTokenActor
from proliferate.server.cloud.workflows.models import RunStatusRequest, WorkflowCreateRequest

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
        "version": 1,
        "inputs": [],
        "integrations": [],
        "agents": [
            {
                "slot": "main",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "do the thing"}],
            }
        ],
    }


async def _make_workflow(db: AsyncSession, user: User):  # type: ignore[no-untyped-def]
    workflow, _versions = await service.create_workflow(
        db, user, WorkflowCreateRequest(name="cloud-wf", definition=_definition())
    )
    return workflow


async def _make_cloud_run(
    db: AsyncSession,
    user: User,
    *,
    anyharness_workspace_id: str | None = "sandbox-ws-1",
):  # type: ignore[no-untyped-def]
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


def _snapshot(run) -> tuple[object, ...]:  # type: ignore[no-untyped-def]
    return (
        run.status,
        run.step_cursor,
        run.step_outputs_json,
        run.error_code,
        run.error_message,
        run.delivered_at,
        run.started_at,
        run.finished_at,
    )


async def _assert_parked(call, db: AsyncSession, run) -> None:  # type: ignore[no-untyped-def]
    before = _snapshot(run)
    with pytest.raises(CloudApiError) as caught:
        await call()
    assert caught.value.code == delivery.ACTIVATION_UNAVAILABLE_CODE
    reread = await store.get_run(db, run.id)
    assert reread is not None
    assert _snapshot(reread) == before


async def test_all_legacy_execution_surfaces_share_one_zero_mutation_gate(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    run = await _make_cloud_run(db_session, user)
    body = RunStatusRequest(status="running")
    calls = [
        lambda: workflow_api.redeliver_run_endpoint(run.id, db_session, user),
        lambda: workflow_api.refresh_run_endpoint(run.id, db_session, user),
        lambda: workflow_api.cancel_run_endpoint(run.id, db_session, user),
        lambda: workflow_api.run_ping_endpoint(run.id, db_session, RunTokenActor(id=user.id)),
        lambda: workflow_api.mark_run_delivered_endpoint(run.id, db_session, user),
        lambda: workflow_api.report_run_status_endpoint(run.id, body, db_session, user),
    ]
    for call in calls:
        await _assert_parked(call, db_session, run)


async def test_feature_off_module_has_no_runtime_network_dependencies() -> None:
    assert not hasattr(delivery, "ensure_cloud_sandbox_gateway_access")
    assert not hasattr(delivery, "deliver_workflow_run")
    assert not hasattr(delivery, "read_workflow_run")
    assert not hasattr(delivery, "cancel_workflow_run")
