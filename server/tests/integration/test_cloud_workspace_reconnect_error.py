"""create_cloud_workspace maps runtime reconnect failures to a structured 502.

Real prod incident (2026-07-09): a CloudRuntimeReconnectError raised while
waking the cloud sandbox during ``materialize_repo_environment`` escaped
``create_cloud_workspace_for_user`` as an unhandled ASGI 500 ("Load failed" on
desktop). The create/API boundary now converts it into a
``cloud_sandbox_reconnect_failed`` CloudApiError (502) so the client can retry,
matching how the sibling runtime calls (_resolve_repo_root /
_create_anyharness_worktree) already convert.

Background materialization callers still see the raw CloudRuntimeReconnectError
— only the synchronous create path is wrapped.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import service as workspaces_service
from proliferate.server.cloud.workspaces.models import CreateCloudWorkspaceRequest


@pytest.mark.asyncio
async def test_create_workspace_reconnect_failure_maps_to_502(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    repo_environment = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=user_id,
        git_owner="acme",
        git_repo_name="widgets",
        default_branch="main",
        setup_script="",
    )

    async def _get_repo_environment(*_a: Any, **_k: Any) -> Any:
        return repo_environment

    async def _authority(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(access_token="gho_test")

    async def _branches(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(branches=["main"], default_branch="main")

    async def _active_branches(*_a: Any, **_k: Any) -> list[str]:
        return []

    async def _materialize_raises(*_a: Any, **_k: Any) -> None:
        raise CloudRuntimeReconnectError(
            "Runtime rejected the stored bearer token during auth verification."
        )

    monkeypatch.setattr(
        workspaces_service.repositories_store,
        "get_cloud_repo_environment",
        _get_repo_environment,
    )
    monkeypatch.setattr(
        workspaces_service, "require_github_cloud_repo_authority", _authority
    )
    monkeypatch.setattr(
        workspaces_service, "get_repo_branches_for_credentials", _branches
    )
    monkeypatch.setattr(
        workspaces_service.cloud_workspace_store,
        "list_active_workspace_branches_for_repo_environment",
        _active_branches,
    )
    monkeypatch.setattr(
        workspaces_service.materialization_service,
        "materialize_repo_environment",
        _materialize_raises,
    )

    body = CreateCloudWorkspaceRequest(
        gitOwner="acme",
        gitRepoName="widgets",
        branchName="feature-x",
        baseBranch="main",
    )

    with pytest.raises(CloudApiError) as excinfo:
        await workspaces_service.create_cloud_workspace_for_user(
            db_session,
            SimpleNamespace(id=user_id),
            body,
        )

    assert excinfo.value.status_code == 502
    assert excinfo.value.code == "cloud_sandbox_reconnect_failed"
