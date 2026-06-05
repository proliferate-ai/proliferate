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
from proliferate.server.cloud.mobility.preflight import service as preflight_service

REQUESTED_SHA = "a" * 40


def _workspace(
    *,
    owner: str = "local",
    user_id=None,
    active_handoff: CloudWorkspaceHandoffOpValue | None = None,
    cloud_lost_at=None,
) -> CloudWorkspaceMobilityValue:
    now = datetime.now(UTC)
    return CloudWorkspaceMobilityValue(
        id=uuid4(),
        user_id=user_id or uuid4(),
        display_name="Rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        cloud_lost_at=cloud_lost_at,
        cloud_lost_reason=None,
        owner=owner,
        lifecycle_state=f"{owner}_active",
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
        requested_base_sha=REQUESTED_SHA,
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


async def _noop_expire(*_args, **_kwargs):
    return None


def _stub_common_preflight_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    *,
    workspace: CloudWorkspaceMobilityValue,
    active_handoff: CloudWorkspaceHandoffOpValue | None = None,
) -> None:
    async def _get_detail(*_args, **_kwargs):
        return workspace

    async def _load_active_user_handoff(*_args, user_id, **_kwargs):
        return active_handoff

    async def _load_user(_db, _user_id):
        return SimpleNamespace(id=_user_id)

    async def _repo_branches(*_args, **_kwargs):
        return SimpleNamespace(
            branches=["feature/cloud"],
            branch_heads_by_name={"feature/cloud": REQUESTED_SHA},
        )

    async def _load_repo_config(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        preflight_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(preflight_service, "get_cloud_workspace_mobility_detail", _get_detail)
    monkeypatch.setattr(
        preflight_service,
        "load_active_user_handoff_op_for_user",
        _load_active_user_handoff,
    )
    monkeypatch.setattr(
        preflight_service,
        "load_user_with_oauth_accounts_by_id",
        _load_user,
    )
    monkeypatch.setattr(preflight_service, "get_repo_branches_for_user", _repo_branches)
    monkeypatch.setattr(preflight_service, "load_cloud_repo_config_for_user", _load_repo_config)


@pytest.mark.asyncio
async def test_preflight_blocks_another_active_handoff_for_same_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = _workspace(user_id=user_id)
    other_handoff = _handoff(mobility_workspace_id=uuid4())
    _stub_common_preflight_dependencies(
        monkeypatch,
        workspace=workspace,
        active_handoff=other_handoff,
    )

    response = await preflight_service.preflight_cloud_workspace_handoff(
        object(),
        user_id=user_id,
        mobility_workspace_id=workspace.id,
        direction="local_to_cloud",
        requested_branch="feature/cloud",
        requested_base_sha=REQUESTED_SHA,
    )

    assert response.can_start is False
    assert response.blockers[0].code == "user_handoff_in_progress"
    assert response.blockers[0].message == "Another handoff is already in progress for this user."


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("owner", "direction", "blocker"),
    [
        ("cloud", "local_to_cloud", "workspace is not currently local-owned"),
        ("local", "cloud_to_local", "workspace is not currently cloud-owned"),
    ],
)
async def test_preflight_blocks_owner_direction_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    owner: str,
    direction: str,
    blocker: str,
) -> None:
    workspace = _workspace(owner=owner)
    _stub_common_preflight_dependencies(monkeypatch, workspace=workspace)

    response = await preflight_service.preflight_cloud_workspace_handoff(
        object(),
        user_id=uuid4(),
        mobility_workspace_id=workspace.id,
        direction=direction,
        requested_branch="feature/cloud",
        requested_base_sha=REQUESTED_SHA,
    )

    assert response.can_start is False
    assert response.blockers[0].code == "owner_mismatch"
    assert response.blockers[0].message == blocker


@pytest.mark.asyncio
async def test_preflight_blocks_cloud_lost_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _workspace(cloud_lost_at=datetime.now(UTC))
    _stub_common_preflight_dependencies(monkeypatch, workspace=workspace)

    response = await preflight_service.preflight_cloud_workspace_handoff(
        object(),
        user_id=uuid4(),
        mobility_workspace_id=workspace.id,
        direction="local_to_cloud",
        requested_branch="feature/cloud",
        requested_base_sha=REQUESTED_SHA,
    )

    assert response.can_start is False
    assert response.blockers[0].code == "cloud_lost"
    assert response.blockers[0].message == "Cloud workspace is in cloud_lost state."


@pytest.mark.asyncio
async def test_start_local_to_cloud_creates_handoff_before_provisioning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = _workspace(user_id=user_id)
    handoff = _handoff(mobility_workspace_id=workspace.id)
    cloud_workspace_id = uuid4()
    events: list[str] = []

    async def _get_detail(*_args, **_kwargs):
        return workspace

    async def _preflight(*_args, **_kwargs):
        return SimpleNamespace(can_start=True, blockers=[])

    async def _create(*_args, **_kwargs):
        events.append("handoff_created")
        return handoff

    async def _checkpoint_expire(*_args, **_kwargs):
        events.append("stale_expired_checkpoint")

    async def _load_user(_db, _user_id):
        return SimpleNamespace(id=_user_id)

    async def _ensure_cloud_workspace(*_args, **_kwargs):
        assert events == ["stale_expired_checkpoint", "handoff_created"]
        events.append("workspace_ensured")
        return SimpleNamespace(id=cloud_workspace_id)

    async def _start_cloud_workspace(*_args, **_kwargs):
        assert events == ["stale_expired_checkpoint", "handoff_created", "workspace_ensured"]
        events.append("workspace_started")

    async def _update_phase(*_args, **kwargs):
        events.append("phase_updated")
        assert kwargs["handoff_op_id"] == handoff.id
        assert kwargs["phase"] == "start_requested"
        assert kwargs["cloud_workspace_id"] == cloud_workspace_id
        return handoff

    monkeypatch.setattr(
        mobility_service.mobility_tx,
        "expire_stale_handoffs_tx",
        _checkpoint_expire,
    )
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_mobility_detail", _get_detail)
    monkeypatch.setattr(preflight_service, "preflight_cloud_workspace_handoff", _preflight)
    monkeypatch.setattr(
        mobility_service.mobility_tx,
        "create_cloud_workspace_handoff_op_checkpoint_tx",
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
    monkeypatch.setattr(mobility_service, "start_cloud_workspace", _start_cloud_workspace)
    monkeypatch.setattr(
        mobility_service.mobility_tx,
        "update_cloud_workspace_handoff_phase_checkpoint_tx",
        _update_phase,
    )

    await mobility_service.start_cloud_workspace_handoff(
        object(),
        user_id=user_id,
        mobility_workspace_id=workspace.id,
        direction="local_to_cloud",
        requested_branch="feature/cloud",
        requested_base_sha=REQUESTED_SHA,
        exclude_paths=[],
    )

    assert events == [
        "stale_expired_checkpoint",
        "handoff_created",
        "workspace_ensured",
        "workspace_started",
        "phase_updated",
    ]


@pytest.mark.asyncio
async def test_start_cloud_to_local_creates_handoff_without_cloud_provisioning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = _workspace(user_id=user_id, owner="cloud")
    handoff = _handoff(mobility_workspace_id=workspace.id)
    events: list[str] = []

    async def _get_detail(*_args, **_kwargs):
        return workspace

    async def _preflight(*_args, **_kwargs):
        return SimpleNamespace(can_start=True, blockers=[])

    async def _create(*_args, **_kwargs):
        events.append("handoff_created")
        return handoff

    async def _unexpected(*_args, **_kwargs):
        raise AssertionError("cloud provisioning should not run for cloud_to_local")

    monkeypatch.setattr(
        mobility_service.mobility_tx,
        "expire_stale_handoffs_tx",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_mobility_detail", _get_detail)
    monkeypatch.setattr(preflight_service, "preflight_cloud_workspace_handoff", _preflight)
    monkeypatch.setattr(
        mobility_service.mobility_tx,
        "create_cloud_workspace_handoff_op_checkpoint_tx",
        _create,
    )
    monkeypatch.setattr(
        mobility_service,
        "ensure_cloud_workspace_for_existing_branch",
        _unexpected,
    )
    monkeypatch.setattr(mobility_service, "start_cloud_workspace", _unexpected)

    result = await mobility_service.start_cloud_workspace_handoff(
        object(),
        user_id=user_id,
        mobility_workspace_id=workspace.id,
        direction="cloud_to_local",
        requested_branch="feature/cloud",
        requested_base_sha=REQUESTED_SHA,
        exclude_paths=[],
    )

    assert result == handoff
    assert events == ["handoff_created"]


@pytest.mark.asyncio
async def test_update_handoff_phase_rejects_unsupported_phase(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await mobility_service.update_cloud_workspace_handoff_phase(
            object(),
            user_id=uuid4(),
            mobility_workspace_id=uuid4(),
            handoff_op_id=uuid4(),
            phase="teleported",
            status_detail=None,
            cloud_workspace_id=None,
        )

    assert exc_info.value.code == "invalid_handoff_phase"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_update_handoff_phase_rejects_invalid_transition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id = uuid4()

    async def _get_handoff(*_args, **_kwargs):
        return SimpleNamespace(
            id=uuid4(),
            mobility_workspace_id=workspace_id,
            phase="start_requested",
        )

    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_handoff_op", _get_handoff)

    with pytest.raises(CloudApiError) as exc_info:
        await mobility_service.update_cloud_workspace_handoff_phase(
            object(),
            user_id=uuid4(),
            mobility_workspace_id=workspace_id,
            handoff_op_id=uuid4(),
            phase="install_succeeded",
            status_detail=None,
            cloud_workspace_id=None,
        )

    assert exc_info.value.code == "invalid_handoff_phase"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_finalize_requires_cloud_destination_for_cloud_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _workspace(owner="local")

    async def _get_detail(*_args, **_kwargs):
        return workspace

    async def _get_handoff(*_args, **_kwargs):
        return SimpleNamespace(
            id=uuid4(),
            mobility_workspace_id=workspace.id,
            phase="install_succeeded",
            target_owner="cloud",
        )

    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_mobility_detail", _get_detail)
    monkeypatch.setattr(mobility_service, "get_cloud_workspace_handoff_op", _get_handoff)

    with pytest.raises(CloudApiError) as exc_info:
        await mobility_service.finalize_cloud_workspace_handoff(
            object(),
            user_id=uuid4(),
            mobility_workspace_id=workspace.id,
            handoff_op_id=uuid4(),
            cloud_workspace_id=None,
        )

    assert exc_info.value.code == "destination_workspace_required"
    assert exc_info.value.status_code == 400
