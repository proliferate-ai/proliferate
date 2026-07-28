from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, Literal
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.workspaces import service


def _workspace(
    *,
    anyharness_workspace_id: str | None = "runtime-workspace-1",
    workspace_kind: Literal["repository_worktree", "scratch"] = "repository_worktree",
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=uuid4(),
        owner_user_id=uuid4(),
        workspace_kind=workspace_kind,
        repo_environment_id=uuid4() if workspace_kind == "repository_worktree" else None,
        display_name="Workspace",
        git_branch="feature/reclaim",
        git_base_branch="main",
        anyharness_workspace_id=anyharness_workspace_id,
        created_at=now,
        updated_at=now,
        archived_at=None,
    )


async def _pump_after_commit() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


def _patch_workspace_operation(
    monkeypatch: pytest.MonkeyPatch,
    *,
    workspace: SimpleNamespace,
    sandbox: SimpleNamespace | None = None,
    retire_error: BaseException | None = None,
) -> list[tuple[str, str, str]]:
    retired: list[tuple[str, str, str]] = []
    sandbox = sandbox or SimpleNamespace(id=uuid4())

    async def _load_workspace(*_args: Any, **_kwargs: Any) -> SimpleNamespace:
        return workspace

    async def _archive(*_args: Any, **_kwargs: Any) -> SimpleNamespace:
        workspace.archived_at = datetime.now(UTC)
        return workspace

    async def _delete(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _payload(*_args: Any, **_kwargs: Any) -> SimpleNamespace:
        return workspace

    async def _load_sandbox(*_args: Any, **_kwargs: Any) -> SimpleNamespace | None:
        return sandbox

    async def _runtime_access(*_args: Any, **_kwargs: Any) -> tuple[str, str, str]:
        return ("https://runtime.invalid", "runtime-token", "runtime-data-key")

    async def _retire(
        runtime_url: str,
        access_token: str,
        *,
        anyharness_workspace_id: str,
    ) -> None:
        retired.append((runtime_url, access_token, anyharness_workspace_id))
        if retire_error is not None:
            raise retire_error

    monkeypatch.setattr(service, "_load_user_workspace", _load_workspace)
    monkeypatch.setattr(service.cloud_workspace_store, "archive_cloud_workspace", _archive)
    monkeypatch.setattr(service.cloud_workspace_store, "delete_cloud_workspace", _delete)
    monkeypatch.setattr(service, "_workspace_payload", _payload)
    monkeypatch.setattr(
        service.cloud_sandbox_store,
        "load_personal_cloud_sandbox",
        _load_sandbox,
    )
    monkeypatch.setattr(
        service.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        _runtime_access,
    )
    monkeypatch.setattr(service, "retire_runtime_workspace", _retire)
    return retired


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["archive", "delete"])
async def test_workspace_row_operation_retires_worktree_only_after_commit(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    operation: str,
) -> None:
    workspace = _workspace()
    retired = _patch_workspace_operation(monkeypatch, workspace=workspace)

    await db_session.begin()
    if operation == "archive":
        await service.archive_cloud_workspace_for_user(
            db_session,
            workspace.owner_user_id,
            workspace.id,
        )
    else:
        await service.delete_cloud_workspace_for_user(
            db_session,
            workspace.owner_user_id,
            workspace.id,
        )
    assert retired == []

    await db_session.commit()
    await _pump_after_commit()

    assert retired == [
        (
            "https://runtime.invalid",
            "runtime-token",
            "runtime-workspace-1",
        )
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("workspace", "has_sandbox"),
    [
        (_workspace(anyharness_workspace_id=None), True),
        (_workspace(workspace_kind="scratch"), True),
        (_workspace(), False),
    ],
)
async def test_archive_skips_retire_without_runtime_worktree_or_live_sandbox(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    workspace: SimpleNamespace,
    has_sandbox: bool,
) -> None:
    retired = _patch_workspace_operation(
        monkeypatch,
        workspace=workspace,
        sandbox=SimpleNamespace(id=uuid4()) if has_sandbox else None,
    )
    if not has_sandbox:

        async def _no_sandbox(*_args: Any, **_kwargs: Any) -> None:
            return None

        monkeypatch.setattr(
            service.cloud_sandbox_store,
            "load_personal_cloud_sandbox",
            _no_sandbox,
        )

    await db_session.begin()
    await service.archive_cloud_workspace_for_user(
        db_session,
        workspace.owner_user_id,
        workspace.id,
    )
    await db_session.commit()
    await _pump_after_commit()

    assert retired == []


@pytest.mark.asyncio
async def test_retire_failure_does_not_fail_delete(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    workspace = _workspace()
    retired = _patch_workspace_operation(
        monkeypatch,
        workspace=workspace,
        retire_error=RuntimeError("runtime unavailable"),
    )

    await db_session.begin()
    await service.delete_cloud_workspace_for_user(
        db_session,
        workspace.owner_user_id,
        workspace.id,
    )
    await db_session.commit()
    await _pump_after_commit()

    assert retired[-1][-1] == "runtime-workspace-1"
