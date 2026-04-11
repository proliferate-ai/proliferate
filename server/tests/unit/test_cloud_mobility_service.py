from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.db.store.cloud_mobility import (
    CloudWorkspaceHandoffOpValue,
    CloudWorkspaceMobilityValue,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mobility import service as mobility_service


def _workspace(
    *,
    owner: str = "local",
    workspace_id=None,
    active_handoff: CloudWorkspaceHandoffOpValue | None = None,
):
    now = datetime.now(UTC)
    return CloudWorkspaceMobilityValue(
        id=workspace_id or uuid4(),
        user_id=uuid4(),
        display_name="Rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        cloud_lost_at=None,
        cloud_lost_reason=None,
        owner=owner,
        lifecycle_state="ready",
        status_detail=None,
        last_error=None,
        cloud_workspace_id=None,
        active_handoff_op_id=active_handoff.id if active_handoff is not None else None,
        last_handoff_op_id=active_handoff.id if active_handoff is not None else None,
        active_handoff=active_handoff,
        created_at=now,
        updated_at=now,
    )


def _handoff(*, mobility_workspace_id=None) -> CloudWorkspaceHandoffOpValue:
    now = datetime.now(UTC)
    return CloudWorkspaceHandoffOpValue(
        id=uuid4(),
        mobility_workspace_id=mobility_workspace_id or uuid4(),
        user_id=uuid4(),
        direction="local_to_cloud",
        source_owner="local",
        target_owner="cloud",
        phase="start_requested",
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
        exclude_paths=(),
        failure_code=None,
        failure_detail=None,
        started_at=now,
        heartbeat_at=now,
        finalized_at=None,
        cleanup_completed_at=None,
        created_at=now,
        updated_at=now,
    )


async def _noop_expire(*, user_id):
    return None


@pytest.mark.asyncio
async def test_preflight_blocks_when_workspace_handoff_is_already_active(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id = uuid4()
    workspace = _workspace(
        workspace_id=workspace_id,
        active_handoff=_handoff(mobility_workspace_id=workspace_id),
    )

    async def _get_detail(**_kwargs):
        return workspace

    async def _load_active_user_handoff(*, user_id):
        return None

    async def _load_user(_user_id):
        return SimpleNamespace(id=_user_id)

    async def _repo_branches(*_args, **_kwargs):
        return SimpleNamespace(branches=["feature/cloud"])

    async def _load_repo_config(**_kwargs):
        return None

    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_mobility_detail", _get_detail)
    monkeypatch.setattr(
        mobility_service,
        "load_active_user_handoff_op_for_user",
        _load_active_user_handoff,
    )
    monkeypatch.setattr(
        mobility_service,
        "load_user_with_oauth_accounts_by_id",
        _load_user,
    )
    monkeypatch.setattr(mobility_service, "get_repo_branches_for_user", _repo_branches)
    monkeypatch.setattr(mobility_service, "load_cloud_repo_config_for_user", _load_repo_config)

    response = await mobility_service.preflight_cloud_workspace_handoff(
        user_id=uuid4(),
        mobility_workspace_id=workspace.id,
        direction="local_to_cloud",
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
    )

    assert response.can_start is False
    assert "handoff already in progress for workspace" in response.blockers


@pytest.mark.asyncio
async def test_preflight_blocks_when_github_repo_access_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _workspace()

    async def _get_detail(**_kwargs):
        return workspace

    async def _load_active_user_handoff(*, user_id):
        return None

    async def _load_user(_user_id):
        return SimpleNamespace(id=_user_id)

    async def _repo_branches(*_args, **_kwargs):
        raise CloudApiError(
            "github_repo_access_required",
            "Reconnect GitHub and grant repository access before moving this workspace to cloud.",
            status_code=400,
        )

    async def _load_repo_config(**_kwargs):
        return None

    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_mobility_detail", _get_detail)
    monkeypatch.setattr(
        mobility_service,
        "load_active_user_handoff_op_for_user",
        _load_active_user_handoff,
    )
    monkeypatch.setattr(
        mobility_service,
        "load_user_with_oauth_accounts_by_id",
        _load_user,
    )
    monkeypatch.setattr(mobility_service, "get_repo_branches_for_user", _repo_branches)
    monkeypatch.setattr(mobility_service, "load_cloud_repo_config_for_user", _load_repo_config)

    response = await mobility_service.preflight_cloud_workspace_handoff(
        user_id=uuid4(),
        mobility_workspace_id=workspace.id,
        direction="local_to_cloud",
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
    )

    assert response.can_start is False
    assert response.blockers == [
        "Reconnect GitHub and grant repository access before moving this workspace to cloud."
    ]


@pytest.mark.asyncio
async def test_start_handoff_maps_existing_workspace_conflict_to_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = _workspace()

    async def _get_detail(**_kwargs):
        return workspace

    async def _preflight(**_kwargs):
        return SimpleNamespace(can_start=True, blockers=[])

    async def _create(**_kwargs):
        raise ValueError("handoff already in progress for workspace")

    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_mobility_detail", _get_detail)
    monkeypatch.setattr(mobility_service, "preflight_cloud_workspace_handoff", _preflight)
    monkeypatch.setattr(
        mobility_service,
        "create_cloud_workspace_handoff_op_for_user",
        _create,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await mobility_service.start_cloud_workspace_handoff(
            user_id=user_id,
            mobility_workspace_id=workspace.id,
            direction="local_to_cloud",
            requested_branch="feature/cloud",
            requested_base_sha="abc123",
            exclude_paths=[],
        )

    assert exc_info.value.code == "handoff_already_in_progress"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_start_local_to_cloud_marks_handoff_failed_when_cloud_setup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = _workspace()
    handoff = _handoff(mobility_workspace_id=workspace.id)
    failed_calls: list[dict[str, object]] = []

    async def _get_detail(**_kwargs):
        return workspace

    async def _preflight(**_kwargs):
        return SimpleNamespace(can_start=True, blockers=[])

    async def _create(**_kwargs):
        return handoff

    async def _load_user(_user_id):
        return SimpleNamespace(id=_user_id)

    async def _ensure_cloud_workspace(*_args, **_kwargs):
        raise CloudApiError(
            "github_repo_access_required",
            "Reconnect GitHub and grant repository access before creating a cloud workspace.",
            status_code=400,
        )

    async def _fail_handoff(**kwargs):
        failed_calls.append(kwargs)
        return handoff

    async def _unexpected_start_cloud_workspace(*_args, **_kwargs):
        raise AssertionError("cloud workspace start should not run after ensure failure")

    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_mobility_detail", _get_detail)
    monkeypatch.setattr(mobility_service, "preflight_cloud_workspace_handoff", _preflight)
    monkeypatch.setattr(
        mobility_service,
        "create_cloud_workspace_handoff_op_for_user",
        _create,
    )
    monkeypatch.setattr(
        mobility_service,
        "load_user_with_oauth_accounts_by_id",
        _load_user,
    )
    monkeypatch.setattr(
        mobility_service,
        "ensure_cloud_workspace_for_existing_branch",
        _ensure_cloud_workspace,
    )
    monkeypatch.setattr(
        mobility_service,
        "fail_cloud_workspace_handoff_op_for_user",
        _fail_handoff,
    )
    monkeypatch.setattr(
        mobility_service,
        "start_cloud_workspace",
        _unexpected_start_cloud_workspace,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await mobility_service.start_cloud_workspace_handoff(
            user_id=user_id,
            mobility_workspace_id=workspace.id,
            direction="local_to_cloud",
            requested_branch="feature/cloud",
            requested_base_sha="abc123",
            exclude_paths=[],
        )

    assert exc_info.value.code == "github_repo_access_required"
    assert exc_info.value.status_code == 400
    assert failed_calls == [
        {
            "user_id": user_id,
            "mobility_workspace_id": workspace.id,
            "handoff_op_id": handoff.id,
            "failure_code": "github_repo_access_required",
            "failure_detail": (
                "Reconnect GitHub and grant repository access before creating a cloud workspace."
            ),
        }
    ]
