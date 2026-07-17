"""Fail-closed source-association tests for exact-ref Cloud creation."""

from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import service as workspaces_service
from proliferate.server.cloud.workspaces.models import (
    CreateCloudWorkspaceRequest,
    CreateCloudWorkspaceSourceMaterialization,
)
from tests.integration.test_cloud_workspace_materialization_service import (
    _BRANCH,
    _HEAD,
    _INSTALL,
    _patch_exact_ref_create,
    _seed,
)


def _request(observed_head: str = _HEAD) -> CreateCloudWorkspaceRequest:
    return CreateCloudWorkspaceRequest(
        gitOwner="acme",
        gitRepoName="widgets",
        branchName=_BRANCH,
        baseBranch="main",
        expectedHeadSha=_HEAD,
        sourceMaterialization=CreateCloudWorkspaceSourceMaterialization(
            targetKind="local_desktop",
            desktopInstallId=_INSTALL,
            anyharnessWorkspaceId="ws-local",
            worktreePath="/local/wt",
            observedHeadSha=observed_head,
        ),
    )


async def _prepare(
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    with_worker: bool = True,
    calls: dict[str, Any] | None = None,
):
    seed = await _seed(db, with_worker=with_worker)
    await db.delete(seed.workspace)
    await db.flush()
    _patch_exact_ref_create(
        monkeypatch,
        seed,
        branch_heads={_BRANCH: _HEAD},
        materialized_head=_HEAD,
        calls=calls,
    )
    return seed


@pytest.mark.asyncio
async def test_mismatched_local_descriptor_fails_before_effects(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _prepare(db_session, monkeypatch)
    effects = {"repo": 0, "runtime": 0}

    async def _repo_effect(*_a: Any, **_k: Any) -> None:
        effects["repo"] += 1

    async def _runtime_effect(*_a: Any, **_k: Any) -> Any:
        effects["runtime"] += 1
        raise AssertionError("runtime materialization must not run")

    monkeypatch.setattr(
        workspaces_service.materialization_service,
        "materialize_repo_environment",
        _repo_effect,
    )
    monkeypatch.setattr(workspaces_service, "materialize_workspace_at_ref", _runtime_effect)
    with pytest.raises(CloudApiError) as excinfo:
        await workspaces_service.create_cloud_workspace_for_user(
            db_session, SimpleNamespace(id=seed.user.id), _request("different-head")
        )
    assert excinfo.value.code == "materialization_source_blocked"
    assert effects == {"repo": 0, "runtime": 0}


@pytest.mark.asyncio
async def test_source_requires_owned_active_desktop_install(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _prepare(db_session, monkeypatch, with_worker=False)
    with pytest.raises(CloudApiError) as excinfo:
        await workspaces_service.create_cloud_workspace_for_user(
            db_session, SimpleNamespace(id=seed.user.id), _request()
        )
    assert excinfo.value.code == "desktop_install_not_owned"


@pytest.mark.asyncio
async def test_association_conflict_fails_before_runtime_materialization(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: dict[str, Any] = {}
    seed = await _prepare(db_session, monkeypatch, calls=calls)

    async def _conflict(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(
        workspaces_service.materialization_store,
        "insert_hydrated_local_desktop_materialization",
        _conflict,
    )
    with pytest.raises(CloudApiError) as excinfo:
        await workspaces_service.create_cloud_workspace_for_user(
            db_session, SimpleNamespace(id=seed.user.id), _request()
        )
    assert excinfo.value.code == "local_materialization_already_linked"
    assert calls == {}
