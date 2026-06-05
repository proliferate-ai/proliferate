from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.constants.billing import WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.server.billing.models import SandboxStartAuthorization
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces.provisioning import service as provisioning_service
from tests.unit.db_session_helpers import NoopDb, patch_async_session_factory

INTERACT_WITH_DB = "cloud_workspace_user_can_interact_with_db"


def _patch_session_factory(monkeypatch: pytest.MonkeyPatch) -> NoopDb:
    return patch_async_session_factory(monkeypatch, provisioning_service.db_session.db_engine)


def _denied_start_authorization(*, blocked_reason: str) -> SandboxStartAuthorization:
    return SandboxStartAuthorization(
        allowed=False,
        billing_subject_id=uuid4(),
        start_blocked=True,
        start_block_reason=blocked_reason,
        active_spend_hold=False,
        hold_reason=None,
        message="Sandbox limit reached. Archive or delete another cloud workspace before starting "
        "a new one.",
        active_sandbox_count=2,
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

    async def _require_workspace(_db, _user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _denied_start_authorization(
            blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("workspace start should stop before credential/runtime work")

    monkeypatch.setattr(provisioning_service, INTERACT_WITH_DB, _require_workspace)
    monkeypatch.setattr(provisioning_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(provisioning_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        provisioning_service,
        "load_personal_agent_auth_agent_kinds",
        _unexpected,
    )
    monkeypatch.setattr(provisioning_service, "save_workspace", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await provisioning_service.start_cloud_workspace(NoopDb(), user, uuid4())

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
        status=CloudWorkspaceStatus.error.value,
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

    async def _require_workspace(_db, _user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _save_workspace(_db, _workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))
        return _workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(provisioning_service, INTERACT_WITH_DB, _require_workspace)
    monkeypatch.setattr(provisioning_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(provisioning_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        provisioning_service,
        "load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(provisioning_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(provisioning_service, "build_workspace_detail", _build_workspace_detail)
    _patch_session_factory(monkeypatch)
    monkeypatch.setattr(
        provisioning_service,
        "schedule_workspace_provision",
        lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
    )

    payload = await provisioning_service.start_cloud_workspace(NoopDb(), user, workspace.id)

    assert payload.status == CloudWorkspaceStatus.materializing.value
    assert workspace.status == CloudWorkspaceStatus.materializing.value
    assert workspace.last_error is None
    assert saved_statuses == [(CloudWorkspaceStatus.materializing.value, None)]
    assert scheduled == [workspace.id]


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_queued_workspace_for_mobility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=CloudWorkspaceStatus.pending.value,
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

    async def _require_workspace(_db, _user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _refresh_repo_env_snapshot_for_workspace(_workspace):
        refreshed_env_snapshots.append(_workspace.id)
        return _workspace

    async def _save_workspace(_db, _workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))
        return _workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(provisioning_service, INTERACT_WITH_DB, _require_workspace)
    monkeypatch.setattr(provisioning_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(provisioning_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        provisioning_service,
        "load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(
        provisioning_service,
        "_refresh_repo_env_snapshot_for_workspace",
        _refresh_repo_env_snapshot_for_workspace,
    )
    monkeypatch.setattr(provisioning_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(provisioning_service, "build_workspace_detail", _build_workspace_detail)
    _patch_session_factory(monkeypatch)
    monkeypatch.setattr(
        provisioning_service,
        "schedule_workspace_provision",
        lambda workspace_id, **kwargs: scheduled.append(
            (workspace_id, kwargs.get("requested_base_sha"))
        ),
    )

    payload = await provisioning_service.start_cloud_workspace(
        NoopDb(),
        user,
        workspace.id,
        requested_base_sha="abc123",
    )

    assert payload.status == CloudWorkspaceStatus.pending.value
    assert refreshed_env_snapshots == [workspace.id]
    assert saved_statuses == [(CloudWorkspaceStatus.pending.value, None)]
    assert scheduled == [(workspace.id, "abc123")]


@pytest.mark.asyncio
async def test_start_cloud_workspace_returns_ready_workspace_without_requeue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=CloudWorkspaceStatus.ready.value,
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

    async def _require_workspace(_db, _user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("ready workspace should not schedule provisioning work")

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(provisioning_service, INTERACT_WITH_DB, _require_workspace)
    monkeypatch.setattr(provisioning_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(provisioning_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        provisioning_service,
        "load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(provisioning_service, "save_workspace", _unexpected)
    monkeypatch.setattr(provisioning_service, "schedule_workspace_provision", _unexpected)
    monkeypatch.setattr(provisioning_service, "build_workspace_detail", _build_workspace_detail)

    payload = await provisioning_service.start_cloud_workspace(NoopDb(), user, workspace.id)

    assert payload.status == CloudWorkspaceStatus.ready.value
    assert workspace.status == CloudWorkspaceStatus.ready.value


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_ready_workspace_for_requested_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=CloudWorkspaceStatus.ready.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error="old error",
        status_detail="Ready",
        updated_at=datetime.now(UTC),
        ready_at=datetime.now(UTC),
    )
    scheduled: list[tuple[object, object]] = []
    saved_statuses: list[tuple[object, object, object]] = []

    async def _require_workspace(_db, _user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _save_workspace(_db, _workspace):
        saved_statuses.append((_workspace.status, _workspace.status_detail, _workspace.last_error))
        return _workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(provisioning_service, INTERACT_WITH_DB, _require_workspace)
    monkeypatch.setattr(provisioning_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(provisioning_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        provisioning_service,
        "load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(provisioning_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(provisioning_service, "build_workspace_detail", _build_workspace_detail)
    _patch_session_factory(monkeypatch)
    monkeypatch.setattr(
        provisioning_service,
        "schedule_workspace_provision",
        lambda workspace_id, **kwargs: scheduled.append(
            (workspace_id, kwargs.get("requested_base_sha"))
        ),
    )

    payload = await provisioning_service.start_cloud_workspace(
        NoopDb(),
        user,
        workspace.id,
        requested_base_sha="a" * 40,
    )

    assert payload.status == CloudWorkspaceStatus.materializing.value
    assert saved_statuses == [
        (
            CloudWorkspaceStatus.materializing.value,
            "Preparing requested revision",
            None,
        )
    ]
    assert scheduled == [(workspace.id, "a" * 40)]
