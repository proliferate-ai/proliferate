"""Workflow trigger CRUD + scheduler-tick tests (spec 3.5).

CRUD runs on the rollback-scoped ``db_session``. The scheduler tick opens its own
sessions (it is a worker, not a request), so those tests commit their setup through
a committing ``session_factory`` and rely on the autouse table truncation for
isolation. Cloud delivery is mocked exactly as the delivery suite does — patch the
gateway access + swap the runtime client for an ``httpx.MockTransport``.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.workflows import (
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.integrations.anyharness import workflow_runs as runtime_workflow_runs
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.gateway.service import CloudSandboxGatewayAccess
from proliferate.server.cloud.workflows import delivery, scheduler, service
from proliferate.server.cloud.workflows.models import (
    TriggerScheduleRequest,
    WorkflowCreateRequest,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerUpdateRequest,
)
from proliferate.utils.time import utcnow

pytestmark = pytest.mark.asyncio

_HOURLY = "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0"
_DAILY_9 = "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0"


# --- fixtures / helpers --------------------------------------------------------


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


def _definition(*, required_arg: bool = False) -> dict:
    args = [{"name": "issue", "type": "string", "required": required_arg}]
    return {
        "args": args,
        "setup": {"harness": "claude", "model": "sonnet", "session_binding": "fresh"},
        "steps": [{"kind": "agent.prompt", "prompt": "Fix {{args.issue}}"}],
    }


async def _make_workflow(db: AsyncSession, user: User, *, required_arg: bool = False):
    workflow, _ = await service.create_workflow(
        db,
        user,
        WorkflowCreateRequest(name="wf", definition=_definition(required_arg=required_arg)),
    )
    return workflow


async def _make_ready_cloud_workspace(
    db: AsyncSession, user: User, *, anyharness_workspace_id: str | None = "sandbox-ws-1"
) -> CloudWorkspace:
    repo_config = RepoConfig(
        user_id=user.id, git_provider="github", git_owner="acme", git_repo_name="widgets"
    )
    db.add(repo_config)
    await db.flush()
    repo_environment = RepoEnvironment(
        repo_config_id=repo_config.id, environment_kind="cloud", local_path=None
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


def _create_body(
    workspace_id: uuid.UUID | None,
    *,
    target_mode: str = "personal_cloud",
    concurrency: str = "skip",
    rrule: str = _HOURLY,
    timezone: str = "UTC",
    args: dict | None = None,
) -> WorkflowTriggerCreateRequest:
    return WorkflowTriggerCreateRequest(
        concurrencyPolicy=concurrency,  # type: ignore[call-arg]
        targetMode=target_mode,  # type: ignore[call-arg]
        targetWorkspaceId=workspace_id,  # type: ignore[call-arg]
        schedule=TriggerScheduleRequest(rrule=rrule, timezone=timezone),
        args=args or {},
    )


@pytest.fixture
def session_factory(test_engine):  # type: ignore[no-untyped-def]
    return async_sessionmaker(test_engine, expire_on_commit=False)


def _patch_gateway(monkeypatch: pytest.MonkeyPatch, *, raises: Exception | None = None) -> None:
    async def _access(*_a: object, **_k: object) -> CloudSandboxGatewayAccess:
        if raises is not None:
            raise raises
        return CloudSandboxGatewayAccess(
            upstream_base_url="https://sandbox.test",
            upstream_token="sandbox-token",
            runtime_generation=1,
        )

    monkeypatch.setattr(delivery, "ensure_cloud_sandbox_gateway_access", _access)


def _patch_client(
    monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]
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

    monkeypatch.setattr(runtime_workflow_runs, "_client", _factory)
    return seen


# --- CRUD ----------------------------------------------------------------------


async def test_create_schedule_trigger_cloud(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(db_session, user)

    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(workspace.id, concurrency="queue")
    )

    assert trigger.kind == WORKFLOW_TRIGGER_KIND_SCHEDULE
    assert trigger.concurrency_policy == "queue"
    assert trigger.target_mode == "personal_cloud"
    assert trigger.target_workspace_id == workspace.id
    assert trigger.schedule_rrule == _HOURLY
    assert trigger.schedule_summary  # a human summary was computed
    # Cursor math: the first fire is strictly in the future.
    assert trigger.next_run_at is not None
    assert trigger.next_run_at > utcnow()


async def test_create_rejects_local_schedule(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(
            db_session, user, workflow.id, _create_body(None, target_mode="local")
        )
    assert exc.value.code == "schedule_local_unsupported"
    assert exc.value.status_code == 400


async def test_create_rejects_bad_rrule(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(
            db_session,
            user,
            workflow.id,
            _create_body(workspace.id, rrule="RRULE:FREQ=SECONDLY;INTERVAL=1"),
        )
    assert exc.value.code == "invalid_schedule"


async def test_create_rejects_missing_required_arg(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user, required_arg=True)
    workspace = await _make_ready_cloud_workspace(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(
            db_session, user, workflow.id, _create_body(workspace.id, args={})
        )
    assert exc.value.code == "missing_argument"


async def test_create_covers_required_arg(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user, required_arg=True)
    workspace = await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(workspace.id, args={"issue": "PROJ-1"})
    )
    assert trigger.args_json == {"issue": "PROJ-1"}


async def test_create_requires_cloud_workspace(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(db_session, user, workflow.id, _create_body(None))
    assert exc.value.code == "target_workspace_required"


async def test_create_rejects_unowned_workspace(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    other = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    foreign_ws = await _make_ready_cloud_workspace(db_session, other)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(db_session, user, workflow.id, _create_body(foreign_ws.id))
    assert exc.value.code == "target_workspace_not_found"


async def test_update_args_only_keeps_cursor(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(workspace.id, concurrency="skip")
    )
    original_next = trigger.next_run_at

    updated = await service.update_trigger(
        db_session,
        user,
        workflow.id,
        trigger.id,
        WorkflowTriggerUpdateRequest(concurrencyPolicy="queue"),  # type: ignore[call-arg]
    )
    assert updated.concurrency_policy == "queue"
    # An edit that leaves the schedule alone must not shift the cursor.
    assert updated.next_run_at == original_next


async def test_update_schedule_recomputes_cursor(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(workspace.id, rrule=_HOURLY)
    )
    updated = await service.update_trigger(
        db_session,
        user,
        workflow.id,
        trigger.id,
        WorkflowTriggerUpdateRequest(
            schedule=TriggerScheduleRequest(rrule=_DAILY_9, timezone="UTC")
        ),
    )
    assert updated.schedule_rrule == _DAILY_9
    assert updated.next_run_at is not None
    assert updated.next_run_at > utcnow()


async def test_delete_trigger(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(workspace.id)
    )
    await service.delete_trigger(db_session, user, workflow.id, trigger.id)
    assert await trigger_store.get_trigger(db_session, trigger.id) is None


async def test_trigger_visibility_isolation(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    other = await _make_user(db_session)
    workflow = await _make_workflow(db_session, owner)
    workspace = await _make_ready_cloud_workspace(db_session, owner)
    trigger = await service.create_trigger(
        db_session, owner, workflow.id, _create_body(workspace.id)
    )
    with pytest.raises(CloudApiError) as exc:
        await service.get_trigger(db_session, other, workflow.id, trigger.id)
    assert exc.value.code == "workflow_not_found"


# --- scheduler tick ------------------------------------------------------------


async def _seed_trigger(session_factory, *, concurrency: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Create user/workspace/workflow/trigger (committed) and return (trigger_id, wf_id)."""
    async with session_factory() as db, db.begin():
        user = await _make_user(db)
        workflow = await _make_workflow(db, user)
        workspace = await _make_ready_cloud_workspace(db, user)
        trigger = await service.create_trigger(
            db,
            user,
            workflow.id,
            _create_body(workspace.id, concurrency=concurrency, args={"issue": "seed"}),
        )
    return trigger.id, workflow.id


async def _make_due(session_factory, trigger_id: uuid.UUID) -> None:
    async with session_factory() as db, db.begin():
        await trigger_store.update_trigger(
            db, trigger_id=trigger_id, next_run_at=utcnow() - timedelta(minutes=1)
        )


async def _runs_for_trigger(session_factory, trigger_id: uuid.UUID) -> list:
    async with session_factory() as db:
        pending = await store.list_pending_scheduled_cloud_runs(db, limit=100)
    return [r for r in pending if r.trigger_id == trigger_id]


async def test_tick_fires_due_trigger_and_delivers(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 1
    assert result.delivered_runs == 1
    assert len(seen) == 1  # exactly one sandbox wake + deliver
    # The trigger advanced its cursor to a fresh future slot and cleared skip.
    async with session_factory() as db:
        trigger = await trigger_store.get_trigger(db, trigger_id)
    assert trigger is not None
    assert trigger.next_run_at is not None and trigger.next_run_at > utcnow()
    assert trigger.last_scheduled_at is not None
    assert trigger.last_skip_reason is None


async def test_tick_skip_policy_records_skip(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    # A prior run of this trigger is still running (non-terminal).
    async with session_factory() as db, db.begin():
        workflow = await store.get_workflow(db, workflow_id)
        assert workflow is not None and workflow.current_version_id is not None
        prior = await store.create_run(
            db,
            workflow_id=workflow_id,
            workflow_version_id=workflow.current_version_id,
            trigger_kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
            executor_user_id=workflow.owner_user_id,
            args_json={},
            target_mode="personal_cloud",
            resolved_plan_json={"steps": []},
            anyharness_workspace_id="sandbox-ws-1",
            trigger_id=trigger_id,
            scheduled_for=utcnow() - timedelta(hours=2),
        )
        await store.update_run(db, run_id=prior.id, status=WORKFLOW_RUN_STATUS_RUNNING)
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 0  # the slot was skipped
    assert len(seen) == 0  # nothing delivered (the running prior isn't pending)
    async with session_factory() as db:
        trigger = await trigger_store.get_trigger(db, trigger_id)
    assert trigger is not None
    assert trigger.last_skipped_at is not None
    assert trigger.last_skip_reason  # concurrency reason recorded
    assert trigger.next_run_at is not None and trigger.next_run_at > utcnow()


async def test_tick_disables_trigger_when_workflow_archived(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A due schedule trigger whose workflow was archived is disabled cleanly.

    Regression: disabling must NOT null out next_run_at — the
    ck_workflow_trigger_schedule_fields CHECK requires a schedule trigger to always
    carry a cursor, so nulling it raised an IntegrityError that aborted the whole
    beat. Disabling via enabled=False alone stops scheduling.
    """
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    async with session_factory() as db, db.begin():
        await store.archive_workflow(db, workflow_id)
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202))

    # Must not raise (previously an IntegrityError from a NULL next_run_at).
    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 0
    assert result.delivered_runs == 0
    assert len(seen) == 0
    async with session_factory() as db:
        trigger = await trigger_store.get_trigger(db, trigger_id)
    assert trigger is not None
    assert trigger.enabled is False  # disabled -> no longer scheduled
    assert trigger.next_run_at is not None  # cursor preserved (CHECK invariant)
    assert trigger.last_skip_reason == "Workflow was archived."
    # A disabled trigger is no longer selected as due, so a second tick is a no-op.
    again = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert again.created_runs == 0 and again.delivered_runs == 0


async def test_tick_queue_policy_defers_then_delivers(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="queue")
    # A prior run of this trigger is still running — queue must create the new run
    # but hold its delivery.
    async with session_factory() as db, db.begin():
        workflow = await store.get_workflow(db, workflow_id)
        assert workflow is not None and workflow.current_version_id is not None
        prior = await store.create_run(
            db,
            workflow_id=workflow_id,
            workflow_version_id=workflow.current_version_id,
            trigger_kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
            executor_user_id=workflow.owner_user_id,
            args_json={},
            target_mode="personal_cloud",
            resolved_plan_json={"steps": []},
            anyharness_workspace_id="sandbox-ws-1",
            trigger_id=trigger_id,
            scheduled_for=utcnow() - timedelta(hours=2),
        )
        await store.update_run(db, run_id=prior.id, status=WORKFLOW_RUN_STATUS_RUNNING)
        prior_id = prior.id
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    # Tick 1: queue creates the run but defers delivery behind the running prior.
    first = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert first.created_runs == 1
    assert first.delivered_runs == 0
    assert len(seen) == 0
    queued = await _runs_for_trigger(session_factory, trigger_id)
    assert len(queued) == 1
    assert queued[0].status == WORKFLOW_RUN_STATUS_PENDING_DELIVERY

    # The prior run finishes -> the queued run becomes deliverable.
    async with session_factory() as db, db.begin():
        await store.update_run(db, run_id=prior_id, status="completed", finished_at=utcnow())

    # Tick 2: no new slot is due, but the deferred run now delivers.
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 0
    assert second.delivered_runs == 1
    assert len(seen) == 1
    remaining = await _runs_for_trigger(session_factory, trigger_id)
    assert remaining == []  # delivered, no longer pending
