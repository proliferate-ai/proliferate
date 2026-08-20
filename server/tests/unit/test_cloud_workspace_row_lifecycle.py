from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.workspaces import service


def _workspace() -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=uuid4(),
        owner_user_id=uuid4(),
        workspace_kind="repository_worktree",
        repo_environment_id=uuid4(),
        display_name="Workspace",
        git_branch="feature/row-lifecycle",
        git_base_branch="main",
        anyharness_workspace_id="runtime-workspace-1",
        created_at=now,
        updated_at=now,
        archived_at=None,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["archive", "delete"])
async def test_cloud_workspace_row_lifecycle_does_not_access_runtime(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    operation: str,
) -> None:
    workspace = _workspace()
    row_writes: list[str] = []

    async def _load_workspace(*_args: Any, **_kwargs: Any) -> SimpleNamespace:
        return workspace

    async def _archive(*_args: Any, **_kwargs: Any) -> SimpleNamespace:
        row_writes.append("archive")
        workspace.archived_at = datetime.now(UTC)
        return workspace

    async def _delete(*_args: Any, **_kwargs: Any) -> None:
        row_writes.append("delete")

    async def _payload(*_args: Any, **_kwargs: Any) -> SimpleNamespace:
        return workspace

    async def _unexpected_runtime_access(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("Cloud row lifecycle must not access the sandbox runtime")

    async def _unexpected_after_commit(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("Cloud row lifecycle must not schedule after-commit work")

    monkeypatch.setattr(service, "_load_user_workspace", _load_workspace)
    monkeypatch.setattr(service.cloud_workspace_store, "archive_cloud_workspace", _archive)
    monkeypatch.setattr(service.cloud_workspace_store, "delete_cloud_workspace", _delete)
    monkeypatch.setattr(service, "_workspace_payload", _payload)
    monkeypatch.setattr(
        service.cloud_sandbox_store,
        "load_personal_cloud_sandbox",
        _unexpected_runtime_access,
    )
    monkeypatch.setattr(
        service.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        _unexpected_runtime_access,
    )
    monkeypatch.setattr(
        service,
        "run_after_commit",
        _unexpected_after_commit,
        raising=False,
    )

    await db_session.begin()
    if operation == "archive":
        result = await service.archive_cloud_workspace_for_user(
            db_session,
            workspace.owner_user_id,
            workspace.id,
        )
        assert result is workspace
    else:
        result = await service.delete_cloud_workspace_for_user(
            db_session,
            workspace.owner_user_id,
            workspace.id,
        )
        assert result is None

    assert row_writes == [operation]

    await db_session.commit()
    for _ in range(5):
        await asyncio.sleep(0)
