"""Shared factories and boundary patches for workflow trigger tests."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.integrations.anyharness import workflow_runs as runtime_workflow_runs
from proliferate.server.automations.domain.schedule import latest_due_occurrence
from proliferate.server.cloud.gateway.service import CloudSandboxGatewayAccess
from proliferate.server.cloud.workflows import delivery, service, triggers
from proliferate.server.cloud.workflows.models import (
    TriggerScheduleRequest,
    WorkflowCreateRequest,
    WorkflowTriggerCreateRequest,
)
from proliferate.utils.time import utcnow

_HOURLY = "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0"
_DAILY_9 = "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0"


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
        trigger = await triggers.create_trigger(
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


async def _owner(session_factory, workflow_id: uuid.UUID) -> uuid.UUID:
    async with session_factory() as db:
        workflow = await store.get_workflow(db, workflow_id)
    assert workflow is not None and workflow.owner_user_id is not None
    return workflow.owner_user_id
