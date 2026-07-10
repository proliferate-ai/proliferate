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
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.workflows import (
    WORKFLOW_LOCAL_CLAIM_TTL_SECONDS,
    WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
    WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL,
    WORKFLOW_RUN_ERROR_BUDGET_BLOCKED,
    WORKFLOW_RUN_STATUS_CLAIMABLE,
    WORKFLOW_RUN_STATUS_CLAIMED,
    WORKFLOW_RUN_STATUS_COMPLETED,
    WORKFLOW_RUN_STATUS_FAILED,
    WORKFLOW_RUN_STATUS_MISSED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_RUN_TERMINAL_STATUSES,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
)
from proliferate.server.automations.domain.schedule import latest_due_occurrence
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.integrations.anyharness import workflow_runs as runtime_workflow_runs
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.gateway.service import CloudSandboxGatewayAccess
from proliferate.db.models.cloud.workflows import WorkflowRunGatewayToken
from proliferate.server.cloud.workflows import delivery, local_executor, scheduler, service
from proliferate.server.cloud.workflows.models import (
    LocalWorkflowClaimActionRequest,
    LocalWorkflowClaimRequest,
    RunStatusRequest,
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
    return {
        "version": 1,
        "inputs": [{"name": "issue", "type": "text", "required": required_arg}],
        "integrations": [],
        "agents": [
            {
                "slot": "main",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "Fix {{inputs.issue}}"}],
            }
        ],
    }


async def _make_workflow(db: AsyncSession, user: User, *, required_arg: bool = False):
    workflow, _ = await service.create_workflow(
        db,
        user,
        WorkflowCreateRequest(name="wf", definition=_definition(required_arg=required_arg)),
    )
    return workflow


_REPO = "acme/widgets"


async def _make_cloud_repo_environment(
    db: AsyncSession,
    user: User,
    *,
    git_owner: str = "acme",
    git_repo_name: str = "widgets",
) -> RepoEnvironment:
    """A cloud repo environment for the derivation path (D16): the trigger pins a
    repo, the service resolves its cloud environment and provisions a workspace."""

    repo_config = RepoConfig(
        user_id=user.id, git_provider="github", git_owner=git_owner, git_repo_name=git_repo_name
    )
    db.add(repo_config)
    await db.flush()
    repo_environment = RepoEnvironment(
        repo_config_id=repo_config.id, environment_kind="cloud", local_path=None
    )
    db.add(repo_environment)
    await db.flush()
    return repo_environment


async def _make_ready_cloud_workspace(
    db: AsyncSession, user: User, *, anyharness_workspace_id: str | None = "sandbox-ws-1"
) -> CloudWorkspace:
    repo_environment = await _make_cloud_repo_environment(db, user)
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
    repo_full_name: str | None = _REPO,
    *,
    target_mode: str = "personal_cloud",
    concurrency: str = "skip",
    missed_run_policy: str = WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
    rrule: str = _HOURLY,
    timezone: str = "UTC",
    args: dict | None = None,
    enabled: bool = True,
) -> WorkflowTriggerCreateRequest:
    return WorkflowTriggerCreateRequest(
        concurrencyPolicy=concurrency,  # type: ignore[call-arg]
        missedRunPolicy=missed_run_policy,  # type: ignore[call-arg]
        targetMode=target_mode,  # type: ignore[call-arg]
        repoFullName=repo_full_name,  # type: ignore[call-arg]
        enabled=enabled,
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
        db_session, user, workflow.id, _create_body(concurrency="queue")
    )

    assert trigger.kind == WORKFLOW_TRIGGER_KIND_SCHEDULE
    assert trigger.concurrency_policy == "queue"
    assert trigger.target_mode == "personal_cloud"
    # D16: repo is authored; the workspace is derived (reuses the repo's workspace).
    assert trigger.repo_full_name == _REPO
    assert trigger.target_workspace_id == workspace.id
    assert trigger.schedule_rrule == _HOURLY
    assert trigger.schedule_summary  # a human summary was computed
    # Cursor math: the first fire is strictly in the future.
    assert trigger.next_run_at is not None
    assert trigger.next_run_at > utcnow()


async def test_create_local_schedule_requires_repo_pin(db_session: AsyncSession) -> None:
    """L15 is lifted for local schedule (see the 2a tests below), but the D16 repo
    pin is still required — a local schedule trigger with no repo is rejected at the
    CHECK-mirroring validation, not silently accepted."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(
            db_session, user, workflow.id, _create_body(None, target_mode="local")
        )
    assert exc.value.code == "invalid_repo"
    assert exc.value.status_code == 400


async def test_create_rejects_bad_rrule(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    await _make_ready_cloud_workspace(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(
            db_session,
            user,
            workflow.id,
            _create_body(rrule="RRULE:FREQ=SECONDLY;INTERVAL=1"),
        )
    assert exc.value.code == "invalid_schedule"


async def test_create_enabled_rejects_missing_required_preset(db_session: AsyncSession) -> None:
    """D16 enable-gate: an enabled schedule can't ship a required input unpresetted."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user, required_arg=True)
    await _make_ready_cloud_workspace(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(
            db_session, user, workflow.id, _create_body(args={}, enabled=True)
        )
    assert exc.value.code == "schedule_presets_incomplete"


async def test_create_disabled_allows_missing_required_preset(db_session: AsyncSession) -> None:
    """A disabled draft may leave required presets blank; only enabling is gated."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user, required_arg=True)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(args={}, enabled=False)
    )
    assert trigger.enabled is False
    assert trigger.input_presets_json == {}


async def test_create_covers_required_arg(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user, required_arg=True)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(args={"issue": "PROJ-1"})
    )
    assert trigger.args_json == {"issue": "PROJ-1"}
    # The presets back the enable-gate and mirror the fire-time args for schedule.
    assert trigger.input_presets_json == {"issue": "PROJ-1"}


async def test_create_requires_repo(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(db_session, user, workflow.id, _create_body(None))
    assert exc.value.code == "invalid_repo"


async def test_create_rejects_unconfigured_repo(db_session: AsyncSession) -> None:
    """A repo the user hasn't configured as a cloud environment can't be pinned."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(
            db_session, user, workflow.id, _create_body("someone/unconfigured")
        )
    assert exc.value.code == "cloud_repo_environment_not_found"


async def test_create_derives_workspace_from_repo(db_session: AsyncSession) -> None:
    """D16: with a cloud repo env but no existing workspace, the server provisions a
    dedicated workspace row and stamps it as the derived target."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    repo_env = await _make_cloud_repo_environment(db_session, user)
    trigger = await service.create_trigger(db_session, user, workflow.id, _create_body())
    assert trigger.target_workspace_id is not None
    from proliferate.db.store import cloud_workspaces as ws_store

    derived = await ws_store.get_cloud_workspace_for_user(
        db_session, user.id, trigger.target_workspace_id
    )
    assert derived is not None
    assert derived.repo_environment_id == repo_env.id


async def test_update_args_only_keeps_cursor(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(concurrency="skip")
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
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(rrule=_HOURLY)
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
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body()
    )
    await service.delete_trigger(db_session, user, workflow.id, trigger.id)
    assert await trigger_store.get_trigger(db_session, trigger.id) is None


async def test_trigger_visibility_isolation(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    other = await _make_user(db_session)
    workflow = await _make_workflow(db_session, owner)
    await _make_ready_cloud_workspace(db_session, owner)
    trigger = await service.create_trigger(
        db_session, owner, workflow.id, _create_body()
    )
    with pytest.raises(CloudApiError) as exc:
        await service.get_trigger(db_session, other, workflow.id, trigger.id)
    assert exc.value.code == "workflow_not_found"


# --- scheduler tick ------------------------------------------------------------


async def _seed_trigger(
    session_factory,
    *,
    concurrency: str,
    missed_run_policy: str = WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Create user/workspace/workflow/trigger (committed) and return (trigger_id, wf_id)."""
    async with session_factory() as db, db.begin():
        user = await _make_user(db)
        workflow = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        trigger = await service.create_trigger(
            db,
            user,
            workflow.id,
            _create_body(
                concurrency=concurrency,
                missed_run_policy=missed_run_policy,
                args={"issue": "seed"},
            ),
        )
    return trigger.id, workflow.id


async def _make_due(session_factory, trigger_id: uuid.UUID) -> None:
    """Move the cursor to the most recent real RRULE occurrence so the trigger is
    due for exactly one on-time slot. (In production the cursor is always a real
    occurrence — the missed-window scan keys off it, so a fake non-occurrence
    timestamp would leave nothing in-window.)"""
    async with session_factory() as db, db.begin():
        trigger = await trigger_store.get_trigger(db, trigger_id)
        assert trigger is not None and trigger.schedule_rrule is not None
        slot = latest_due_occurrence(
            rrule_text=trigger.schedule_rrule,
            timezone=trigger.schedule_timezone or "UTC",
            now=utcnow(),
        )
        assert slot is not None
        await trigger_store.update_trigger(db, trigger_id=trigger_id, next_run_at=slot)


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
    async with session_factory() as db:
        before = await trigger_store.get_trigger(db, trigger_id)
    assert before is not None
    cursor_before = before.next_run_at
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
    # BLOCKER fix: a concurrency skip HOLDS the cursor stationary (does not advance
    # past the enumerated window), so the slot is re-enumerated next tick once the
    # prior run terminates rather than silently vanishing.
    assert trigger.next_run_at == cursor_before
    assert trigger.next_run_at is not None and trigger.next_run_at <= utcnow()


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


# --- 1c: budget_blocked deny path (D-002) + missed-run catch-up policy ----------


def _patch_recording_gateway(monkeypatch: pytest.MonkeyPatch) -> list[object]:
    """Like ``_patch_gateway`` but records every sandbox-wake call so a deny-path
    test can assert ZERO wakes at the dispatch boundary (not on prose)."""

    calls: list[object] = []

    async def _access(*_a: object, **_k: object) -> CloudSandboxGatewayAccess:
        calls.append(object())
        return CloudSandboxGatewayAccess(
            upstream_base_url="https://sandbox.test",
            upstream_token="sandbox-token",
            runtime_generation=1,
        )

    monkeypatch.setattr(delivery, "ensure_cloud_sandbox_gateway_access", _access)
    return calls


def _force_budget(monkeypatch: pytest.MonkeyPatch, *, blocked: bool) -> None:
    """Enable enforce mode and force the shared billing snapshot's start decision.

    The gate under test (`delivery._budget_block_reason`) runs the *real* enforce
    check + real snapshot-state load; only the final start decision is pinned here
    so we don't have to hand-build an exhausted-grant billing subject."""

    from proliferate.server.billing import snapshots as billing_snapshots

    monkeypatch.setattr(delivery.settings, "cloud_billing_mode", "enforce")

    def _fake_snapshot(_state: object) -> SimpleNamespace:
        return SimpleNamespace(
            start_blocked=blocked,
            start_block_reason="Over budget." if blocked else None,
        )

    monkeypatch.setattr(billing_snapshots, "build_billing_snapshot", _fake_snapshot)


async def test_tick_over_budget_lands_budget_blocked_zero_dispatch(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(a) Over-budget org + due schedule -> exactly one terminal budget_blocked
    run and ZERO sandbox launch / agent dispatch (asserted at the wake + deliver
    boundaries, not on prose)."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))
    _force_budget(monkeypatch, blocked=True)

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 1  # phase-1 still records the run row
    assert result.delivered_runs == 0  # phase-2 refused to deliver
    assert wakes == []  # DISPATCH BOUNDARY: no sandbox was ever woken
    assert seen == []  # no agent dispatch (no gateway deliver POST)

    runs = await _runs_for_trigger(session_factory, trigger_id)
    # No longer pending (it went terminal), so re-read the full ledger.
    async with session_factory() as db:
        all_runs = await store.list_runs(db, executor_user_id=(await _owner(session_factory, workflow_id)))
    blocked = [r for r in all_runs if r.trigger_id == trigger_id]
    assert len(blocked) == 1
    assert blocked[0].status == WORKFLOW_RUN_STATUS_FAILED
    assert blocked[0].error_code == WORKFLOW_RUN_ERROR_BUDGET_BLOCKED
    assert blocked[0].finished_at is not None
    assert runs == []  # not sitting pending anymore


async def test_tick_budget_restored_delivers_normally(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) With enforce on but the org NOT over budget, the next tick runs
    normally: the sandbox is woken and the plan delivered."""
    trigger_id, _workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))
    _force_budget(monkeypatch, blocked=False)

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 1
    assert result.delivered_runs == 1
    assert len(wakes) == 1  # sandbox woken
    assert len(seen) == 1  # plan delivered


async def _push_cursor_back(session_factory, trigger_id: uuid.UUID, *, hours: float) -> None:
    """Force the trigger's cursor into the past — simulate a worker that was down
    while ``hours`` of hourly occurrences came due."""
    async with session_factory() as db, db.begin():
        await trigger_store.update_trigger(
            db, trigger_id=trigger_id, next_run_at=utcnow() - timedelta(hours=hours)
        )


async def _trigger_runs(session_factory, owner: uuid.UUID, trigger_id: uuid.UUID) -> list:
    async with session_factory() as db:
        return [
            r
            for r in await store.list_runs(db, executor_user_id=owner)
            if r.trigger_id == trigger_id
        ]


async def test_missed_run_latest_fires_newest_records_older_missed(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(c) run_latest (default): a schedule whose cursor is hours in the past fires
    ONLY the newest missed occurrence; every OLDER slot is recorded as a terminal
    ``missed`` history row (no silent gaps). The next tick does not double-fire."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory, concurrency="skip", missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST
    )
    await _push_cursor_back(session_factory, trigger_id, hours=5.5)  # ~5 hourly slots
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    first = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert first.created_runs == 1  # exactly the newest slot fires

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    fired = [r for r in runs if r.status != WORKFLOW_RUN_STATUS_MISSED]
    missed = [r for r in runs if r.status == WORKFLOW_RUN_STATUS_MISSED]
    assert len(fired) == 1  # one real run
    assert len(missed) >= 4  # every older slot recorded (5.5h window ⇒ ≥4 older)
    # The one fired run is the NEWEST slot; missed rows are strictly older.
    newest = max(r.scheduled_for for r in runs)
    assert fired[0].scheduled_for == newest
    assert all(r.scheduled_for < newest for r in missed)
    # Slots are unique (deduped by the (trigger_id, scheduled_for) index).
    assert len({r.scheduled_for for r in runs}) == len(runs)

    # The cursor advanced to a future slot: the immediate next tick does not re-fire.
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 0
    runs_after = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs_after) == len(runs)  # no double-fire, no new rows


async def test_missed_skip_all_fires_nothing_records_every_slot_missed(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(d) skip_all: NO run fires; ALL missed slots are recorded as ``missed`` rows
    with zero sandbox launch / delivery."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory, concurrency="skip", missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL
    )
    await _push_cursor_back(session_factory, trigger_id, hours=5.5)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert result.created_runs == 0  # nothing fired
    assert result.delivered_runs == 0
    assert wakes == []  # DISPATCH BOUNDARY: no sandbox woken
    assert seen == []  # no agent dispatch

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) >= 5  # every occurrence in the 5.5h window recorded
    assert all(r.status == WORKFLOW_RUN_STATUS_MISSED for r in runs)
    assert all(r.status in WORKFLOW_RUN_TERMINAL_STATUSES for r in runs)

    # Re-tick: cursor advanced, no new rows.
    again = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert again.created_runs == 0
    assert len(await _trigger_runs(session_factory, owner, trigger_id)) == len(runs)


async def test_missed_replay_all_fires_every_slot_and_dedupes_on_retick(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(e) replay_all: EVERY missed slot fires (in order); a re-tick over the same
    window creates NOTHING — the (trigger_id, scheduled_for) unique index dedupes.

    Uses concurrency=queue so the re-tick is not short-circuited by the skip guard
    and actually exercises the index dedupe in the fire loop."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="queue",
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    )
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)  # ~3 hourly slots
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    first = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    n_slots = len(runs)
    assert n_slots >= 3  # a full backfill, not a single fire
    assert first.created_runs == n_slots  # every slot fired
    assert all(r.status != WORKFLOW_RUN_STATUS_MISSED for r in runs)  # all real runs
    assert len({r.scheduled_for for r in runs}) == n_slots  # distinct slots

    # Force the cursor back over the SAME window and re-tick: the unique index
    # dedupes every already-fired slot, so no new run is created.
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 0  # dedupe held — no double-fire
    assert len(await _trigger_runs(session_factory, owner, trigger_id)) == n_slots


async def _owner(session_factory, workflow_id: uuid.UUID) -> uuid.UUID:
    async with session_factory() as db:
        workflow = await store.get_workflow(db, workflow_id)
    assert workflow is not None and workflow.owner_user_id is not None
    return workflow.owner_user_id


# --- 1c hardening: adversarial-review defect fixes ------------------------------


async def _seed_running_prior(
    session_factory, *, workflow_id: uuid.UUID, trigger_id: uuid.UUID
) -> uuid.UUID:
    """A non-terminal prior run of this trigger (so the concurrency-skip guard trips)."""
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
            # Off an RRULE :00 boundary so it can't collide with a real slot's row.
            scheduled_for=utcnow() - timedelta(minutes=97),
        )
        await store.update_run(db, run_id=prior.id, status=WORKFLOW_RUN_STATUS_RUNNING)
        return prior.id


async def test_concurrency_skip_holds_backlog_then_replays_on_next_tick(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(BLOCKER) concurrency=skip with a prior run still active fires nothing AND
    does NOT advance the cursor past the missed window. Once the prior run
    terminates, the next tick routes the full held window through the run_latest
    partition (newest fires + older recorded missed) — no slot silently vanishes."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="skip",
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
    )
    prior_id = await _seed_running_prior(
        session_factory, workflow_id=workflow_id, trigger_id=trigger_id
    )
    # ~3+ hourly slots came due while the prior run was still active.
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)
    async with session_factory() as db:
        before = await trigger_store.get_trigger(db, trigger_id)
    assert before is not None
    cursor_before = before.next_run_at
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))
    owner = await _owner(session_factory, workflow_id)

    # Tick 1: skip guard trips — nothing fires, cursor held stationary (backlog kept).
    first = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert first.created_runs == 0
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert [r.id for r in runs] == [prior_id]  # only the prior run — zero missed rows
    async with session_factory() as db:
        held = await trigger_store.get_trigger(db, trigger_id)
    assert held is not None
    assert held.next_run_at == cursor_before  # cursor NOT advanced past the window
    assert held.next_run_at <= utcnow()  # still due -> re-enumerated next tick
    assert held.last_skip_reason  # concurrency skip recorded

    # The prior run terminates -> the held backlog is no longer blocked.
    async with session_factory() as db, db.begin():
        await store.update_run(db, run_id=prior_id, status="completed", finished_at=utcnow())

    # Tick 2: run_latest partition applies to the FULL held window.
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 1  # the newest slot fires
    runs2 = await _trigger_runs(session_factory, owner, trigger_id)
    missed = [r for r in runs2 if r.status == WORKFLOW_RUN_STATUS_MISSED]
    assert len(missed) >= 2  # every older slot in the held window recorded, none dropped
    async with session_factory() as db:
        advanced = await trigger_store.get_trigger(db, trigger_id)
    assert advanced is not None
    assert advanced.next_run_at > utcnow()  # cursor advanced only past a handled window


async def test_catch_up_truncation_defers_remainder_no_silent_drop(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(MAJOR) replay_all with more due slots than the per-tick cap fires at most
    `cap` this tick and PARKS the cursor on the oldest un-fired slot; the remainder
    replays on later ticks. Across ticks, fired+missed rows == total slots — zero
    silently dropped. Uses a small monkeypatched cap (3), not the real 500."""
    monkeypatch.setattr(scheduler, "WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS", 3)
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="queue",  # skip guard would otherwise short-circuit re-ticks
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    )
    await _push_cursor_back(session_factory, trigger_id, hours=6.5)  # ~6 slots > cap 3
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))
    owner = await _owner(session_factory, workflow_id)

    total_created = 0
    drained = False
    for _ in range(10):  # drive ticks until the backlog drains
        result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
        assert result.created_runs <= 3  # never more than the cap in one tick
        total_created += result.created_runs
        async with session_factory() as db:
            trig = await trigger_store.get_trigger(db, trigger_id)
        assert trig is not None
        if trig.next_run_at > utcnow():  # cursor moved into the future -> drained
            drained = True
            break
    assert drained

    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert all(r.status != WORKFLOW_RUN_STATUS_MISSED for r in runs)  # replay = all real
    assert len({r.scheduled_for for r in runs}) == len(runs)  # distinct slots, no dupes
    assert len(runs) == total_created  # every created run persisted
    assert len(runs) >= 6  # the full backlog fired across ticks, none dropped
    # It took more than one tick (proves the cap deferred + the cursor was parked).
    assert total_created > 3


async def test_missed_recording_skipped_when_no_current_version_surfaces_reason(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(MAJOR) missed slots but no current workflow version (no run FK) can't be
    recorded — surface a warning via last_skip_reason instead of a silent gap.
    skip_all isolates the missed path (nothing fires)."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="skip",
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL,
    )
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)
    # Null the workflow's current version so create_missed_run has no FK to hang on.
    async with session_factory() as db, db.begin():
        wf = await db.get(Workflow, workflow_id)
        assert wf is not None
        wf.current_version_id = None
    owner = await _owner(session_factory, workflow_id)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert result.created_runs == 0  # no crash, nothing fired
    assert wakes == [] and seen == []  # no dispatch
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert runs == []  # no missed rows recorded (no version) ...
    async with session_factory() as db:
        trig = await trigger_store.get_trigger(db, trigger_id)
    assert trig is not None
    # ... but the gap is NOT silent — it is surfaced, mirroring the fire path.
    assert trig.last_skip_reason is not None
    assert "workflow_no_version" in trig.last_skip_reason


async def test_non_dedup_integrity_error_propagates(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(MINOR) only the (trigger_id, scheduled_for) dedup conflict is swallowed as
    'already recorded'; any OTHER IntegrityError propagates (never masked)."""

    # The classifier: dedup index -> swallow; anything else -> re-raise.
    class _OtherOrig(Exception):
        constraint_name = "workflow_run_some_other_fk"

    class _DedupOrig(Exception):
        constraint_name = "uq_workflow_run_trigger_slot"

    assert scheduler._is_slot_dedup_conflict(IntegrityError("x", {}, _DedupOrig("dup"))) is True
    assert scheduler._is_slot_dedup_conflict(IntegrityError("x", {}, _OtherOrig("no"))) is False
    # String fallback (no constraint_name attribute exposed) still recognises the index.
    assert (
        scheduler._is_slot_dedup_conflict(
            IntegrityError('duplicate key ... unique constraint "uq_workflow_run_trigger_slot"', {}, Exception())
        )
        is True
    )

    # End-to-end: a non-dedup IntegrityError from the fire path is NOT swallowed.
    trigger_id, _workflow_id = await _seed_trigger(session_factory, concurrency="queue")
    await _make_due(session_factory, trigger_id)

    async def _boom(*_a: object, **_k: object) -> None:
        raise IntegrityError("INSERT INTO workflow_run ...", {}, _OtherOrig("nope"))

    monkeypatch.setattr(scheduler.service, "start_run", _boom)

    with pytest.raises(IntegrityError):
        await scheduler._fire_one_trigger(session_factory, trigger_id=trigger_id, now=utcnow())


# --- track 2a: desktop-executor local scheduling (lifts L15) --------------------


async def _seed_local_trigger(
    session_factory,
    *,
    concurrency: str = "skip",
    missed_run_policy: str = WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
) -> tuple[uuid.UUID, uuid.UUID]:
    """A LOCAL schedule trigger (committed). No cloud workspace is provisioned —
    the repo pin names the desktop's local worktree; target_workspace_id stays
    NULL (the local CHECK invariant)."""
    async with session_factory() as db, db.begin():
        user = await _make_user(db)
        workflow = await _make_workflow(db, user)
        trigger = await service.create_trigger(
            db,
            user,
            workflow.id,
            _create_body(
                concurrency=concurrency,
                missed_run_policy=missed_run_policy,
                target_mode="local",
                args={"issue": "seed"},
            ),
        )
    return trigger.id, workflow.id


async def _claim_batch(
    session_factory, *, owner: uuid.UUID, executor_id: str = "desktop-1", limit: int = 5
) -> list:
    async with session_factory() as db, db.begin():
        resp = await local_executor.claim_local_workflow_runs(
            db,
            owner,
            LocalWorkflowClaimRequest(executorId=executor_id, limit=limit),  # type: ignore[call-arg]
        )
    return list(resp.runs)


async def test_create_accepts_local_schedule_trigger(db_session: AsyncSession) -> None:
    """(2a CRUD) a local schedule trigger is now accepted — no cloud workspace, the
    repo pin retained (the local worktree hint), target_workspace_id NULL."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    trigger = await service.create_trigger(
        db_session, user, workflow.id, _create_body(target_mode="local")
    )
    assert trigger.target_mode == "local"
    assert trigger.target_workspace_id is None
    assert trigger.repo_full_name == _REPO
    assert trigger.next_run_at is not None and trigger.next_run_at > utcnow()


async def test_create_still_rejects_local_poll_trigger(db_session: AsyncSession) -> None:
    """Poll triggers stay cloud-only (the poller lane has no claim/missed machinery)."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    body = _create_body(target_mode="local")
    body.kind = "poll"  # type: ignore[assignment]
    with pytest.raises(CloudApiError) as exc:
        await service.create_trigger(db_session, user, workflow.id, body)
    assert exc.value.code == "poll_local_unsupported"


async def test_local_schedule_fires_claimable_run_no_server_delivery(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(a) A due local schedule trigger fires ONE ``claimable`` run — NOT
    pending_delivery, and with ZERO server-side delivery (no sandbox wake, no
    gateway POST). Nothing on the server delivers a local run; it waits to be
    claimed by a desktop executor."""
    trigger_id, workflow_id = await _seed_local_trigger(session_factory)
    await _make_due(session_factory, trigger_id)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 1
    assert result.delivered_runs == 0  # local runs are never server-delivered
    assert wakes == []  # no sandbox woken
    assert seen == []  # no gateway deliver POST

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) == 1
    assert runs[0].status == WORKFLOW_RUN_STATUS_CLAIMABLE
    assert runs[0].status != WORKFLOW_RUN_STATUS_PENDING_DELIVERY
    assert runs[0].target_mode == WORKFLOW_TARGET_MODE_LOCAL
    assert runs[0].claim_id is None  # unclaimed
    # Wave 2b: a schedule-triggered LOCAL run resolves to 'workspace' isolation (the
    # desktop mints its own worktree; the run executes directly in that checkout).
    assert runs[0].resolved_plan_json.get("isolation") == "workspace"


async def test_local_missed_run_latest_fires_newest_claimable_records_older_missed(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) The "laptop closed" backlog: a local schedule whose cursor is hours back
    partitions under run_latest — the NEWEST slot becomes a single ``claimable`` run
    and every OLDER slot is a terminal ``missed`` row. Reuses the wave-1 partition
    verbatim; the only local delta is that a fire produces a claimable run (no
    sandbox wake / delivery), proven at the dispatch boundary."""
    trigger_id, workflow_id = await _seed_local_trigger(
        session_factory, missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST
    )
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)  # ~3 hourly slots
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert result.created_runs == 1  # exactly the newest slot
    assert result.delivered_runs == 0
    assert wakes == [] and seen == []  # DISPATCH BOUNDARY: no wake, no deliver

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    claimable = [r for r in runs if r.status == WORKFLOW_RUN_STATUS_CLAIMABLE]
    missed = [r for r in runs if r.status == WORKFLOW_RUN_STATUS_MISSED]
    assert len(claimable) == 1
    assert len(missed) >= 2  # older slots recorded, no silent gap
    assert all(r.target_mode == WORKFLOW_TARGET_MODE_LOCAL for r in runs)
    newest = max(r.scheduled_for for r in runs)
    assert claimable[0].scheduled_for == newest
    assert all(r.scheduled_for < newest for r in missed)

    # The cursor advanced past the handled window — the next tick does not re-fire.
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 0
    assert len(await _trigger_runs(session_factory, owner, trigger_id)) == len(runs)


async def test_local_stale_claim_is_reclaimable_exactly_once(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(c) A ``claimed`` run whose heartbeat lapsed past its TTL is reclaimable
    EXACTLY once: the reclaim rotates the claim_id (so the old holder's heartbeat is
    rejected), and an immediate second claim finds nothing (the claim is fresh
    again). This is the no-double-claim guarantee — the row lock + claim_id rotation
    make two racing claimers resolve to a single winner."""
    trigger_id, workflow_id = await _seed_local_trigger(session_factory)
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202))
    await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    owner = await _owner(session_factory, workflow_id)

    first = await _claim_batch(session_factory, owner=owner)
    assert len(first) == 1
    run_id = uuid.UUID(first[0].id)
    assert first[0].status == WORKFLOW_RUN_STATUS_CLAIMED
    original_claim = first[0].claim_id
    assert original_claim is not None

    # A fresh claim is NOT stale, so a second poll claims nothing.
    assert await _claim_batch(session_factory, owner=owner) == []

    # Simulate the laptop closing: the heartbeat lapses past the TTL.
    async with session_factory() as db, db.begin():
        row = await db.get(WorkflowRun, run_id)
        assert row is not None
        row.claim_expires_at = utcnow() - timedelta(seconds=1)

    # Exactly one reclaim: a new executor gets the run with a ROTATED claim_id.
    reclaimed = await _claim_batch(session_factory, owner=owner, executor_id="desktop-2")
    assert len(reclaimed) == 1
    assert uuid.UUID(reclaimed[0].id) == run_id
    assert reclaimed[0].claim_id is not None and reclaimed[0].claim_id != original_claim

    # ...and it is not stale now, so a follow-up poll finds nothing (no double-claim).
    assert await _claim_batch(session_factory, owner=owner, executor_id="desktop-3") == []

    # The stale holder's heartbeat (old claim_id) is rejected; the winner's works.
    async with session_factory() as db, db.begin():
        stale = await local_executor.heartbeat_local_workflow_run(
            db,
            owner,
            run_id,
            LocalWorkflowClaimActionRequest(executorId="desktop-1", claimId=original_claim),  # type: ignore[call-arg]
        )
    assert stale.accepted is False and stale.run is None
    async with session_factory() as db, db.begin():
        ok = await local_executor.heartbeat_local_workflow_run(
            db,
            owner,
            run_id,
            LocalWorkflowClaimActionRequest(  # type: ignore[call-arg]
                executorId="desktop-2", claimId=reclaimed[0].claim_id
            ),
        )
    assert ok.accepted is True and ok.run is not None


async def test_local_terminal_report_expires_gateway_token_like_cloud(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(d) A local run reports terminal through the SAME /status path the cloud lane
    uses, so the shared terminal side effect fires: the per-run gateway token is
    expired the instant the run goes terminal (one observability + one credential
    surface for both lanes)."""
    trigger_id, workflow_id = await _seed_local_trigger(session_factory)
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202))
    await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    owner = await _owner(session_factory, workflow_id)

    claimed = await _claim_batch(session_factory, owner=owner)
    assert len(claimed) == 1
    run_id = uuid.UUID(claimed[0].id)
    claim_id = claimed[0].claim_id
    assert claim_id is not None

    # Every run mints a token (L16). A claim ROTATES it (BLOCKER fix): the StartRun
    # token is expired and a fresh one minted for the claimant, so after the claim
    # exactly one token is active (the rotated one) and the original is expired.
    async def _token_statuses() -> list[str]:
        async with session_factory() as db:
            rows = (
                await db.execute(
                    select(WorkflowRunGatewayToken.status).where(
                        WorkflowRunGatewayToken.workflow_run_id == run_id
                    )
                )
            ).scalars().all()
        return list(rows)

    before = await _token_statuses()
    assert before.count("active") == 1  # exactly the rotated token is live
    assert before.count("expired") == 1  # the original StartRun token was expired

    # The relay reports via owner auth and MUST carry the live claim_id (2a).
    actor = SimpleNamespace(id=owner)
    async with session_factory() as db, db.begin():
        await service.report_run_status(
            db, actor, run_id, RunStatusRequest(status="running", claimId=claim_id)  # type: ignore[arg-type,call-arg]
        )
    async with session_factory() as db, db.begin():
        await service.report_run_status(
            db, actor, run_id, RunStatusRequest(status="completed", claimId=claim_id)  # type: ignore[arg-type,call-arg]
        )

    after = await _token_statuses()
    # Terminal report expired the (rotated) active token, like the cloud path — no
    # token is left live for the run.
    assert "active" not in after and set(after) == {"expired"}
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert runs[0].status == WORKFLOW_RUN_STATUS_COMPLETED


async def _fire_and_claim_local(
    session_factory, monkeypatch: pytest.MonkeyPatch, *, executor_id: str = "desktop-1"
) -> tuple[uuid.UUID, uuid.UUID, list]:
    """Seed a due local schedule, fire it, and claim the resulting run. Returns
    ``(trigger_id, owner, claimed_runs)``."""

    trigger_id, workflow_id = await _seed_local_trigger(session_factory)
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202))
    await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    owner = await _owner(session_factory, workflow_id)
    claimed = await _claim_batch(session_factory, owner=owner, executor_id=executor_id)
    return trigger_id, owner, claimed


async def test_local_reclaim_rejects_stale_claim_report_and_leaves_run_untouched(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BLOCKER (owner-auth path): after laptop B reclaims a stale run, laptop A's
    relay — which reports via OWNER auth (same user owns both laptops, so the token
    check can't distinguish them) — carries A's now-stale claim_id. That report is
    rejected 409 ``workflow_run_stale_claim`` and the run is untouched, so A cannot
    clobber the run B now owns."""
    trigger_id, owner, first = await _fire_and_claim_local(session_factory, monkeypatch)
    assert len(first) == 1
    run_id = uuid.UUID(first[0].id)
    stale_claim = first[0].claim_id
    assert stale_claim is not None

    # Laptop A closes: its heartbeat lapses; laptop B reclaims with a fresh claim.
    async with session_factory() as db, db.begin():
        row = await db.get(WorkflowRun, run_id)
        assert row is not None
        row.claim_expires_at = utcnow() - timedelta(seconds=1)
    reclaimed = await _claim_batch(session_factory, owner=owner, executor_id="desktop-2")
    assert len(reclaimed) == 1
    new_claim = reclaimed[0].claim_id
    assert new_claim is not None and new_claim != stale_claim

    # A's stale relay report (old claim_id) is rejected; the run is untouched.
    actor = SimpleNamespace(id=owner)
    with pytest.raises(CloudApiError) as exc:
        async with session_factory() as db, db.begin():
            await service.report_run_status(
                db, actor, run_id, RunStatusRequest(status="running", claimId=stale_claim)  # type: ignore[arg-type,call-arg]
            )
    assert exc.value.code == "workflow_run_stale_claim"
    assert exc.value.status_code == 409
    async with session_factory() as db:
        untouched = await store.get_run(db, run_id)
    assert untouched is not None
    assert untouched.status == WORKFLOW_RUN_STATUS_CLAIMED  # never advanced to running
    assert str(untouched.claim_id) == new_claim  # still B's claim
    assert untouched.started_at is None

    # B's relay (current claim_id) drives the run normally.
    async with session_factory() as db, db.begin():
        ok = await service.report_run_status(
            db, actor, run_id, RunStatusRequest(status="running", claimId=new_claim)  # type: ignore[arg-type,call-arg]
        )
    assert ok.status == WORKFLOW_RUN_STATUS_RUNNING


async def test_local_claimed_run_report_without_claim_id_rejected(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BLOCKER: an owner-authed report on a live-claimed LOCAL run that omits the
    claim_id is rejected (the relay must thread it) — otherwise the owner-auth path
    is unauthenticated at the claim granularity."""
    _trigger_id, owner, claimed = await _fire_and_claim_local(session_factory, monkeypatch)
    run_id = uuid.UUID(claimed[0].id)
    actor = SimpleNamespace(id=owner)
    with pytest.raises(CloudApiError) as exc:
        async with session_factory() as db, db.begin():
            await service.report_run_status(
                db, actor, run_id, RunStatusRequest(status="running")  # type: ignore[arg-type]
            )
    assert exc.value.code == "workflow_run_claim_required"
    assert exc.value.status_code == 409


async def test_local_claim_rotates_gateway_token(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BLOCKER (token path): each claim/reclaim rotates the per-run gateway token —
    the prior holder's token is expired and a fresh one minted, so a partitioned
    laptop's runtime is 401'd by the gateway + token-authed /status. Exactly one
    token is active after each claim, and its hash changes on reclaim."""
    trigger_id, owner, first = await _fire_and_claim_local(session_factory, monkeypatch)
    run_id = uuid.UUID(first[0].id)

    async def _token_rows() -> list:
        async with session_factory() as db:
            return list(
                (
                    await db.execute(
                        select(
                            WorkflowRunGatewayToken.status, WorkflowRunGatewayToken.token_hash
                        ).where(WorkflowRunGatewayToken.workflow_run_id == run_id)
                    )
                ).all()
            )

    after_first = await _token_rows()
    active_first = [h for s, h in after_first if s == "active"]
    # StartRun minted one, the claim rotated it: exactly one active, one expired.
    assert len(active_first) == 1
    assert sum(1 for s, _ in after_first if s == "expired") == 1

    # Reclaim after the claim lapses: the token rotates again.
    async with session_factory() as db, db.begin():
        row = await db.get(WorkflowRun, run_id)
        assert row is not None
        row.claim_expires_at = utcnow() - timedelta(seconds=1)
    await _claim_batch(session_factory, owner=owner, executor_id="desktop-2")

    after_reclaim = await _token_rows()
    active_reclaim = [h for s, h in after_reclaim if s == "active"]
    assert len(active_reclaim) == 1  # still exactly one live token
    assert active_reclaim[0] != active_first[0]  # ...and it is a NEW token hash
    # The prior claimant's token hash is now expired — its runtime is locked out.
    assert active_first[0] not in [h for s, h in after_reclaim if s == "active"]


async def test_cloud_run_report_needs_no_claim_id(db_session: AsyncSession) -> None:
    """Regression: a cloud run never carries a claim, so its /status reports are
    unchanged — no claim_id is required and the guard is a no-op (the runtime
    self-reports via its per-run gateway token)."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    assert workflow.current_version_id is not None
    run = await store.create_run(
        db_session,
        workflow_id=workflow.id,
        workflow_version_id=workflow.current_version_id,
        trigger_kind="schedule",
        executor_user_id=user.id,
        args_json={},
        target_mode="personal_cloud",
        resolved_plan_json={},
        status="delivered",
    )
    updated = await service.report_run_status(
        db_session, user, run.id, RunStatusRequest(status="running")  # type: ignore[arg-type]
    )
    assert updated.status == WORKFLOW_RUN_STATUS_RUNNING
    assert updated.claim_id is None


async def test_cloud_scheduled_run_is_never_claimable_regression(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(e) Regression: a CLOUD schedule trigger is unaffected by 2a — its run is
    pending_delivery and server-delivered as before, and the local claim plane never
    returns it (a cloud run must never be handed to a desktop executor)."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert result.created_runs == 1
    assert result.delivered_runs == 1  # cloud lane still delivers
    assert len(seen) == 1

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) == 1
    assert runs[0].target_mode == "personal_cloud"
    assert runs[0].status not in (WORKFLOW_RUN_STATUS_CLAIMABLE, WORKFLOW_RUN_STATUS_CLAIMED)

    # The local claim poll for this owner returns nothing — cloud runs are off-limits.
    assert await _claim_batch(session_factory, owner=owner) == []
