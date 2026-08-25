from __future__ import annotations

import inspect
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from proliferate.db.engine import get_async_session
from proliferate.db.store.cloud_workspace_materializations import (
    CloudWorkspaceMaterializationValue,
)
from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.server.api_errors import CloudApiError
from proliferate.server.cloud.workspaces import api
from proliferate.server.cloud.workspaces.materializations import access
from proliferate.server.cloud.workspaces.materializations import service
from proliferate.server.cloud.workspaces.models import (
    CreateMaterializationIntentRequest,
    ReportMaterializationRequest,
)


def _workspace(*, lost: bool = False) -> CloudWorkspaceValue:
    now = datetime.now(UTC)
    return CloudWorkspaceValue(
        id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        workspace_kind="repository_worktree",
        repo_environment_id=uuid.uuid4(),
        display_name="workspace",
        git_branch="feature/access",
        git_base_branch="main",
        anyharness_workspace_id="managed-workspace",
        created_at=now,
        updated_at=now,
        archived_at=None,
        lost_at=now if lost else None,
    )


def _materialization(
    workspace: CloudWorkspaceValue,
    *,
    target_kind: str = "local_desktop",
    desktop_install_id: str | None = "desktop-a",
    unlinked: bool = False,
) -> CloudWorkspaceMaterializationValue:
    now = datetime.now(UTC)
    return CloudWorkspaceMaterializationValue(
        id=uuid.uuid4(),
        cloud_workspace_id=workspace.id,
        target_kind=target_kind,
        cloud_sandbox_id=None,
        desktop_install_id=desktop_install_id,
        anyharness_workspace_id=None,
        worktree_path=None,
        state="pending",
        generation=1,
        expected_head_sha="head",
        observed_head_sha=None,
        observed_branch="feature/access",
        failure_code=None,
        failure_detail=None,
        last_reported_at=None,
        unlinked_at=now if unlinked else None,
        created_at=now,
        updated_at=now,
    )


def _intent(install_id: str = "desktop-a") -> CreateMaterializationIntentRequest:
    return CreateMaterializationIntentRequest(
        targetKind="local_desktop", desktopInstallId=install_id
    )


def _assert_error(
    excinfo: pytest.ExceptionInfo[CloudApiError],
    *,
    code: str,
    message: str,
    status_code: int,
) -> None:
    assert excinfo.value.code == code
    assert excinfo.value.message == message
    assert excinfo.value.status_code == status_code


@pytest.mark.asyncio
async def test_missing_workspace_masks_access_and_stops_later_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    user = SimpleNamespace(id=uuid.uuid4())
    workers = AsyncMock()
    monkeypatch.setattr(
        access.cloud_workspace_store,
        "get_cloud_workspace_for_user",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        access.runtime_workers_store, "get_active_desktop_worker_for_user", workers
    )

    with pytest.raises(CloudApiError) as excinfo:
        await access.create_local_materialization_access(uuid.uuid4(), _intent(), user, db)  # type: ignore[arg-type]

    _assert_error(
        excinfo,
        code="workspace_not_found",
        message="Cloud workspace not found.",
        status_code=404,
    )
    workers.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_access_preserves_failure_order_and_normalizes_install(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    user = SimpleNamespace(id=uuid.uuid4())
    workers = AsyncMock(return_value=object())
    monkeypatch.setattr(
        access.runtime_workers_store, "get_active_desktop_worker_for_user", workers
    )

    lost = _workspace(lost=True)
    monkeypatch.setattr(
        access.cloud_workspace_store,
        "get_cloud_workspace_for_user",
        AsyncMock(return_value=lost),
    )
    with pytest.raises(CloudApiError) as lost_error:
        await access.create_local_materialization_access(lost.id, _intent(""), user, db)  # type: ignore[arg-type]
    _assert_error(
        lost_error,
        code="workspace_lost",
        message=(
            "This workspace was lost with its sandbox. Delete it instead of rematerializing it."
        ),
        status_code=409,
    )
    workers.assert_not_awaited()

    workspace = _workspace()
    monkeypatch.setattr(
        access.cloud_workspace_store,
        "get_cloud_workspace_for_user",
        AsyncMock(return_value=workspace),
    )
    with pytest.raises(CloudApiError) as empty_error:
        await access.create_local_materialization_access(workspace.id, _intent("  "), user, db)  # type: ignore[arg-type]
    _assert_error(
        empty_error,
        code="invalid_desktop_install",
        message="A desktop installation id is required.",
        status_code=400,
    )
    workers.assert_not_awaited()

    workers.return_value = None
    with pytest.raises(CloudApiError) as ownership_error:
        await access.create_local_materialization_access(
            workspace.id, _intent(" desktop-a "), user, db
        )  # type: ignore[arg-type]
    _assert_error(
        ownership_error,
        code="desktop_install_not_owned",
        message="This desktop installation is not registered to your account.",
        status_code=403,
    )
    workers.assert_awaited_once_with(db, owner_user_id=user.id, desktop_install_id="desktop-a")

    workers.reset_mock(return_value=True)
    workers.return_value = object()
    result = await access.create_local_materialization_access(
        workspace.id,
        _intent(" desktop-a "),
        user,
        db,  # type: ignore[arg-type]
    )
    assert result.actor_user_id == user.id
    assert result.workspace is workspace
    assert result.desktop_install_id == "desktop-a"
    workers.assert_awaited_once_with(db, owner_user_id=user.id, desktop_install_id="desktop-a")


@pytest.mark.asyncio
async def test_report_access_locks_and_enforces_relation_target_and_install(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    user = SimpleNamespace(id=uuid.uuid4())
    workspace = _workspace()
    workers = AsyncMock(return_value=object())
    monkeypatch.setattr(
        access.cloud_workspace_store,
        "get_cloud_workspace_for_user",
        AsyncMock(return_value=workspace),
    )
    monkeypatch.setattr(
        access.runtime_workers_store, "get_active_desktop_worker_for_user", workers
    )

    foreign = _materialization(_workspace())
    loader = AsyncMock(return_value=foreign)
    monkeypatch.setattr(access.materialization_store, "load_materialization", loader)
    with pytest.raises(CloudApiError) as mismatch_error:
        await access.report_local_materialization_access(workspace.id, foreign.id, user, db)  # type: ignore[arg-type]
    _assert_error(
        mismatch_error,
        code="materialization_not_found",
        message="Materialization not found.",
        status_code=404,
    )
    loader.assert_awaited_once_with(db, foreign.id, lock_row=True)
    workers.assert_not_awaited()

    managed = _materialization(workspace, target_kind="managed_cloud")
    loader.reset_mock(return_value=True)
    loader.return_value = managed
    with pytest.raises(CloudApiError) as target_error:
        await access.report_local_materialization_access(workspace.id, managed.id, user, db)  # type: ignore[arg-type]
    _assert_error(
        target_error,
        code="materialization_not_reportable",
        message="Only local materializations can be reported.",
        status_code=409,
    )

    row = _materialization(workspace)
    loader.reset_mock(return_value=True)
    loader.return_value = row
    result = await access.report_local_materialization_access(workspace.id, row.id, user, db)  # type: ignore[arg-type]
    assert result.workspace is workspace
    assert result.materialization is row
    workers.assert_awaited_once_with(db, owner_user_id=user.id, desktop_install_id="desktop-a")


@pytest.mark.asyncio
async def test_unlink_access_preserves_relation_target_and_replay_exemptions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    user = SimpleNamespace(id=uuid.uuid4())
    workspace = _workspace()
    workers = AsyncMock(return_value=object())
    monkeypatch.setattr(
        access.cloud_workspace_store,
        "get_cloud_workspace_for_user",
        AsyncMock(return_value=workspace),
    )
    monkeypatch.setattr(
        access.runtime_workers_store, "get_active_desktop_worker_for_user", workers
    )
    loader = AsyncMock()
    monkeypatch.setattr(access.materialization_store, "load_materialization", loader)

    managed = _materialization(workspace, target_kind="managed_cloud")
    loader.return_value = managed
    with pytest.raises(CloudApiError) as target_error:
        await access.unlink_local_materialization_access(workspace.id, managed.id, user, db)  # type: ignore[arg-type]
    _assert_error(
        target_error,
        code="materialization_not_unlinkable",
        message="Only local materializations can be unlinked.",
        status_code=409,
    )

    for row in (
        _materialization(workspace, unlinked=True),
        _materialization(workspace, desktop_install_id=None),
    ):
        loader.reset_mock(return_value=True)
        loader.return_value = row
        workers.reset_mock()
        result = await access.unlink_local_materialization_access(workspace.id, row.id, user, db)  # type: ignore[arg-type]
        assert result.materialization is row
        loader.assert_awaited_once_with(db, row.id, lock_row=True)
        workers.assert_not_awaited()


@pytest.mark.asyncio
async def test_routes_pass_exact_access_snapshots_and_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    workspace = _workspace()
    row = _materialization(workspace)
    create = AsyncMock(return_value=object())
    report = AsyncMock(return_value=object())
    unlink = AsyncMock()
    monkeypatch.setattr(service, "create_local_materialization_intent", create)
    monkeypatch.setattr(service, "report_materialization", report)
    monkeypatch.setattr(service, "unlink_materialization", unlink)
    create_access = access.CreateLocalMaterializationAccess(uuid.uuid4(), workspace, "desktop-a")
    existing_access = access.ExistingLocalMaterializationAccess(
        create_access.actor_user_id, workspace, row
    )
    body = ReportMaterializationRequest(generation=1, state="failed")

    await api.create_workspace_materialization_intent_endpoint(
        workspace.id,
        _intent(),
        create_access,
        db,  # type: ignore[arg-type]
    )
    await api.report_workspace_materialization_endpoint(
        workspace.id,
        row.id,
        body,
        existing_access,
        db,  # type: ignore[arg-type]
    )
    await api.unlink_workspace_materialization_endpoint(
        workspace.id,
        row.id,
        existing_access,
        db,  # type: ignore[arg-type]
    )

    assert create.await_args.args[0] is db
    assert create.await_args.kwargs["workspace"] is workspace
    assert report.await_args.args[0] is db
    assert report.await_args.kwargs["materialization"] is row
    assert unlink.await_args.args[0] is db
    assert unlink.await_args.kwargs["materialization"] is row


@pytest.mark.asyncio
async def test_denied_access_never_invokes_router_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = FastAPI()
    app.include_router(api.router, prefix="/v1/cloud")
    service_call = AsyncMock()

    async def denied_access() -> access.CreateLocalMaterializationAccess:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)

    app.dependency_overrides[access.create_local_materialization_access] = denied_access
    app.dependency_overrides[get_async_session] = lambda: object()
    monkeypatch.setattr(service, "create_local_materialization_intent", service_call)
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/cloud/workspaces/00000000-0000-0000-0000-000000000001/materializations",
            json={"targetKind": "local_desktop", "desktopInstallId": "desktop-a"},
        )

    assert response.status_code == 500
    service_call.assert_not_awaited()


def test_access_module_has_only_the_frozen_read_seams() -> None:
    source = inspect.getsource(access)
    assert source.count("get_cloud_workspace_for_user") == 1
    assert source.count("load_materialization") == 1
    assert source.count("get_active_desktop_worker_for_user") == 1
    for forbidden in (
        "create_local_desktop_intent",
        "refresh_local_desktop_intent",
        "apply_report",
        "unlink_materialization(",
        "commit(",
        "rollback(",
    ):
        assert forbidden not in source
