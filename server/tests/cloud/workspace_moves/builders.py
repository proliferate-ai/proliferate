"""Fixture builders shared by the workspace_move service unit tests."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.db.store.repositories import RepoConfigValue, RepoEnvironmentValue
from proliferate.db.store.workspace_moves import WorkspaceMoveValue
from proliferate.server.cloud.workspace_moves import service
from proliferate.server.cloud.workspace_moves.models import (
    StartWorkspaceMoveRequest,
    WorkspaceMoveEndpointRef,
)


def now() -> datetime:
    return datetime.now(UTC)


def move(
    *,
    phase: str = "started",
    canonical_side: str = "source",
    source_kind: str = "local",
    destination_kind: str = "cloud",
    source_ref: dict[str, object] | None = None,
    destination_ref: dict[str, object] | None = None,
    base_commit_sha: str = "a" * 40,
    move_id: UUID | None = None,
    user_id: UUID | None = None,
    repo_config_id: UUID | None = None,
    branch: str = "feature/move",
    idempotency_key: str = "key-1",
) -> WorkspaceMoveValue:
    stamp = now()
    return WorkspaceMoveValue(
        id=move_id or uuid4(),
        user_id=user_id or uuid4(),
        repo_config_id=repo_config_id or uuid4(),
        branch=branch,
        source_kind=source_kind,
        destination_kind=destination_kind,
        source_ref=source_ref or {},
        destination_ref=destination_ref or {},
        base_commit_sha=base_commit_sha,
        phase=phase,
        canonical_side=canonical_side,
        failure_code=None,
        failure_detail=None,
        idempotency_key=idempotency_key,
        created_at=stamp,
        updated_at=stamp,
        cutover_at=None,
        completed_at=None,
    )


def repo_config(*, repo_config_id: UUID, user_id: UUID) -> RepoConfigValue:
    stamp = now()
    return RepoConfigValue(
        id=repo_config_id,
        user_id=user_id,
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        created_at=stamp,
        updated_at=stamp,
        environments=(),
    )


def repo_environment(
    *, repo_config_id: UUID, user_id: UUID, environment_id: UUID | None = None
) -> RepoEnvironmentValue:
    stamp = now()
    return RepoEnvironmentValue(
        id=environment_id or uuid4(),
        repo_config_id=repo_config_id,
        user_id=user_id,
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        environment_kind="cloud",
        desktop_install_id=None,
        local_path=None,
        default_branch="main",
        setup_script="",
        run_command="",
        created_at=stamp,
        updated_at=stamp,
    )


def cloud_workspace(
    *,
    workspace_id: UUID | None = None,
    owner_user_id: UUID,
    repo_environment_id: UUID,
    git_branch: str = "feature/move",
    anyharness_workspace_id: str | None = "ah-1",
    archived_at: datetime | None = None,
) -> CloudWorkspaceValue:
    stamp = now()
    return CloudWorkspaceValue(
        id=workspace_id or uuid4(),
        owner_user_id=owner_user_id,
        repo_environment_id=repo_environment_id,
        display_name=git_branch,
        git_branch=git_branch,
        git_base_branch=git_branch,
        anyharness_workspace_id=anyharness_workspace_id,
        created_at=stamp,
        updated_at=stamp,
        archived_at=archived_at,
    )


def db() -> AsyncSession:
    return cast(AsyncSession, object())


def user(user_id: UUID | None = None) -> service._UserWithId:
    return cast(service._UserWithId, SimpleNamespace(id=user_id or uuid4()))


def noop_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _commit(_db: object) -> None:
        return None

    monkeypatch.setattr(service.transactions, "commit_workspace_move_session", _commit)


def start_body(
    *,
    repo_config_id: UUID,
    branch: str = "feature/move",
    source_kind: str = "local",
    destination_kind: str = "cloud",
    idempotency_key: str = "key-1",
) -> StartWorkspaceMoveRequest:
    return StartWorkspaceMoveRequest(
        repoConfigId=repo_config_id,
        branch=branch,
        baseCommitSha="a" * 40,
        source=WorkspaceMoveEndpointRef(kind=source_kind, desktopInstallId="desktop-1"),
        destination=WorkspaceMoveEndpointRef(kind=destination_kind),
        idempotencyKey=idempotency_key,
    )


def async_return(value: object):  # type: ignore[no-untyped-def]
    async def _fn(*_args: object, **_kwargs: object) -> object:
        return value

    return _fn
