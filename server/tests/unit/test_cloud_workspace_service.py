from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.constants.billing import BILLING_MODE_ENFORCE
from proliferate.server.billing.models import BillingSnapshot
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import service as workspace_service


def _blocked_billing_snapshot(*, blocked_reason: str) -> BillingSnapshot:
    return BillingSnapshot(
        plan="free",
        billing_mode=BILLING_MODE_ENFORCE,
        is_unlimited=False,
        over_quota=blocked_reason == "sandbox_hours_exhausted",
        included_hours=20.0,
        used_hours=20.0,
        remaining_hours=0.0,
        concurrent_sandbox_limit=2,
        active_sandbox_count=2 if blocked_reason == "concurrency_limit" else 0,
        blocked=True,
        blocked_reason=blocked_reason,
    )


def _unblocked_billing_snapshot() -> BillingSnapshot:
    return BillingSnapshot(
        plan="free",
        billing_mode=BILLING_MODE_ENFORCE,
        is_unlimited=False,
        over_quota=False,
        included_hours=20.0,
        used_hours=1.0,
        remaining_hours=19.0,
        concurrent_sandbox_limit=2,
        active_sandbox_count=0,
        blocked=False,
        blocked_reason=None,
    )


@pytest.mark.asyncio
async def test_create_cloud_workspace_blocks_when_billing_snapshot_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _existing_workspace(**_kwargs):
        return None

    async def _billing_snapshot(_user_id) -> BillingSnapshot:
        return _blocked_billing_snapshot(blocked_reason="sandbox_hours_exhausted")

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("downstream workspace creation should not run when billing blocks")

    async def _repo_config_value(**_kwargs):
        return SimpleNamespace(configured=True, env_vars={}, default_branch=None)

    monkeypatch.setattr(workspace_service, "get_linked_github_account", lambda _user: object())
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "load_existing_cloud_workspace", _existing_workspace)
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot", _billing_snapshot)
    monkeypatch.setattr(workspace_service, "load_cloud_credential_statuses", _unexpected)
    monkeypatch.setattr(workspace_service, "create_cloud_workspace_for_user", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.create_cloud_workspace(
            user,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            base_branch="main",
            branch_name="feature/cloud",
            display_name=None,
        )

    assert exc_info.value.code == "quota_exceeded"
    assert exc_info.value.status_code == 403
    assert "sandbox hours are exhausted" in exc_info.value.message


@pytest.mark.asyncio
async def test_start_cloud_workspace_blocks_when_billing_snapshot_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        status="stopped",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
    )

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _billing_snapshot(_user_id) -> BillingSnapshot:
        return _blocked_billing_snapshot(blocked_reason="concurrency_limit")

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("workspace start should stop before credential/runtime work")

    monkeypatch.setattr(workspace_service, "_require_cloud_workspace_for_user", _require_workspace)
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot", _billing_snapshot)
    monkeypatch.setattr(workspace_service, "load_cloud_credential_statuses", _unexpected)
    monkeypatch.setattr(workspace_service, "ensure_workspace_runtime_ready", _unexpected)
    monkeypatch.setattr(workspace_service, "save_workspace", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.start_cloud_workspace(user, uuid4())

    assert exc_info.value.code == "quota_exceeded"
    assert exc_info.value.status_code == 403
    assert "concurrent sandbox limit" in exc_info.value.message


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_when_persisted_sandbox_lookup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status="stopped",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error="old error",
        ready_at=datetime.now(UTC),
    )
    sandbox = SimpleNamespace(
        id=uuid4(),
        provider="e2b",
        external_sandbox_id="missing-sandbox",
    )
    saved_statuses: list[tuple[object, object]] = []
    scheduled: list[object] = []
    marked_errors: list[str] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _billing_snapshot(_user_id) -> BillingSnapshot:
        return _unblocked_billing_snapshot()

    async def _credential_statuses(_user_id):
        return [SimpleNamespace(provider="claude", synced=True)]

    async def _load_active_sandbox(_workspace):
        return sandbox

    class _Provider:
        async def get_sandbox_state(self, _sandbox_id: str):
            raise RuntimeError("Sandbox missing from provider")

    async def _mark_workspace_error_by_id(
        _workspace_id,
        message: str,
        **_kwargs,
    ) -> None:
        marked_errors.append(message)

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))

    async def _build_workspace_detail(_user_id, _workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "_require_cloud_workspace_for_user",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot", _billing_snapshot)
    monkeypatch.setattr(
        workspace_service,
        "load_cloud_credential_statuses",
        _credential_statuses,
    )
    monkeypatch.setattr(
        workspace_service,
        "load_active_sandbox_for_workspace",
        _load_active_sandbox,
    )
    monkeypatch.setattr(workspace_service, "get_sandbox_provider", lambda _kind: _Provider())
    monkeypatch.setattr(
        workspace_service,
        "mark_workspace_error_by_id",
        _mark_workspace_error_by_id,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
    )

    payload = await workspace_service.start_cloud_workspace(user, workspace.id)

    assert payload.status == workspace_service.WorkspaceStatus.queued
    assert workspace.status == workspace_service.WorkspaceStatus.queued
    assert workspace.last_error is None
    assert marked_errors and "Sandbox missing from provider" in marked_errors[0]
    assert saved_statuses == [(workspace_service.WorkspaceStatus.queued, None)]
    assert scheduled == [workspace.id]


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_queued_workspace_for_mobility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.WorkspaceStatus.queued,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        last_error="stale error",
        ready_at=None,
    )
    scheduled: list[tuple[object, object]] = []
    saved_statuses: list[tuple[object, object]] = []
    refreshed_env_snapshots: list[object] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _billing_snapshot(_user_id) -> BillingSnapshot:
        return _unblocked_billing_snapshot()

    async def _credential_statuses(_user_id):
        return [SimpleNamespace(provider="claude", synced=True)]

    async def _refresh_repo_env_snapshot_for_workspace(_workspace):
        refreshed_env_snapshots.append(_workspace.id)
        return _workspace

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))
        return _workspace

    async def _build_workspace_detail(_user_id, _workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "_require_cloud_workspace_for_user",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot", _billing_snapshot)
    monkeypatch.setattr(
        workspace_service,
        "load_cloud_credential_statuses",
        _credential_statuses,
    )
    monkeypatch.setattr(
        workspace_service,
        "_refresh_repo_env_snapshot_for_workspace",
        _refresh_repo_env_snapshot_for_workspace,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id, **kwargs: scheduled.append(
            (workspace_id, kwargs.get("requested_base_sha"))
        ),
    )

    payload = await workspace_service.start_cloud_workspace(
        user,
        workspace.id,
        requested_base_sha="abc123",
    )

    assert payload.status == workspace_service.WorkspaceStatus.queued
    assert refreshed_env_snapshots == [workspace.id]
    assert saved_statuses == [(workspace_service.WorkspaceStatus.queued, None)]
    assert scheduled == [(workspace.id, "abc123")]


@pytest.mark.asyncio
async def test_start_cloud_workspace_marks_ready_when_reconnect_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status="stopped",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error=None,
        status_detail="Stopped",
        updated_at=datetime.now(UTC),
        ready_at=datetime.now(UTC),
    )
    sandbox = SimpleNamespace(
        id=uuid4(),
        provider="e2b",
        external_sandbox_id="sandbox-123",
    )
    saved_statuses: list[tuple[object, object]] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _billing_snapshot(_user_id) -> BillingSnapshot:
        return _unblocked_billing_snapshot()

    async def _credential_statuses(_user_id):
        return [SimpleNamespace(provider="claude", synced=True)]

    async def _load_active_sandbox(_workspace):
        return sandbox

    class _Provider:
        async def get_sandbox_state(self, _sandbox_id: str):
            return SimpleNamespace(state="running")

    async def _ensure_runtime_ready(*_args, **_kwargs) -> str:
        return "https://runtime.invalid"

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.status_detail))

    async def _build_workspace_detail(_user_id, _workspace):
        return SimpleNamespace(status=_workspace.status)

    async def _load_workspace_by_id(_workspace_id):
        return workspace

    monkeypatch.setattr(
        workspace_service,
        "_require_cloud_workspace_for_user",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot", _billing_snapshot)
    monkeypatch.setattr(
        workspace_service,
        "load_cloud_credential_statuses",
        _credential_statuses,
    )
    monkeypatch.setattr(
        workspace_service,
        "load_active_sandbox_for_workspace",
        _load_active_sandbox,
    )
    monkeypatch.setattr(workspace_service, "get_sandbox_provider", lambda _kind: _Provider())
    monkeypatch.setattr(workspace_service, "decrypt_text", lambda _ciphertext: "runtime-token")
    monkeypatch.setattr(
        workspace_service,
        "ensure_workspace_runtime_ready",
        _ensure_runtime_ready,
    )
    monkeypatch.setattr(workspace_service, "load_cloud_workspace_by_id", _load_workspace_by_id)
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)

    payload = await workspace_service.start_cloud_workspace(user, workspace.id)

    assert payload.status == workspace_service.WorkspaceStatus.ready
    assert workspace.status == workspace_service.WorkspaceStatus.ready
    assert saved_statuses == [(workspace_service.WorkspaceStatus.ready, "Ready")]
