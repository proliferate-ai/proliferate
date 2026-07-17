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

    sandbox = SimpleNamespace(id=uuid.uuid4(), status="ready", runtime_generation=3)

    async def _load_sandbox(*_a: Any, **_k: Any) -> Any:
        return sandbox

    async def _load_sandbox_by_id(*_a: Any, **_k: Any) -> Any:
        return sandbox

    async def _list_materializations(*_a: Any, **_k: Any) -> list[Any]:
        return []

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
    monkeypatch.setattr(
        workspaces_service.cloud_sandbox_store,
        "load_cloud_sandbox_by_id",
        _load_sandbox_by_id,
    )
    monkeypatch.setattr(
        workspaces_service.materialization_store,
        "list_active_materializations_for_workspace",
        _list_materializations,
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
        return SimpleNamespace(id=uuid.uuid4(), status="ready", runtime_generation=3)

    async def _list_materializations(*_a: Any, **_k: Any) -> list[Any]:
        return []

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
    monkeypatch.setattr(
        workspaces_service.materialization_store,
        "list_active_materializations_for_workspace",
        _list_materializations,
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
    assert dumped["materializations"] == []
    assert dumped["primaryMaterialization"] is None


def _permits_null(prop_schema: dict[str, Any]) -> bool:
    """True when the OpenAPI property schema allows an explicit ``null``.

    Pydantic emits ``str | None`` and ``RepoRef | None`` as an ``anyOf`` that
    includes a ``{"type": "null"}`` branch. A non-null default (the regression)
    would collapse this to a single-type schema with no null branch.
    """
    return any(branch.get("type") == "null" for branch in prop_schema.get("anyOf", []))


@pytest.mark.parametrize("schema_name", ["WorkspaceSummary", "WorkspaceDetail"])
def test_identity_fields_are_required_in_openapi_contract(schema_name: str) -> None:
    """Regression pin for the Pydantic-default identity regression (MC5A-SDK-01).

    The frozen response requires current servers to ALWAYS emit ``workspaceKind``
    (non-null enum) and ``repo``/``repoEnvironmentId`` (required but nullable).
    Reintroducing a Pydantic default on any of these would silently drop it from
    the OpenAPI ``required`` set (and, for the nullable fields, drop the null
    branch), which is exactly what this contract asserts against.
    """
    # Import locally so the module-level serialization proofs above do not depend
    # on constructing the whole app.
    from proliferate.main import create_app

    schemas = create_app().openapi()["components"]["schemas"]
    schema = schemas[schema_name]
    required = schema.get("required", [])
    props = schema["properties"]

    # All three identity fields are in the required set (never omittable).
    assert "workspaceKind" in required
    assert "repoEnvironmentId" in required
    assert "repo" in required

    # ``workspaceKind`` is a non-null enum with exactly the two allowed values.
    workspace_kind = props["workspaceKind"]
    assert workspace_kind.get("type") == "string"
    assert not _permits_null(workspace_kind)
    assert set(workspace_kind["enum"]) == {"repositoryWorktree", "scratch"}

    # ``repoEnvironmentId`` and ``repo`` are required but permit an explicit null
    # (scratch serializes null; repository worktrees populate them).
    assert _permits_null(props["repoEnvironmentId"])
    assert _permits_null(props["repo"])
