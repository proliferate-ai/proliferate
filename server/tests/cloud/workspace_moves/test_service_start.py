"""Unit tests for workspace_move's start flow and destination worktree build.

Pure logic tests with every store/integration call monkeypatched -- no
Postgres/Redis/AnyHarness involved. Store-level behavior (idempotency,
legal-transition table, atomic cutover flip) is covered separately by
``tests/integration/test_workspace_moves_store.py`` against real Postgres.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import ResolvedRemoteWorkspace
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspace_moves import service
from tests.cloud.workspace_moves import builders as b

# --- direction validation ----------------------------------------------------


@pytest.mark.asyncio
async def test_start_workspace_move_rejects_unsupported_direction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    repo_config = b.repo_config(repo_config_id=uuid4(), user_id=user.id)
    monkeypatch.setattr(
        service.repositories_store, "get_repo_config_by_id", b.async_return(repo_config)
    )

    body = b.start_body(
        repo_config_id=repo_config.id, source_kind="local", destination_kind="local"
    )

    with pytest.raises(CloudApiError) as exc_info:
        await service.start_workspace_move(b.db(), user, body)
    assert exc_info.value.code == "unsupported_move_direction"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_start_workspace_move_repo_config_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service.repositories_store, "get_repo_config_by_id", b.async_return(None))

    with pytest.raises(CloudApiError) as exc_info:
        await service.start_workspace_move(b.db(), b.user(), b.start_body(repo_config_id=uuid4()))
    assert exc_info.value.code == "repo_config_not_found"
    assert exc_info.value.status_code == 404


# --- local->cloud collision ---------------------------------------------------


@pytest.mark.asyncio
async def test_start_workspace_move_blocks_on_independent_collision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    repo_config = b.repo_config(repo_config_id=uuid4(), user_id=user.id)
    environment = b.repo_environment(repo_config_id=repo_config.id, user_id=user.id)
    active = b.cloud_workspace(owner_user_id=user.id, repo_environment_id=environment.id)

    monkeypatch.setattr(
        service.repositories_store, "get_repo_config_by_id", b.async_return(repo_config)
    )
    monkeypatch.setattr(
        service.workspace_move_store, "get_move_by_idempotency_key", b.async_return(None)
    )
    monkeypatch.setattr(
        service.repositories_store, "get_cloud_repo_environment", b.async_return(environment)
    )
    monkeypatch.setattr(
        service.cloud_workspace_store,
        "get_active_cloud_workspace_for_branch",
        b.async_return(active),
    )
    monkeypatch.setattr(
        service.workspace_move_store, "is_own_prior_cloud_destination", b.async_return(False)
    )

    with pytest.raises(CloudApiError) as exc_info:
        await service.start_workspace_move(
            b.db(), user, b.start_body(repo_config_id=repo_config.id)
        )
    assert exc_info.value.code == "cloud_workspace_exists"
    assert exc_info.value.status_code == 409
    assert exc_info.value.extra_detail == {"cloudWorkspaceId": str(active.id)}


@pytest.mark.asyncio
async def test_start_workspace_move_reuses_own_prior_destination(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = b.user()
    repo_config = b.repo_config(repo_config_id=uuid4(), user_id=user.id)
    environment = b.repo_environment(repo_config_id=repo_config.id, user_id=user.id)
    active = b.cloud_workspace(
        owner_user_id=user.id, repo_environment_id=environment.id, anyharness_workspace_id="ah-1"
    )
    reserved = b.move(user_id=user.id, repo_config_id=repo_config.id, phase="started")

    monkeypatch.setattr(
        service.repositories_store, "get_repo_config_by_id", b.async_return(repo_config)
    )
    monkeypatch.setattr(
        service.workspace_move_store, "get_move_by_idempotency_key", b.async_return(None)
    )
    monkeypatch.setattr(
        service.repositories_store, "get_cloud_repo_environment", b.async_return(environment)
    )
    monkeypatch.setattr(
        service.cloud_workspace_store,
        "get_active_cloud_workspace_for_branch",
        b.async_return(active),
    )
    monkeypatch.setattr(
        service.workspace_move_store, "is_own_prior_cloud_destination", b.async_return(True)
    )
    monkeypatch.setattr(service.workspace_move_store, "create_move", b.async_return(reserved))
    b.noop_commit(monkeypatch)

    create_calls = 0

    async def _fail_create_cloud_workspace(
        *_args: object, **_kwargs: object
    ) -> CloudWorkspaceValue:
        nonlocal create_calls
        create_calls += 1
        raise AssertionError(
            "must not create a new cloud_workspace row when reusing own prior home"
        )

    monkeypatch.setattr(
        service.cloud_workspace_store, "create_cloud_workspace", _fail_create_cloud_workspace
    )
    monkeypatch.setattr(
        service.materialization_service, "materialize_repo_environment", b.async_return(None)
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
        service,
        "resolve_runtime_workspace",
        b.async_return(ResolvedRemoteWorkspace(workspace_id="ah-1", repo_root_id="root-1")),
    )
    monkeypatch.setattr(
        service,
        "create_remote_worktree_workspace",
        b.async_return(ResolvedRemoteWorkspace(workspace_id="ah-1", repo_root_id="root-1")),
    )
    ready = b.move(
        user_id=user.id,
        repo_config_id=repo_config.id,
        phase="destination_ready",
        destination_ref={"cloudWorkspaceId": str(active.id)},
    )
    monkeypatch.setattr(service.workspace_move_store, "advance_phase", b.async_return(ready))

    response = await service.start_workspace_move(
        b.db(), user, b.start_body(repo_config_id=repo_config.id)
    )

    assert create_calls == 0
    assert response.phase == "destination_ready"


# --- destination worktree build retry ----------------------------------------


@pytest.mark.asyncio
async def test_build_destination_worktree_refetches_once_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = b.repo_environment(repo_config_id=uuid4(), user_id=uuid4())
    monkeypatch.setattr(
        service,
        "resolve_runtime_workspace",
        b.async_return(ResolvedRemoteWorkspace(workspace_id="ah-1", repo_root_id="root-1")),
    )

    attempts = 0

    async def _create(*_args: object, **_kwargs: object) -> ResolvedRemoteWorkspace:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise CloudRuntimeReconnectError("sha not reachable yet")
        return ResolvedRemoteWorkspace(workspace_id="ah-1", repo_root_id="root-1")

    monkeypatch.setattr(service, "create_remote_worktree_workspace", _create)

    refetches = 0

    async def _materialize(*_args: object, **_kwargs: object) -> None:
        nonlocal refetches
        refetches += 1

    monkeypatch.setattr(
        service.materialization_service, "materialize_repo_environment", _materialize
    )

    result = await service._build_destination_worktree(
        b.db(),
        "https://runtime.invalid",
        "token",
        cloud_repo_environment=environment,
        branch="feature/move",
        base_commit_sha="a" * 40,
        workspace_id=uuid4(),
        setup_script="",
    )

    assert result.workspace_id == "ah-1"
    assert attempts == 2
    assert refetches == 1


@pytest.mark.asyncio
async def test_build_destination_worktree_raises_after_exhausting_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = b.repo_environment(repo_config_id=uuid4(), user_id=uuid4())
    monkeypatch.setattr(
        service,
        "resolve_runtime_workspace",
        b.async_return(ResolvedRemoteWorkspace(workspace_id="ah-1", repo_root_id="root-1")),
    )

    async def _always_fails(*_args: object, **_kwargs: object) -> ResolvedRemoteWorkspace:
        raise CloudRuntimeReconnectError("sha not reachable")

    monkeypatch.setattr(service, "create_remote_worktree_workspace", _always_fails)
    monkeypatch.setattr(
        service.materialization_service, "materialize_repo_environment", b.async_return(None)
    )

    with pytest.raises(CloudApiError) as exc_info:
        await service._build_destination_worktree(
            b.db(),
            "https://runtime.invalid",
            "token",
            cloud_repo_environment=environment,
            branch="feature/move",
            base_commit_sha="a" * 40,
            workspace_id=uuid4(),
            setup_script="",
        )
    assert exc_info.value.code == "workspace_move_destination_unreachable"
    assert exc_info.value.status_code == 502


# --- small pure helpers ---------------------------------------------------------


def test_ref_to_dict_only_includes_populated_fields() -> None:
    from proliferate.server.cloud.workspace_moves.models import WorkspaceMoveEndpointRef

    ref = WorkspaceMoveEndpointRef(kind="local", desktopInstallId="desktop-1")
    assert service._ref_to_dict(ref) == {"desktopInstallId": "desktop-1"}


def test_worktree_path_sanitizes_branch_segment() -> None:
    environment = b.repo_environment(repo_config_id=uuid4(), user_id=uuid4())
    workspace_id = uuid4()
    path = service._worktree_path(environment, "feature/odd name!!", workspace_id=workspace_id)
    assert path.startswith("/home/user/workspace/worktrees/proliferate-ai/proliferate/")
    assert "feature-odd-name" in path
    assert path.endswith(str(workspace_id)[:8])
