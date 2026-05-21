from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.db.store.cloud_mobility import (
    CloudWorkspaceHandoffOpValue,
    CloudWorkspaceMobilityValue,
    CloudWorkspaceMoveCleanupItemValue,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mobility import service as mobility_service
from proliferate.server.cloud.mobility.domain.lifecycle import (
    HANDOFF_PHASE_HANDOFF_FAILED,
    LIFECYCLE_HANDOFF_FAILED,
)


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


def _cleanup_item(
    *,
    handoff_op_id,
    item_kind: str,
    status: str = "pending",
) -> CloudWorkspaceMoveCleanupItemValue:
    now = datetime.now(UTC)
    return CloudWorkspaceMoveCleanupItemValue(
        id=uuid4(),
        handoff_op_id=handoff_op_id,
        item_kind=item_kind,
        target_id=None,
        anyharness_workspace_id="workspace-1" if item_kind == "anyharness_workspace" else None,
        object_id=uuid4() if item_kind != "worker_projection_cursor" else None,
        status=status,
        attempt_count=0,
        next_attempt_at=now,
        error_code=None,
        error_message=None,
        started_at=None,
        completed_at=None,
        created_at=now,
        updated_at=now,
    )


async def _noop_expire(*, user_id):
    return None


@pytest.mark.asyncio
async def test_list_mobility_skips_error_cloud_workspace_backfill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    backfilled: list[object] = []

    async def _list_workspaces(_user_id):
        assert _user_id == user_id
        return [SimpleNamespace(status=CloudWorkspaceStatus.error.value)]

    async def _backfill(**kwargs):
        backfilled.append(kwargs["workspace"])

    async def _list_mobility(**kwargs):
        assert kwargs["user_id"] == user_id
        return []

    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "list_cloud_workspaces_store", _list_workspaces)
    monkeypatch.setattr(
        mobility_service,
        "backfill_cloud_workspace_mobility_for_workspace",
        _backfill,
    )
    monkeypatch.setattr(
        mobility_service,
        "list_cloud_workspace_mobility_store",
        _list_mobility,
    )

    assert await mobility_service.list_cloud_workspace_mobility_for_user(user_id) == []
    assert backfilled == []


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

    async def _load_active_user_handoff(*, user_id, **_kwargs):
        return None

    async def _load_user(_user_id):
        return SimpleNamespace(id=_user_id)

    async def _repo_branches(*_args, **_kwargs):
        return SimpleNamespace(
            branches=["feature/cloud"],
            branch_heads_by_name={"feature/cloud": "abc123"},
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
    assert "handoff already in progress for workspace" in response.blockers


@pytest.mark.asyncio
async def test_preflight_blocks_when_github_repo_access_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _workspace()

    async def _get_detail(**_kwargs):
        return workspace

    async def _load_active_user_handoff(*, user_id, **_kwargs):
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
async def test_preflight_blocks_when_branch_is_not_published(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _workspace()

    async def _get_detail(**_kwargs):
        return workspace

    async def _load_active_user_handoff(*, user_id, **_kwargs):
        return None

    async def _load_user(_user_id):
        return SimpleNamespace(id=_user_id)

    async def _repo_branches(*_args, **_kwargs):
        return SimpleNamespace(
            branches=["main"],
            branch_heads_by_name={"main": "def456"},
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
    assert response.blockers == ["The branch 'feature/cloud' was not found on GitHub."]


@pytest.mark.asyncio
async def test_preflight_blocks_when_github_branch_head_is_behind_requested_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _workspace()

    async def _get_detail(**_kwargs):
        return workspace

    async def _load_active_user_handoff(*, user_id, **_kwargs):
        return None

    async def _load_user(_user_id):
        return SimpleNamespace(id=_user_id)

    async def _repo_branches(*_args, **_kwargs):
        return SimpleNamespace(
            branches=["feature/cloud"],
            branch_heads_by_name={"feature/cloud": "def456"},
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
        "The branch 'feature/cloud' on GitHub is not at the requested commit."
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
        "fail_cloud_workspace_handoff_op_checkpoint_for_user",
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
            "phase": HANDOFF_PHASE_HANDOFF_FAILED,
            "lifecycle_state": LIFECYCLE_HANDOFF_FAILED,
            "failure_code": "github_repo_access_required",
            "failure_detail": (
                "Reconnect GitHub and grant repository access before creating a cloud workspace."
            ),
            "status_detail": (
                "Reconnect GitHub and grant repository access before creating a cloud workspace."
            ),
            "last_error": (
                "Reconnect GitHub and grant repository access before creating a cloud workspace."
            ),
        }
    ]


@pytest.mark.asyncio
async def test_cleanup_completion_completes_non_server_items_before_server_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    mobility_workspace_id = uuid4()
    handoff = _handoff(mobility_workspace_id=mobility_workspace_id)
    server_item = _cleanup_item(
        handoff_op_id=handoff.id,
        item_kind="cloud_session_projection",
    )
    non_server_item = _cleanup_item(
        handoff_op_id=handoff.id,
        item_kind="anyharness_workspace",
    )
    terminal_server_item = _cleanup_item(
        handoff_op_id=handoff.id,
        item_kind="cloud_workspace",
    )
    items = [server_item, non_server_item, terminal_server_item]
    statuses = {item.id: item.status for item in items}
    executed_server_items: list[str] = []

    def _current_value(
        item: CloudWorkspaceMoveCleanupItemValue,
    ) -> CloudWorkspaceMoveCleanupItemValue:
        return CloudWorkspaceMoveCleanupItemValue(
            id=item.id,
            handoff_op_id=item.handoff_op_id,
            item_kind=item.item_kind,
            target_id=item.target_id,
            anyharness_workspace_id=item.anyharness_workspace_id,
            object_id=item.object_id,
            status=statuses[item.id],
            attempt_count=item.attempt_count,
            next_attempt_at=item.next_attempt_at,
            error_code=item.error_code,
            error_message=item.error_message,
            started_at=item.started_at,
            completed_at=item.completed_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    async def _list_cleanup_items(*_args, **_kwargs):
        return [_current_value(item) for item in items]

    async def _get_cleanup_item(*_args, **kwargs):
        cleanup_item_id = kwargs["cleanup_item_id"]
        item = next(item for item in items if item.id == cleanup_item_id)
        return SimpleNamespace(id=item.id, item_kind=item.item_kind)

    async def _update_cleanup_item_status(*_args, **kwargs):
        cleanup_item = kwargs["cleanup_item"]
        statuses[cleanup_item.id] = kwargs["status"]
        return _current_value(next(item for item in items if item.id == cleanup_item.id))

    async def _execute_server_cleanup_item(*_args, **kwargs):
        assert statuses[non_server_item.id] == "completed"
        cleanup_item_id = kwargs["cleanup_item_id"]
        executed_server_items.append(str(cleanup_item_id))
        statuses[cleanup_item_id] = "completed"

    async def _complete_for_user(*_args, **_kwargs):
        return CloudWorkspaceHandoffOpValue(
            id=handoff.id,
            mobility_workspace_id=mobility_workspace_id,
            user_id=user_id,
            direction=handoff.direction,
            source_owner=handoff.source_owner,
            target_owner=handoff.target_owner,
            phase="completed",
            canonical_side="destination",
            requested_branch=handoff.requested_branch,
            requested_base_sha=handoff.requested_base_sha,
            exclude_paths=handoff.exclude_paths,
            failure_code=None,
            failure_detail=None,
            started_at=handoff.started_at,
            heartbeat_at=handoff.heartbeat_at,
            finalized_at=handoff.finalized_at,
            cleanup_completed_at=datetime.now(UTC),
            created_at=handoff.created_at,
            updated_at=datetime.now(UTC),
        )

    monkeypatch.setattr(
        mobility_service,
        "expire_stale_cloud_workspace_handoffs_for_user",
        _noop_expire,
    )
    monkeypatch.setattr(mobility_service, "list_cleanup_items_for_handoff", _list_cleanup_items)
    monkeypatch.setattr(mobility_service, "get_cleanup_item_for_handoff", _get_cleanup_item)
    monkeypatch.setattr(
        mobility_service,
        "update_cleanup_item_status",
        _update_cleanup_item_status,
    )
    monkeypatch.setattr(
        mobility_service,
        "execute_server_cleanup_item",
        _execute_server_cleanup_item,
    )
    monkeypatch.setattr(
        mobility_service,
        "complete_cloud_workspace_handoff_cleanup_for_user",
        _complete_for_user,
    )

    completed = await mobility_service.complete_cloud_workspace_handoff_cleanup(
        db=SimpleNamespace(),
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff.id,
    )

    assert completed.phase == "completed"
    assert statuses == {
        server_item.id: "completed",
        non_server_item.id: "completed",
        terminal_server_item.id: "completed",
    }
    assert executed_server_items == [str(server_item.id), str(terminal_server_item.id)]
