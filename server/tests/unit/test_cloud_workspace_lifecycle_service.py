from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces.lifecycle import service as lifecycle_service
from tests.unit.db_session_helpers import NoopDb, patch_async_session_factory

ARCHIVE_WITH_DB = "cloud_workspace_user_can_archive_with_db"


def _patch_session_factory(monkeypatch: pytest.MonkeyPatch) -> NoopDb:
    return patch_async_session_factory(monkeypatch, lifecycle_service.db_session.db_engine)


@pytest.mark.asyncio
async def test_delete_cloud_workspace_destroys_runtime_before_archiving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace_id = uuid4()
    workspace = SimpleNamespace(id=workspace_id)
    load_workspace = AsyncMock(return_value=workspace)
    calls: list[tuple[str, object]] = []

    async def _cloud_workspace_user_can_archive(_db, _user_id, _workspace_id):
        assert _user_id == user_id
        assert _workspace_id == workspace_id
        calls.append(("load", _workspace_id))
        return workspace

    async def _revoke_claim_tokens_for_workspace(_workspace, *, reason: str) -> None:
        calls.append(("revoke", reason))

    async def _destroy_workspace_runtime(_workspace) -> None:
        calls.append(("destroy", _workspace.id))

    async def _delete_cloud_workspace_records_for_workspace(_db, _workspace) -> None:
        calls.append(("archive", _workspace.id))

    monkeypatch.setattr(lifecycle_service, ARCHIVE_WITH_DB, _cloud_workspace_user_can_archive)
    monkeypatch.setattr(
        lifecycle_service,
        "_revoke_claim_tokens_for_workspace",
        _revoke_claim_tokens_for_workspace,
    )
    monkeypatch.setattr(
        lifecycle_service,
        "_destroy_workspace_runtime",
        _destroy_workspace_runtime,
    )
    monkeypatch.setattr(lifecycle_service, "load_cloud_workspace_by_id", load_workspace)
    monkeypatch.setattr(
        lifecycle_service,
        "delete_cloud_workspace_records_for_workspace",
        _delete_cloud_workspace_records_for_workspace,
    )
    db = _patch_session_factory(monkeypatch)

    await lifecycle_service.delete_cloud_workspace(db, user_id, workspace_id)

    assert calls == [
        ("load", workspace_id),
        ("revoke", "workspace_deleted"),
        ("destroy", workspace_id),
        ("archive", workspace_id),
    ]


@pytest.mark.asyncio
async def test_archive_cloud_workspace_queues_worker_prune(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = SimpleNamespace(
        id=uuid4(),
        target_id=uuid4(),
        anyharness_workspace_id="workspace-123",
    )
    enqueued: list[tuple[object, object]] = []

    async def _enqueue_command(_db, *, user, body):
        enqueued.append((user.id, body))

    monkeypatch.setattr(lifecycle_service, "enqueue_command", _enqueue_command)

    error = await lifecycle_service._enqueue_archive_prune_command(
        SimpleNamespace(),
        user_id=user_id,
        workspace=workspace,
    )

    assert error is None
    assert len(enqueued) == 1
    actor_id, body = enqueued[0]
    assert actor_id == user_id
    assert body.kind == lifecycle_service.CloudCommandKind.prune_workspace_worktree.value
    assert body.target_id == workspace.target_id
    assert body.workspace_id == workspace.anyharness_workspace_id
    assert body.cloud_workspace_id == workspace.id
    assert body.payload["reason"] == "archive"


@pytest.mark.asyncio
async def test_restore_cloud_workspace_uses_lifecycle_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace_id = uuid4()
    workspace = SimpleNamespace(id=workspace_id, archived_at=object())
    detail = SimpleNamespace(id=str(workspace_id))
    calls: list[tuple[str, object]] = []

    async def _cloud_workspace_user_can_archive_with_db(_db, _user_id, _workspace_id):
        assert _user_id == user_id
        assert _workspace_id == workspace_id
        calls.append(("load_for_lifecycle", _workspace_id))
        return workspace

    async def _restore_cloud_workspace_record(_db, *, workspace: object):
        calls.append(("restore", workspace))
        return workspace

    async def _build_workspace_detail_for_request(_db, _workspace):
        calls.append(("detail", _workspace))
        return detail

    db = SimpleNamespace(commit=lambda: None)

    async def _commit() -> None:
        calls.append(("commit", workspace_id))

    db.commit = _commit

    monkeypatch.setattr(
        lifecycle_service, ARCHIVE_WITH_DB, _cloud_workspace_user_can_archive_with_db
    )
    monkeypatch.setattr(
        lifecycle_service,
        "restore_cloud_workspace_record",
        _restore_cloud_workspace_record,
    )
    monkeypatch.setattr(
        lifecycle_service,
        "build_workspace_detail_for_request",
        _build_workspace_detail_for_request,
    )

    result = await lifecycle_service.restore_cloud_workspace(db, user_id, workspace_id)

    assert result is detail
    assert calls == [
        ("load_for_lifecycle", workspace_id),
        ("restore", workspace),
        ("detail", workspace),
        ("commit", workspace_id),
    ]


@pytest.mark.asyncio
async def test_purge_cloud_workspace_is_idempotent_when_record_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _get_cloud_workspace_by_id(_db, _workspace_id):
        return None

    async def _unexpected(*_args, **_kwargs):
        raise AssertionError("missing workspace purge must not require lifecycle permission")

    monkeypatch.setattr(
        lifecycle_service,
        "get_cloud_workspace_by_id",
        _get_cloud_workspace_by_id,
    )
    monkeypatch.setattr(
        lifecycle_service,
        ARCHIVE_WITH_DB,
        _unexpected,
    )

    await lifecycle_service.purge_cloud_workspace(SimpleNamespace(), uuid4(), uuid4())


@pytest.mark.asyncio
async def test_purge_cloud_workspace_requires_archived_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace_id = uuid4()
    workspace = SimpleNamespace(
        id=workspace_id,
        owner_scope="personal",
        archived_at=None,
    )

    async def _get_cloud_workspace_by_id(_db, _workspace_id):
        assert _workspace_id == workspace_id
        return workspace

    async def _cloud_workspace_user_can_archive_with_db(_db, _user_id, _workspace_id):
        assert _user_id == user_id
        assert _workspace_id == workspace_id
        return workspace

    async def _unexpected(*_args, **_kwargs):
        raise AssertionError("active workspace purge must stop before destructive work")

    db = SimpleNamespace(commit=_unexpected)
    monkeypatch.setattr(
        lifecycle_service,
        "get_cloud_workspace_by_id",
        _get_cloud_workspace_by_id,
    )
    monkeypatch.setattr(
        lifecycle_service, ARCHIVE_WITH_DB, _cloud_workspace_user_can_archive_with_db
    )
    monkeypatch.setattr(
        lifecycle_service,
        "_revoke_claim_tokens_for_workspace",
        _unexpected,
    )
    monkeypatch.setattr(
        lifecycle_service.command_store,
        "supersede_workspace_commands",
        _unexpected,
    )
    monkeypatch.setattr(
        lifecycle_service,
        "purge_cloud_workspace_record",
        _unexpected,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await lifecycle_service.purge_cloud_workspace(db, user_id, workspace_id)

    assert exc_info.value.code == "workspace_purge_requires_archive"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_destroy_workspace_runtime_skips_shared_profile_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = SimpleNamespace(
        id=uuid4(),
        active_sandbox_id=None,
        status=lifecycle_service.CloudWorkspaceStatus.ready.value,
        status_detail="Ready",
        updated_at=None,
    )
    calls: list[str] = []

    async def _load_cloud_sandbox_by_id(_sandbox_id):
        raise AssertionError("shared profile slot should not be loaded from workspace destroy")

    async def _persist_workspace_destroy_state(_db, _workspace) -> None:
        assert _workspace is workspace
        calls.append("persist")

    monkeypatch.setattr(
        lifecycle_service,
        "load_cloud_sandbox_by_id",
        _load_cloud_sandbox_by_id,
    )
    monkeypatch.setattr(
        lifecycle_service,
        "persist_workspace_destroy_state",
        _persist_workspace_destroy_state,
    )
    _patch_session_factory(monkeypatch)

    await lifecycle_service._destroy_workspace_runtime(workspace)

    assert calls == ["persist"]
    assert workspace.status == lifecycle_service.CloudWorkspaceStatus.archived.value
