"""Serialization proof for placement-neutral cloud workspace identity (5a).

Pins the repository payload byte-stable (only additive ``workspaceKind``) and
proves scratch rows serialize ``repo``/``repoEnvironmentId``/``runtime`` without
fabricated repository data.
"""

from __future__ import annotations

import uuid
from datetime import datetime, UTC
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.server.cloud.workspaces import service as workspaces_service
from proliferate.server.cloud.workspaces.domain.naming import scratch_workspace_display_name

_CREATED = datetime(2026, 7, 15, 12, 0, 0, tzinfo=UTC)


def _repository_value(repo_environment_id: uuid.UUID) -> CloudWorkspaceValue:
    return CloudWorkspaceValue(
        id=uuid.UUID("50000000-0000-4000-8000-000000000001"),
        owner_user_id=uuid.uuid4(),
        workspace_kind="repository_worktree",
        repo_environment_id=repo_environment_id,
        display_name="feature-x",
        git_branch="feature-x",
        git_base_branch="main",
        anyharness_workspace_id="workspace-123",
        created_at=_CREATED,
        updated_at=_CREATED,
        archived_at=None,
    )


def _scratch_value(invocation_id: uuid.UUID) -> CloudWorkspaceValue:
    return CloudWorkspaceValue(
        id=invocation_id,
        owner_user_id=uuid.uuid4(),
        workspace_kind="scratch",
        repo_environment_id=None,
        display_name=scratch_workspace_display_name(invocation_id),
        git_branch="main",
        git_base_branch=None,
        anyharness_workspace_id="workspace-scratch-1",
        created_at=_CREATED,
        updated_at=_CREATED,
        archived_at=None,
    )


def _patch_loaders(
    monkeypatch: pytest.MonkeyPatch,
    *,
    repo_environment_id: uuid.UUID,
) -> None:
    repo_environment = SimpleNamespace(
        id=repo_environment_id,
        environment_kind="cloud",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        default_branch="main",
    )

    async def _get_repo_environment(*_a: Any, **_k: Any) -> Any:
        return repo_environment

    async def _load_sandbox(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(status="ready", runtime_generation=3)

    monkeypatch.setattr(
        workspaces_service.repositories_store,
        "get_repo_environment_by_id",
        _get_repo_environment,
    )
    monkeypatch.setattr(
        workspaces_service.cloud_sandbox_store,
        "load_personal_cloud_sandbox",
        _load_sandbox,
    )


@pytest.mark.asyncio
async def test_repository_payload_is_byte_stable_plus_workspace_kind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_environment_id = uuid.uuid4()
    _patch_loaders(monkeypatch, repo_environment_id=repo_environment_id)

    payload = await workspaces_service._workspace_payload(
        db=SimpleNamespace(),  # type: ignore[arg-type]
        workspace=_repository_value(repo_environment_id),
        detail=True,
    )
    dumped = payload.model_dump(by_alias=True)

    # New additive field.
    assert dumped["workspaceKind"] == "repositoryWorktree"
    # Pre-existing repository fields are unchanged (populated, never nulled).
    assert dumped["repoEnvironmentId"] == str(repo_environment_id)
    assert dumped["repo"] == {
        "provider": "github",
        "owner": "proliferate-ai",
        "name": "proliferate",
        "branch": "feature-x",
        "baseBranch": "main",
    }
    assert dumped["runtime"]["environmentId"] == str(repo_environment_id)
    assert dumped["status"] == "ready"
    assert dumped["displayName"] == "feature-x"
    assert dumped["anyharnessWorkspaceId"] == "workspace-123"


@pytest.mark.asyncio
async def test_scratch_payload_has_no_fabricated_repo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation_id = uuid.UUID("60000000-0000-4000-8000-000000000009")

    # Loaders present but must NOT be consulted for scratch — patch to explode.
    async def _explode(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("scratch payload must not load a repo environment")

    async def _load_sandbox(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(status="ready", runtime_generation=3)

    monkeypatch.setattr(
        workspaces_service.repositories_store,
        "get_repo_environment_by_id",
        _explode,
    )
    monkeypatch.setattr(
        workspaces_service.cloud_sandbox_store,
        "load_personal_cloud_sandbox",
        _load_sandbox,
    )

    payload = await workspaces_service._workspace_payload(
        db=SimpleNamespace(),  # type: ignore[arg-type]
        workspace=_scratch_value(invocation_id),
        detail=True,
    )
    dumped = payload.model_dump(by_alias=True)

    assert dumped["workspaceKind"] == "scratch"
    assert dumped["repo"] is None
    assert dumped["repoEnvironmentId"] is None
    assert dumped["runtime"]["environmentId"] is None
    assert dumped["displayName"] == f"Workflow run {invocation_id}"
    assert dumped["anyharnessWorkspaceId"] == "workspace-scratch-1"
