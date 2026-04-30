from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.constants.billing import (
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
)
from proliferate.server.billing.models import SandboxStartAuthorization
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import service as workspace_service


def _denied_start_authorization(*, blocked_reason: str) -> SandboxStartAuthorization:
    return SandboxStartAuthorization(
        allowed=False,
        billing_subject_id=uuid4(),
        start_blocked=True,
        start_block_reason=blocked_reason,
        active_spend_hold=blocked_reason != WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
        hold_reason=(
            None
            if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
            else blocked_reason
        ),
        message=(
            "Sandbox limit reached. Archive or delete another cloud workspace before starting "
            "a new one."
            if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
            else "Cloud usage is paused because your included sandbox hours are exhausted."
        ),
        active_sandbox_count=(
            2 if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT else 0
        ),
        remaining_seconds=0.0,
    )


def _allowed_start_authorization() -> SandboxStartAuthorization:
    return SandboxStartAuthorization(
        allowed=True,
        billing_subject_id=uuid4(),
        start_blocked=False,
        start_block_reason=None,
        active_spend_hold=False,
        hold_reason=None,
        message=None,
        active_sandbox_count=0,
        remaining_seconds=19.0 * 3600.0,
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

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _denied_start_authorization(
            blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("downstream workspace creation should not run when billing blocks")

    async def _repo_config_value(**_kwargs):
        return SimpleNamespace(configured=True, env_vars={}, default_branch=None)

    monkeypatch.setattr(workspace_service, "get_linked_github_account", lambda _user: object())
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "load_existing_cloud_workspace", _existing_workspace)
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
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
async def test_automation_workspace_requires_selected_agent_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"], default_branch="main")

    async def _existing_workspace(**_kwargs):
        return None

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _billing_snapshot(_billing_subject_id):
        return SimpleNamespace()

    async def _repo_config_value(**_kwargs):
        return SimpleNamespace(configured=True, default_branch="main")

    async def _credential_statuses(_user_id):
        return [
            SimpleNamespace(provider="claude", synced=True),
            SimpleNamespace(provider="codex", synced=False),
        ]

    monkeypatch.setattr(workspace_service, "get_linked_github_account", lambda _user: object())
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "load_existing_cloud_workspace", _existing_workspace)
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot_for_subject", _billing_snapshot)
    monkeypatch.setattr(workspace_service, "repo_limit_for_billing_snapshot", lambda _snapshot: 4)
    monkeypatch.setattr(workspace_service, "load_cloud_credential_statuses", _credential_statuses)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service._resolve_new_cloud_workspace_create(
            user,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            base_branch=None,
            branch_name="automation/run-123",
            display_name=None,
            required_agent_kind="codex",
        )

    assert exc_info.value.code == "missing_agent_credentials"
    assert exc_info.value.status_code == 400


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

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _denied_start_authorization(
            blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("workspace start should stop before credential/runtime work")

    monkeypatch.setattr(workspace_service, "_require_cloud_workspace_for_user", _require_workspace)
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "load_cloud_credential_statuses", _unexpected)
    monkeypatch.setattr(workspace_service, "save_workspace", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.start_cloud_workspace(user, uuid4())

    assert exc_info.value.code == "quota_exceeded"
    assert exc_info.value.status_code == 403
    assert "Sandbox limit reached" in exc_info.value.message


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_error_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.error.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error="old error",
        status_detail="Error",
        ready_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    saved_statuses: list[tuple[object, object]] = []
    scheduled: list[object] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _credential_statuses(_user_id):
        return [SimpleNamespace(provider="claude", synced=True)]

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "_require_cloud_workspace_for_user",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "load_cloud_credential_statuses",
        _credential_statuses,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
    )

    payload = await workspace_service.start_cloud_workspace(user, workspace.id)

    assert payload.status == workspace_service.CloudWorkspaceStatus.materializing.value
    assert workspace.status == workspace_service.CloudWorkspaceStatus.materializing.value
    assert workspace.last_error is None
    assert saved_statuses == [(workspace_service.CloudWorkspaceStatus.materializing.value, None)]
    assert scheduled == [workspace.id]


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_queued_workspace_for_mobility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.pending.value,
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

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _credential_statuses(_user_id):
        return [SimpleNamespace(provider="claude", synced=True)]

    async def _refresh_repo_env_snapshot_for_workspace(_workspace):
        refreshed_env_snapshots.append(_workspace.id)
        return _workspace

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))
        return _workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "_require_cloud_workspace_for_user",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
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

    assert payload.status == workspace_service.CloudWorkspaceStatus.pending.value
    assert refreshed_env_snapshots == [workspace.id]
    assert saved_statuses == [(workspace_service.CloudWorkspaceStatus.pending.value, None)]
    assert scheduled == [(workspace.id, "abc123")]


@pytest.mark.asyncio
async def test_start_cloud_workspace_returns_ready_workspace_without_requeue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.ready.value,
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

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _credential_statuses(_user_id):
        return [SimpleNamespace(provider="claude", synced=True)]

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("ready workspace should not schedule provisioning work")

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "_require_cloud_workspace_for_user",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "load_cloud_credential_statuses",
        _credential_statuses,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _unexpected)
    monkeypatch.setattr(workspace_service, "schedule_workspace_provision", _unexpected)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)

    payload = await workspace_service.start_cloud_workspace(user, workspace.id)

    assert payload.status == workspace_service.CloudWorkspaceStatus.ready.value
    assert workspace.status == workspace_service.CloudWorkspaceStatus.ready.value
