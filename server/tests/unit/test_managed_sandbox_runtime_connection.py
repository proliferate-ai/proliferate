from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.managed_sandboxes import repo_materialization, service


@pytest.fixture(autouse=True)
def reset_runtime_connection_cache() -> object:
    service._reset_managed_sandbox_repo_runtime_connection_cache_for_tests()
    yield
    service._reset_managed_sandbox_repo_runtime_connection_cache_for_tests()


@pytest.mark.asyncio
async def test_runtime_connection_materializes_repo_without_exposing_runtime_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    repo_config = SimpleNamespace(
        id=uuid4(),
        configured=True,
        git_owner="owner",
        git_repo_name="repo",
        default_branch="main",
        files_version=1,
        env_vars_version=2,
        setup_script_version=3,
    )
    sandbox = SimpleNamespace(runtime_generation=7)
    materialization = SimpleNamespace(
        anyharness_workspace_id="workspace-123",
        anyharness_repo_root_id="repo-root-456",
    )
    calls: dict[str, object] = {}

    async def get_repo_config(*_args: object, **_kwargs: object) -> object:
        calls["repo_lookup"] = _kwargs
        return repo_config

    async def get_github_grant(*_args: object, **_kwargs: object) -> object:
        return SimpleNamespace(access_token="github-token")

    async def ensure_sandbox(*_args: object, **_kwargs: object) -> object:
        calls["sandbox_ready"] = True
        return sandbox

    async def ensure_materialized(*_args: object, **_kwargs: object) -> object:
        calls["materialization"] = _kwargs
        return materialization

    async def attach_workspace_id(*_args: object, **_kwargs: object) -> int:
        calls["workspace_projection_repair"] = _kwargs
        return 1

    monkeypatch.setattr(service, "get_cloud_repo_config", get_repo_config)
    monkeypatch.setattr(service, "read_ready_github_grant_for_user", get_github_grant)
    monkeypatch.setattr(service, "ensure_managed_sandbox_ready", ensure_sandbox)
    monkeypatch.setattr(repo_materialization, "ensure_repo_materialized", ensure_materialized)
    monkeypatch.setattr(
        service,
        "attach_anyharness_workspace_id_to_managed_repo_workspaces",
        attach_workspace_id,
    )

    result = await service.ensure_managed_sandbox_repo_runtime_connection(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
        git_owner="owner",
        git_repo_name="repo",
    )

    assert result.anyharness_workspace_id == "workspace-123"
    assert result.anyharness_repo_root_id == "repo-root-456"
    assert result.runtime_generation == 7
    assert not hasattr(result, "runtime_url")
    assert not hasattr(result, "access_token")
    assert calls["repo_lookup"] == {
        "user_id": user.id,
        "git_owner": "owner",
        "git_repo_name": "repo",
    }
    assert calls["sandbox_ready"] is True
    assert calls["materialization"] == {
        "sandbox": sandbox,
        "repo_config": repo_config,
        "github_token": "github-token",
        "run_setup": False,
    }
    assert calls["workspace_projection_repair"] == {
        "user_id": user.id,
        "git_owner": "owner",
        "git_repo_name": "repo",
        "anyharness_workspace_id": "workspace-123",
        "preferred_branch": "main",
    }


@pytest.mark.asyncio
async def test_runtime_connection_requires_configured_repo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def get_repo_config(*_args: object, **_kwargs: object) -> None:
        return None

    async def ensure_sandbox(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("sandbox should not be ensured before repo authorization")

    monkeypatch.setattr(service, "get_cloud_repo_config", get_repo_config)
    monkeypatch.setattr(service, "ensure_managed_sandbox_ready", ensure_sandbox)

    with pytest.raises(CloudApiError) as error:
        await service.ensure_managed_sandbox_repo_runtime_connection(
            cast(AsyncSession, object()),
            cast(service._UserWithId, user),
            git_owner="owner",
            git_repo_name="repo",
        )

    assert error.value.code == "managed_sandbox_repo_not_configured"
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_workspace_runtime_connection_creates_branch_worktree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace_id = uuid4()
    workspace = SimpleNamespace(
        id=workspace_id,
        owner_scope="personal",
        owner_user_id=user.id,
        sandbox_profile_id=uuid4(),
        target_id=uuid4(),
        git_owner="Owner",
        git_repo_name="Repo",
        git_branch="feature/test",
        git_base_branch="main",
        origin="manual_desktop",
        status="pending",
        anyharness_workspace_id=None,
        worktree_path=None,
    )
    sandbox = SimpleNamespace(runtime_generation=12)
    calls: dict[str, object] = {}

    async def ensure_repo_connection(*_args: object, **_kwargs: object) -> object:
        calls["repo_connection"] = _kwargs
        return service.ManagedSandboxRepoRuntimeConnection(
            anyharness_workspace_id="base-workspace",
            anyharness_repo_root_id="repo-root",
            runtime_generation=12,
        )

    async def ensure_sandbox(*_args: object, **_kwargs: object) -> object:
        calls["sandbox_ready"] = True
        return sandbox

    async def load_runtime_access(_sandbox: object) -> tuple[str, str, str]:
        calls["runtime_access_sandbox"] = _sandbox
        return ("https://runtime.example", "runtime-token", "data-key")

    async def create_worktree(*_args: object, **_kwargs: object) -> object:
        calls["create_worktree"] = _kwargs
        return SimpleNamespace(workspace_id="branch-workspace", repo_root_id="repo-root")

    async def attach_workspace_id(*_args: object, **_kwargs: object) -> object:
        calls["attach"] = _kwargs
        return workspace

    monkeypatch.setattr(
        service,
        "ensure_managed_sandbox_repo_runtime_connection",
        ensure_repo_connection,
    )
    monkeypatch.setattr(service, "ensure_managed_sandbox_ready", ensure_sandbox)
    monkeypatch.setattr(service, "load_managed_sandbox_runtime_access", load_runtime_access)
    monkeypatch.setattr(service, "create_remote_worktree_workspace", create_worktree)
    monkeypatch.setattr(service, "attach_anyharness_workspace_id", attach_workspace_id)

    result = await service.ensure_managed_sandbox_workspace_record_runtime_connection(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
        workspace=workspace,
    )

    assert result.anyharness_workspace_id == "branch-workspace"
    assert result.anyharness_repo_root_id == "repo-root"
    assert result.runtime_generation == 12
    assert calls["repo_connection"] == {
        "git_owner": "Owner",
        "git_repo_name": "Repo",
    }
    assert calls["runtime_access_sandbox"] is sandbox
    assert calls["create_worktree"] == {
        "repo_root_id": "repo-root",
        "target_path": f"/home/user/workspace/worktrees/Owner/Repo/feature-test-{str(workspace_id)[:8]}",
        "new_branch_name": "feature/test",
        "base_branch": "main",
        "origin": {"kind": "human", "entrypoint": "desktop"},
        "creator_context": {"kind": "human", "label": "Cloud workspace"},
    }
    assert calls["attach"] == {
        "workspace_id": workspace_id,
        "anyharness_workspace_id": "branch-workspace",
        "worktree_path": f"/home/user/workspace/worktrees/Owner/Repo/feature-test-{str(workspace_id)[:8]}",
        "runtime_generation": 12,
    }


@pytest.mark.asyncio
async def test_runtime_connection_singleflights_concurrent_repo_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    repo_config = SimpleNamespace(
        id=uuid4(),
        configured=True,
        git_owner="Owner",
        git_repo_name="Repo",
        default_branch="main",
        files_version=1,
        env_vars_version=2,
        setup_script_version=3,
    )
    sandbox = SimpleNamespace(runtime_generation=9)
    materialization = SimpleNamespace(
        anyharness_workspace_id="workspace-789",
        anyharness_repo_root_id="repo-root-789",
    )
    calls = {
        "repo_lookup": 0,
        "github_grant": 0,
        "sandbox_ready": 0,
        "materialization": 0,
        "workspace_projection_repair": 0,
    }

    async def get_repo_config(*_args: object, **_kwargs: object) -> object:
        calls["repo_lookup"] += 1
        return repo_config

    async def get_github_grant(*_args: object, **_kwargs: object) -> object:
        calls["github_grant"] += 1
        return SimpleNamespace(access_token="github-token")

    async def ensure_sandbox(*_args: object, **_kwargs: object) -> object:
        calls["sandbox_ready"] += 1
        await asyncio.sleep(0.01)
        return sandbox

    async def ensure_materialized(*_args: object, **_kwargs: object) -> object:
        calls["materialization"] += 1
        return materialization

    async def attach_workspace_id(*_args: object, **_kwargs: object) -> int:
        calls["workspace_projection_repair"] += 1
        return 1

    monkeypatch.setattr(service, "get_cloud_repo_config", get_repo_config)
    monkeypatch.setattr(service, "read_ready_github_grant_for_user", get_github_grant)
    monkeypatch.setattr(service, "ensure_managed_sandbox_ready", ensure_sandbox)
    monkeypatch.setattr(repo_materialization, "ensure_repo_materialized", ensure_materialized)
    monkeypatch.setattr(
        service,
        "attach_anyharness_workspace_id_to_managed_repo_workspaces",
        attach_workspace_id,
    )

    results = await asyncio.gather(
        *(
            service.ensure_managed_sandbox_repo_runtime_connection(
                cast(AsyncSession, object()),
                cast(service._UserWithId, user),
                git_owner="OWNER",
                git_repo_name="Repo",
            )
            for _ in range(10)
        )
    )

    assert {result.anyharness_workspace_id for result in results} == {"workspace-789"}
    assert {result.anyharness_repo_root_id for result in results} == {"repo-root-789"}
    assert {result.runtime_generation for result in results} == {9}
    assert calls == {
        "repo_lookup": 10,
        "github_grant": 1,
        "sandbox_ready": 1,
        "materialization": 1,
        "workspace_projection_repair": 1,
    }
