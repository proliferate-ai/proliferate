"""Unit tests for workspace_move's install/cutover/complete/fail/export legs.

See ``test_service_start.py`` for the start flow and destination-build tests;
this file covers the rest of the phase machine.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.db.store.workspace_moves import IllegalPhaseTransition
from proliferate.integrations.anyharness.models import RuntimeMobilityInstallResult
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspace_moves import service
from proliferate.server.cloud.workspace_moves.models import (
    FailWorkspaceMoveRequest,
    InstallWorkspaceMoveRequest,
)
from tests.cloud.workspace_moves import builders as b

# --- install -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_install_local_to_cloud_requires_archive(monkeypatch: pytest.MonkeyPatch) -> None:
    user = b.user()
    move = b.move(
        user_id=user.id,
        phase="destination_ready",
        destination_kind="cloud",
        destination_ref={"anyharnessWorkspaceId": "ah-1"},
    )
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    with pytest.raises(CloudApiError) as exc_info:
        await service.install_workspace_move_archive(
            b.db(), user, move.id, InstallWorkspaceMoveRequest(archive=None)
        )
    assert exc_info.value.code == "workspace_move_archive_required"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_install_local_to_cloud_rejects_base_commit_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    move = b.move(
        user_id=user.id,
        phase="destination_ready",
        destination_kind="cloud",
        destination_ref={"anyharnessWorkspaceId": "ah-1"},
        base_commit_sha="a" * 40,
    )
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))
    monkeypatch.setattr(
        service.cloud_sandbox_store,
        "load_personal_cloud_sandbox",
        b.async_return(SimpleNamespace(id=uuid4())),
    )
    monkeypatch.setattr(
        service.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        b.async_return(("https://runtime.invalid", "token", "key")),
    )
    mismatched = RuntimeMobilityInstallResult(
        workspace_id="ah-1",
        source_workspace_path="/workspace",
        base_commit_sha="b" * 40,
        imported_session_ids=(),
        applied_file_count=0,
        deleted_file_count=0,
        imported_agent_artifact_count=0,
    )
    monkeypatch.setattr(service, "install_runtime_mobility_archive", b.async_return(mismatched))
    b.noop_commit(monkeypatch)

    with pytest.raises(CloudApiError) as exc_info:
        await service.install_workspace_move_archive(
            b.db(), user, move.id, InstallWorkspaceMoveRequest(archive={"sessions": []})
        )
    assert exc_info.value.code == "workspace_move_base_commit_mismatch"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_install_cloud_to_local_is_a_pure_acknowledgement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    move = b.move(
        user_id=user.id, phase="destination_ready", source_kind="cloud", destination_kind="local"
    )
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))
    installed = b.move(
        user_id=user.id, phase="installed", source_kind="cloud", destination_kind="local"
    )
    monkeypatch.setattr(service.workspace_move_store, "advance_phase", b.async_return(installed))
    b.noop_commit(monkeypatch)

    async def _must_not_call(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("cloud->local install must not call the runtime install endpoint")

    monkeypatch.setattr(service, "install_runtime_mobility_archive", _must_not_call)

    response = await service.install_workspace_move_archive(
        b.db(), user, move.id, InstallWorkspaceMoveRequest(archive=None)
    )
    assert response.phase == "installed"


@pytest.mark.asyncio
async def test_install_is_idempotent_when_already_installed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    move = b.move(user_id=user.id, phase="installed")
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    response = await service.install_workspace_move_archive(
        b.db(), user, move.id, InstallWorkspaceMoveRequest(archive=None)
    )
    assert response.phase == "installed"


# --- cutover / complete / fail: idempotency + illegal-transition translation --


@pytest.mark.asyncio
async def test_cutover_translates_illegal_phase_transition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    move = b.move(user_id=user.id, phase="started")
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    async def _raise(*_args: object, **_kwargs: object) -> None:
        raise IllegalPhaseTransition(from_phase="started", to_phase="cutover")

    monkeypatch.setattr(service.workspace_move_store, "commit_cutover", _raise)

    with pytest.raises(CloudApiError) as exc_info:
        await service.cutover_workspace_move(b.db(), user, move.id)
    assert exc_info.value.code == "workspace_move_invalid_phase"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_cutover_is_idempotent_when_already_cut_over(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    move = b.move(user_id=user.id, phase="cutover", canonical_side="destination")
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    async def _must_not_call(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("must not re-run commit_cutover on replay")

    monkeypatch.setattr(service.workspace_move_store, "commit_cutover", _must_not_call)

    response = await service.cutover_workspace_move(b.db(), user, move.id)
    assert response.phase == "cutover"


@pytest.mark.asyncio
async def test_complete_cleans_up_cloud_source_before_advancing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    workspace_id = uuid4()
    move = b.move(
        user_id=user.id,
        phase="cutover",
        canonical_side="destination",
        source_kind="cloud",
        destination_kind="local",
        source_ref={"cloudWorkspaceId": str(workspace_id)},
    )
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    workspace = b.cloud_workspace(
        workspace_id=workspace_id,
        owner_user_id=user.id,
        repo_environment_id=uuid4(),
        anyharness_workspace_id="ah-1",
    )
    monkeypatch.setattr(
        service.cloud_workspace_store, "get_cloud_workspace_for_user", b.async_return(workspace)
    )
    monkeypatch.setattr(
        service.cloud_sandbox_store,
        "load_personal_cloud_sandbox",
        b.async_return(SimpleNamespace(id=uuid4())),
    )
    monkeypatch.setattr(
        service.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        b.async_return(("https://runtime.invalid", "token", "key")),
    )

    calls: list[str] = []

    async def _set_state(*_args: object, mode: str, **_kwargs: object) -> None:
        calls.append(f"set_state:{mode}")

    async def _destroy(*_args: object, **_kwargs: object) -> None:
        calls.append("destroy")

    monkeypatch.setattr(service, "set_runtime_mobility_state", _set_state)
    monkeypatch.setattr(service, "destroy_runtime_mobility_source", _destroy)

    async def _archive(_db: object, _workspace: object) -> CloudWorkspaceValue:
        calls.append("archive")
        return workspace

    monkeypatch.setattr(service.cloud_workspace_store, "archive_cloud_workspace", _archive)

    completed = b.move(
        user_id=user.id, phase="completed", source_kind="cloud", destination_kind="local"
    )
    monkeypatch.setattr(service.workspace_move_store, "advance_phase", b.async_return(completed))
    b.noop_commit(monkeypatch)

    response = await service.complete_workspace_move(b.db(), user, move.id)

    assert response.phase == "completed"
    assert calls == ["set_state:remote_owned", "destroy", "archive"]


@pytest.mark.asyncio
async def test_complete_requires_cutover_phase(monkeypatch: pytest.MonkeyPatch) -> None:
    user = b.user()
    move = b.move(user_id=user.id, phase="installed")
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    with pytest.raises(CloudApiError) as exc_info:
        await service.complete_workspace_move(b.db(), user, move.id)
    assert exc_info.value.code == "workspace_move_invalid_phase"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_fail_is_idempotent_when_already_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    user = b.user()
    move = b.move(user_id=user.id, phase="failed")
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    async def _must_not_call(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("must not re-run fail_move on replay")

    monkeypatch.setattr(service.workspace_move_store, "fail_move", _must_not_call)

    response = await service.fail_workspace_move(
        b.db(), user, move.id, FailWorkspaceMoveRequest(failureCode="anything")
    )
    assert response.phase == "failed"


# --- export --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_requires_cloud_source(monkeypatch: pytest.MonkeyPatch) -> None:
    user = b.user()
    move = b.move(
        user_id=user.id, phase="destination_ready", source_kind="local", destination_kind="cloud"
    )
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    with pytest.raises(CloudApiError) as exc_info:
        await service.export_workspace_move_archive(b.db(), user, move.id)
    assert exc_info.value.code == "workspace_move_export_unsupported"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_export_guards_archive_size(monkeypatch: pytest.MonkeyPatch) -> None:
    user = b.user()
    workspace_id = uuid4()
    move = b.move(
        user_id=user.id,
        phase="destination_ready",
        source_kind="cloud",
        destination_kind="local",
        source_ref={"cloudWorkspaceId": str(workspace_id)},
    )
    monkeypatch.setattr(service.workspace_move_store, "get_move", b.async_return(move))

    workspace = b.cloud_workspace(
        workspace_id=workspace_id,
        owner_user_id=user.id,
        repo_environment_id=uuid4(),
        anyharness_workspace_id="ah-1",
    )
    monkeypatch.setattr(
        service.cloud_workspace_store, "get_cloud_workspace_for_user", b.async_return(workspace)
    )
    monkeypatch.setattr(
        service.cloud_sandbox_store,
        "load_personal_cloud_sandbox",
        b.async_return(SimpleNamespace(id=uuid4())),
    )
    monkeypatch.setattr(
        service.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        b.async_return(("https://runtime.invalid", "token", "key")),
    )
    monkeypatch.setattr(
        service, "export_runtime_mobility_archive", b.async_return({"sessions": ["x" * 100]})
    )
    monkeypatch.setattr(service.settings, "workspace_move_max_archive_bytes", 10)

    with pytest.raises(CloudApiError) as exc_info:
        await service.export_workspace_move_archive(b.db(), user, move.id)
    assert exc_info.value.code == "workspace_move_archive_too_large"
    assert exc_info.value.status_code == 413
