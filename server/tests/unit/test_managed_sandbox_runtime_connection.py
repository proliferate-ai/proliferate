from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.managed_sandboxes import repo_materialization, service


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

    monkeypatch.setattr(service, "get_cloud_repo_config", get_repo_config)
    monkeypatch.setattr(service, "get_ready_github_grant_for_user", get_github_grant)
    monkeypatch.setattr(service, "ensure_managed_sandbox_ready", ensure_sandbox)
    monkeypatch.setattr(repo_materialization, "ensure_repo_materialized", ensure_materialized)

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
