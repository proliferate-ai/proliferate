from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import service


@pytest.mark.asyncio
async def test_branch_sync_returns_canonical_managed_projection_on_duplicate_branch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    sandbox_profile_id = uuid4()
    target_id = uuid4()
    stale = SimpleNamespace(
        id=uuid4(),
        git_branch="feature/stale",
        archived_at=None,
        runtime_environment_id=None,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        git_provider="github",
        git_owner="owner",
        git_repo_name="repo",
    )
    canonical = SimpleNamespace(
        id=uuid4(),
        git_branch="main",
        runtime_environment_id=None,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        git_provider="github",
        git_owner="owner",
        git_repo_name="repo",
    )
    archived: list[object] = []

    async def can_interact(*_args: object, **_kwargs: object) -> object:
        return stale

    async def get_conflict(*_args: object, **_kwargs: object) -> object:
        return canonical

    async def archive(_db: object, *, workspace: object) -> object:
        archived.append(workspace)
        return workspace

    async def build_detail(_db: object, workspace: object) -> object:
        return workspace

    async def update_branch(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("managed duplicate branch sync should not update the stale row")

    monkeypatch.setattr(service, "cloud_workspace_user_can_interact_with_db", can_interact)
    monkeypatch.setattr(
        service,
        "get_active_cloud_workspace_for_managed_profile_branch",
        get_conflict,
    )
    monkeypatch.setattr(service, "archive_cloud_workspace_record", archive)
    monkeypatch.setattr(service, "_build_workspace_detail_for_request", build_detail)
    monkeypatch.setattr(service, "update_workspace_branch", update_branch)

    result = await service.sync_cloud_workspace_branch(
        cast(AsyncSession, object()),
        user_id,
        stale.id,
        branch_name="main",
    )

    assert result is canonical
    assert archived == [stale]


@pytest.mark.asyncio
async def test_branch_sync_rejects_unrelated_duplicate_branch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    stale = SimpleNamespace(
        id=uuid4(),
        git_branch="feature/stale",
        runtime_environment_id=None,
        sandbox_profile_id=uuid4(),
        target_id=uuid4(),
        git_provider="github",
        git_owner="owner",
        git_repo_name="repo",
    )
    conflict = SimpleNamespace(
        id=uuid4(),
        git_branch="main",
        runtime_environment_id=None,
        sandbox_profile_id=uuid4(),
        target_id=uuid4(),
        git_provider="github",
        git_owner="owner",
        git_repo_name="repo",
    )

    async def can_interact(*_args: object, **_kwargs: object) -> object:
        return stale

    async def get_conflict(*_args: object, **_kwargs: object) -> object:
        return conflict

    async def archive(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("unrelated conflicts must not archive")

    monkeypatch.setattr(service, "cloud_workspace_user_can_interact_with_db", can_interact)
    monkeypatch.setattr(
        service,
        "get_active_cloud_workspace_for_managed_profile_branch",
        get_conflict,
    )
    monkeypatch.setattr(service, "archive_cloud_workspace_record", archive)

    with pytest.raises(CloudApiError) as error:
        await service.sync_cloud_workspace_branch(
            cast(AsyncSession, object()),
            user_id,
            stale.id,
            branch_name="main",
        )

    assert error.value.code == "cloud_branch_already_exists"
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_branch_sync_redirects_archived_managed_projection_to_canonical_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    sandbox_profile_id = uuid4()
    target_id = uuid4()
    archived = SimpleNamespace(
        id=uuid4(),
        git_branch="feature/stale",
        archived_at=object(),
        owner_scope="personal",
        owner_user_id=user_id,
        runtime_environment_id=None,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        git_provider="github",
        git_owner="owner",
        git_repo_name="repo",
    )
    canonical = SimpleNamespace(
        id=uuid4(),
        git_branch="main",
        archived_at=None,
        owner_scope="personal",
        owner_user_id=user_id,
        runtime_environment_id=None,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        git_provider="github",
        git_owner="owner",
        git_repo_name="repo",
    )

    async def can_interact(*_args: object, **_kwargs: object) -> object:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)

    async def get_workspace(*_args: object, **_kwargs: object) -> object:
        return archived

    async def get_conflict(*_args: object, **_kwargs: object) -> object:
        return canonical

    async def archive(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("already archived row should not be archived again")

    async def build_detail(_db: object, workspace: object) -> object:
        return workspace

    monkeypatch.setattr(service, "cloud_workspace_user_can_interact_with_db", can_interact)
    monkeypatch.setattr(service, "get_cloud_workspace_by_id", get_workspace)
    monkeypatch.setattr(
        service,
        "get_active_cloud_workspace_for_managed_profile_branch",
        get_conflict,
    )
    monkeypatch.setattr(service, "archive_cloud_workspace_record", archive)
    monkeypatch.setattr(service, "_build_workspace_detail_for_request", build_detail)

    result = await service.sync_cloud_workspace_branch(
        cast(AsyncSession, object()),
        user_id,
        archived.id,
        branch_name="main",
    )

    assert result is canonical
