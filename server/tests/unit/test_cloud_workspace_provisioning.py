from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest

from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import ResolvedRemoteWorkspace
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import provisioning


def _repo_environment() -> RepoEnvironmentValue:
    now = datetime.now(UTC)
    return RepoEnvironmentValue(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        repo_config_id=UUID("22222222-2222-2222-2222-222222222222"),
        user_id=UUID("33333333-3333-3333-3333-333333333333"),
        git_provider="github",
        git_owner="owner",
        git_repo_name="repo",
        environment_kind="cloud",
        desktop_install_id=None,
        local_path=None,
        default_branch="main",
        setup_script="",
        run_command="",
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_resolve_repo_root_preserves_runtime_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = ResolvedRemoteWorkspace(workspace_id="workspace", repo_root_id="root")
    received: dict[str, object] = {}

    async def _resolve(
        runtime_url: str,
        runtime_token: str,
        *,
        runtime_workdir: str,
    ) -> ResolvedRemoteWorkspace:
        received.update(
            runtime_url=runtime_url,
            runtime_token=runtime_token,
            runtime_workdir=runtime_workdir,
        )
        return expected

    monkeypatch.setattr(provisioning, "resolve_runtime_workspace", _resolve)

    actual = await provisioning.resolve_repo_root("runtime-url", "token", repo_path="/repo")

    assert actual is expected
    assert received == {
        "runtime_url": "runtime-url",
        "runtime_token": "token",
        "runtime_workdir": "/repo",
    }


@pytest.mark.asyncio
async def test_resolve_repo_root_preserves_cloud_error_translation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fail(*_args: object, **_kwargs: object) -> ResolvedRemoteWorkspace:
        raise CloudRuntimeReconnectError("runtime unavailable")

    monkeypatch.setattr(provisioning, "resolve_runtime_workspace", _fail)

    with pytest.raises(CloudApiError) as raised:
        await provisioning.resolve_repo_root("runtime-url", "token", repo_path="/repo")

    assert raised.value.code == "cloud_runtime_repo_root_failed"
    assert raised.value.status_code == 502


@pytest.mark.asyncio
async def test_create_worktree_preserves_target_and_origin_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = ResolvedRemoteWorkspace(workspace_id="workspace", repo_root_id="root")
    received: dict[str, object] = {}

    async def _create(runtime_url: str, runtime_token: str, **kwargs: object) -> object:
        received.update(runtime_url=runtime_url, runtime_token=runtime_token, **kwargs)
        return expected

    monkeypatch.setattr(provisioning, "create_remote_worktree_workspace", _create)

    workspace_id = UUID("12345678-1234-5678-1234-567812345678")
    actual = await provisioning.create_anyharness_worktree(
        "runtime-url",
        "token",
        workspace_id=workspace_id,
        repo_environment=_repo_environment(),
        repo_root_id="root",
        branch_name="feature/test branch",
        base_branch="main",
        setup_script="",
        source="web",
    )

    assert actual is expected
    assert received["target_path"] == (
        "/home/user/workspace/worktrees/owner/repo/feature-test-branch-12345678"
    )
    assert received["new_branch_name"] == "feature/test branch"
    assert received["base_branch"] == "main"
    assert received["setup_script"] is None
    assert received["origin"] == {"kind": "human", "entrypoint": "cloud"}
