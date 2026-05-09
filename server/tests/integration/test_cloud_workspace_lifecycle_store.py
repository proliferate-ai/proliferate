from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.cloud import WorkspacePostReadyPhase
from proliferate.db import engine as engine_module
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_workspace_setup_runs import (
    claim_due_setup_runs,
    create_cloud_workspace_setup_run,
    finalize_setup_run,
    release_setup_run_claim,
)
from proliferate.db.store.cloud_workspaces import (
    create_cloud_workspace_for_user,
    finalize_workspace_provision,
    mark_workspace_error,
    persist_workspace_destroy,
    persist_workspace_stop,
    reserve_sandbox_slot_for_workspace,
)
from proliferate.server.cloud.workspaces import service as workspace_service
from proliferate.server.cloud.workspaces.domain.setup_runs import (
    bounded_setup_monitor_error,
    classify_setup_run_finalization,
)


def _patch_global_session_factory(
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )


async def _create_workspace(
    *,
    user_id: uuid.UUID,
    repo_name: str = "rocket",
) -> CloudWorkspace:
    return await create_cloud_workspace_for_user(
        user_id=user_id,
        display_name=f"acme/{repo_name}",
        git_provider="github",
        git_owner="acme",
        git_repo_name=repo_name,
        git_branch="feature/cloud",
        git_base_branch="main",
        origin_json=None,
        template_version="v1",
        cloud_repo_limit=None,
    )


@pytest.mark.asyncio
async def test_setup_run_claim_release_and_expired_claim_reclaim(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()
    workspace = await _create_workspace(user_id=user_id)
    now = datetime.now(UTC)
    first = await create_cloud_workspace_setup_run(
        workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        terminal_id="terminal-1",
        command_run_id="command-1",
        setup_script_version=1,
        apply_token="token-1",
        deadline_at=now + timedelta(minutes=10),
    )
    second = await create_cloud_workspace_setup_run(
        workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        terminal_id="terminal-2",
        command_run_id="command-2",
        setup_script_version=2,
        apply_token="token-2",
        deadline_at=now + timedelta(minutes=10),
    )

    claim_now = datetime.now(UTC) + timedelta(seconds=1)
    claimed = await claim_due_setup_runs(owner="worker-a", limit=1, now=claim_now)
    assert [run.id for run in claimed] == [first.id]
    assert claimed[0].claim_owner == "worker-a"
    assert claimed[0].claim_until is not None

    next_claim = await claim_due_setup_runs(owner="worker-b", limit=10, now=claim_now)
    assert [run.id for run in next_claim] == [second.id]

    next_poll_at = now + timedelta(seconds=30)
    await release_setup_run_claim(
        first.id,
        bound_error=bounded_setup_monitor_error,
        next_poll_at=next_poll_at,
        last_error="retry",
    )
    released = await db_session.get(type(first), first.id)
    assert released is not None
    await db_session.refresh(released)
    assert released.claim_owner is None
    assert released.claim_until is None
    assert released.status == "running"
    assert released.next_poll_at == next_poll_at
    assert released.last_error == "retry"

    assert await claim_due_setup_runs(owner="worker-c", limit=10, now=claim_now) == []
    reclaimed = await claim_due_setup_runs(
        owner="worker-c",
        limit=10,
        now=claim_now + timedelta(minutes=2),
    )
    assert {run.id for run in reclaimed} == {first.id, second.id}
    assert {run.claim_owner for run in reclaimed} == {"worker-c"}


@pytest.mark.asyncio
async def test_setup_run_finalize_updates_workspace_only_for_active_token(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()
    workspace = await _create_workspace(user_id=user_id)
    stored_workspace = await db_session.get(CloudWorkspace, workspace.id)
    assert stored_workspace is not None
    stored_workspace.repo_post_ready_phase = WorkspacePostReadyPhase.starting_setup.value
    stored_workspace.repo_post_ready_apply_token = "current-token"
    await db_session.commit()

    stale_run = await create_cloud_workspace_setup_run(
        workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        terminal_id=None,
        command_run_id="command-stale",
        setup_script_version=1,
        apply_token="old-token",
        deadline_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    await finalize_setup_run(
        stale_run.id,
        classify_finalization=classify_setup_run_finalization,
        final_status="succeeded",
        success=True,
    )

    await db_session.refresh(stored_workspace)
    stale_record = await db_session.get(type(stale_run), stale_run.id)
    assert stale_record is not None
    await db_session.refresh(stale_record)
    assert stale_record.status == "stale"
    assert stored_workspace.repo_post_ready_phase == WorkspacePostReadyPhase.starting_setup.value
    assert stored_workspace.repo_post_ready_apply_token == "current-token"
    assert stored_workspace.repo_setup_applied_version == 0

    active_run = await create_cloud_workspace_setup_run(
        workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        terminal_id=None,
        command_run_id="command-active",
        setup_script_version=3,
        apply_token="current-token",
        deadline_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    await finalize_setup_run(
        active_run.id,
        classify_finalization=classify_setup_run_finalization,
        final_status="succeeded",
        success=True,
    )

    await db_session.refresh(stored_workspace)
    active_record = await db_session.get(type(active_run), active_run.id)
    assert active_record is not None
    await db_session.refresh(active_record)
    assert active_record.status == "succeeded"
    assert active_record.claim_owner is None
    assert active_record.claim_until is None
    assert active_record.next_poll_at is None
    assert stored_workspace.repo_post_ready_phase == WorkspacePostReadyPhase.completed.value
    assert stored_workspace.repo_post_ready_apply_token is None
    assert stored_workspace.repo_setup_applied_version == 3
    assert stored_workspace.status_detail == "Ready"


@pytest.mark.asyncio
async def test_sandbox_reservation_limit_and_provision_finalization_are_atomic(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()
    first_workspace = await _create_workspace(user_id=user_id, repo_name="first")
    second_workspace = await _create_workspace(user_id=user_id, repo_name="second")

    sandbox = await reserve_sandbox_slot_for_workspace(
        db_session,
        workspace_id=first_workspace.id,
        external_sandbox_id="sandbox-first",
        provider="e2b",
        template_version="v1",
        status="provisioning",
        started_at=datetime.now(UTC),
        concurrent_sandbox_limit=1,
    )
    assert sandbox is not None

    denied = await reserve_sandbox_slot_for_workspace(
        db_session,
        workspace_id=second_workspace.id,
        external_sandbox_id="sandbox-second",
        provider="e2b",
        template_version="v1",
        status="provisioning",
        started_at=datetime.now(UTC),
        concurrent_sandbox_limit=1,
    )
    assert denied is None
    stored_second = await db_session.get(CloudWorkspace, second_workspace.id)
    assert stored_second is not None
    assert stored_second.active_sandbox_id is None

    stored_first = await db_session.get(CloudWorkspace, first_workspace.id)
    assert stored_first is not None
    finalized = await finalize_workspace_provision(
        db_session,
        stored_first,
        sandbox,
        runtime_url="https://runtime.example",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        template_version="v2",
    )
    await db_session.refresh(sandbox)
    assert finalized.status == "ready"
    assert finalized.status_detail == "Ready"
    assert finalized.runtime_url == "https://runtime.example"
    assert finalized.runtime_token_ciphertext == "ciphertext"
    assert finalized.anyharness_workspace_id == "workspace-123"
    assert finalized.template_version == "v2"
    assert finalized.runtime_generation == 1
    assert finalized.ready_at is not None
    assert sandbox.status == "running"
    assert sandbox.template_version == "v2"
    assert sandbox.last_heartbeat_at is not None


@pytest.mark.asyncio
async def test_provision_failure_cleanup_is_idempotent_and_preserves_failed_sandbox(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()
    workspace = await _create_workspace(user_id=user_id)
    stored_workspace = await db_session.get(CloudWorkspace, workspace.id)
    assert stored_workspace is not None
    sandbox = CloudSandbox(
        cloud_workspace_id=workspace.id,
        provider="e2b",
        external_sandbox_id="sandbox-error",
        status="provisioning",
        template_version="v1",
    )
    db_session.add(sandbox)
    await db_session.flush()
    stored_workspace.active_sandbox_id = sandbox.id
    stored_workspace.runtime_url = "https://runtime.example"
    stored_workspace.runtime_token_ciphertext = "ciphertext"
    stored_workspace.anyharness_workspace_id = "workspace-123"
    await db_session.commit()

    for _ in range(2):
        await mark_workspace_error(
            db_session,
            workspace.id,
            "provider failed",
            status_detail="Provisioning failed",
        )

    await db_session.refresh(stored_workspace)
    await db_session.refresh(sandbox)
    assert stored_workspace.status == "error"
    assert stored_workspace.status_detail == "Provisioning failed"
    assert stored_workspace.last_error == "provider failed"
    assert stored_workspace.runtime_url is None
    assert stored_workspace.runtime_token_ciphertext is None
    assert stored_workspace.anyharness_workspace_id is None
    assert stored_workspace.active_sandbox_id == sandbox.id
    assert sandbox.status == "error"


@pytest.mark.asyncio
async def test_stop_and_destroy_preserve_retry_state_after_provider_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id = uuid.uuid4()
    sandbox_id = uuid.uuid4()
    workspace = CloudWorkspace(
        id=workspace_id,
        user_id=uuid.uuid4(),
        billing_subject_id=uuid.uuid4(),
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        status="ready",
        status_detail="Ready",
        template_version="v1",
        runtime_generation=2,
        active_sandbox_id=sandbox_id,
        runtime_url="https://runtime.example",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
    )
    sandbox = CloudSandbox(
        id=sandbox_id,
        cloud_workspace_id=workspace_id,
        provider="e2b",
        external_sandbox_id="sandbox-123",
        status="running",
        template_version="v1",
    )
    sandbox_statuses: list[str] = []
    stopped: list[CloudWorkspace] = []
    destroyed: list[CloudWorkspace] = []

    class _FailingProvider:
        async def pause_sandbox(self, _sandbox_id: str) -> None:
            raise RuntimeError("pause failed")

        async def destroy_sandbox(self, _sandbox_id: str) -> None:
            raise RuntimeError("destroy failed")

    async def _load_active_sandbox_for_workspace(_workspace: CloudWorkspace):
        return sandbox

    async def _update_sandbox_status(_sandbox: CloudSandbox, status: str, **_kwargs) -> None:
        sandbox_statuses.append(status)
        _sandbox.status = status

    async def _persist_workspace_stop_state(_workspace: CloudWorkspace) -> None:
        stopped.append(_workspace)
        await persist_workspace_stop(_NoopDb(), _workspace)

    async def _persist_workspace_destroy_state(_workspace: CloudWorkspace) -> None:
        destroyed.append(_workspace)
        await persist_workspace_destroy(_NoopDb(), _workspace)

    monkeypatch.setattr(
        workspace_service,
        "load_active_sandbox_for_workspace",
        _load_active_sandbox_for_workspace,
    )
    monkeypatch.setattr(
        workspace_service,
        "get_sandbox_provider",
        lambda _kind: _FailingProvider(),
    )
    monkeypatch.setattr(workspace_service, "update_sandbox_status", _update_sandbox_status)
    monkeypatch.setattr(
        workspace_service,
        "persist_workspace_stop_state",
        _persist_workspace_stop_state,
    )
    monkeypatch.setattr(
        workspace_service,
        "persist_workspace_destroy_state",
        _persist_workspace_destroy_state,
    )
    monkeypatch.setattr(workspace_service, "log_cloud_event", lambda *args, **kwargs: None)

    await workspace_service._stop_workspace_runtime(workspace)

    assert sandbox_statuses == ["error"]
    assert stopped == [workspace]
    assert workspace.status == "archived"
    assert workspace.active_sandbox_id == sandbox_id
    assert workspace.runtime_url == "https://runtime.example"
    assert workspace.runtime_token_ciphertext == "ciphertext"
    assert workspace.anyharness_workspace_id == "workspace-123"

    workspace.status = "ready"
    sandbox_statuses.clear()
    await workspace_service._destroy_workspace_runtime(workspace)

    assert sandbox_statuses == ["error"]
    assert destroyed == [workspace]
    assert workspace.status == "archived"
    assert workspace.active_sandbox_id is None
    assert workspace.runtime_url is None
    assert workspace.runtime_token_ciphertext is None
    assert workspace.anyharness_workspace_id is None


class _NoopDb:
    async def commit(self) -> None:
        return None
