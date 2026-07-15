"""Real-Postgres proof for placement-neutral cloud workspace identity (5a).

Covers the DB-layer invariants of the ``workspace_kind`` migration:

- backfill/server default makes an unspecified row a ``repository_worktree``;
- repository worktrees require a real ``repo_environment_id``;
- scratch workspaces forbid a ``repo_environment_id``;
- repository branch uniqueness is scoped to repository worktrees, so multiple
  scratch rows can share the ``main`` branch for one owner.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import GitProvider, RepoEnvironmentKind
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workspaces as store
from proliferate.server.cloud.workspaces.domain.naming import scratch_workspace_display_name


async def _seed_user(db: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"identity-{uuid.uuid4()}@example.com",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user.id


async def _seed_cloud_repo_environment(db: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    repo_config = RepoConfig(
        user_id=user_id,
        git_provider=GitProvider.github,
        git_owner="proliferate-ai",
        git_repo_name=f"repo-{uuid.uuid4().hex[:8]}",
    )
    db.add(repo_config)
    await db.flush()
    repo_environment = RepoEnvironment(
        repo_config_id=repo_config.id,
        environment_kind=RepoEnvironmentKind.cloud,
        default_branch="main",
        setup_script="",
        run_command="",
    )
    db.add(repo_environment)
    await db.flush()
    return repo_environment.id


@pytest.mark.asyncio
async def test_backfill_defaults_unspecified_row_to_repository_worktree(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    repo_environment_id = await _seed_cloud_repo_environment(db_session, user_id)
    workspace_id = uuid.uuid4()

    # Insert without workspace_kind — the migration's NOT NULL server default is
    # exactly the backfill applied to every pre-existing row.
    await db_session.execute(
        text(
            "INSERT INTO cloud_workspace "
            "(id, owner_user_id, repo_environment_id, display_name, git_branch, "
            " created_at, updated_at) "
            "VALUES (:id, :owner, :repo_env, :name, :branch, now(), now())"
        ),
        {
            "id": workspace_id,
            "owner": user_id,
            "repo_env": repo_environment_id,
            "name": "feature",
            "branch": "feature",
        },
    )
    await db_session.flush()

    loaded = await store.get_cloud_workspace_by_id(db_session, workspace_id)
    assert loaded is not None
    assert loaded.workspace_kind == "repository_worktree"


@pytest.mark.asyncio
async def test_repository_worktree_requires_repo_environment(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    db_session.add(
        CloudWorkspace(
            owner_user_id=user_id,
            workspace_kind="repository_worktree",
            repo_environment_id=None,
            display_name="orphan",
            git_branch="feature",
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()


@pytest.mark.asyncio
async def test_scratch_forbids_repo_environment(db_session: AsyncSession) -> None:
    user_id = await _seed_user(db_session)
    repo_environment_id = await _seed_cloud_repo_environment(db_session, user_id)
    db_session.add(
        CloudWorkspace(
            owner_user_id=user_id,
            workspace_kind="scratch",
            repo_environment_id=repo_environment_id,
            display_name="Workflow run x",
            git_branch="main",
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()


@pytest.mark.asyncio
async def test_create_scratch_cloud_workspace_shape(db_session: AsyncSession) -> None:
    user_id = await _seed_user(db_session)
    invocation_id = uuid.uuid4()
    workspace = await store.create_scratch_cloud_workspace(
        db_session,
        user_id=user_id,
        display_name=scratch_workspace_display_name(invocation_id),
    )
    assert workspace.workspace_kind == "scratch"
    assert workspace.repo_environment_id is None
    assert workspace.git_branch == "main"
    assert workspace.git_base_branch is None
    assert workspace.display_name == f"Workflow run {invocation_id}"


@pytest.mark.asyncio
async def test_branch_uniqueness_scoped_to_repository_worktrees(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    repo_environment_id = await _seed_cloud_repo_environment(db_session, user_id)

    first = await store.create_cloud_workspace(
        db_session,
        user_id=user_id,
        repo_environment_id=repo_environment_id,
        display_name="feature",
        git_branch="feature",
        git_base_branch="main",
    )
    assert first is not None
    # Same owner + repo environment + branch collides for repository worktrees.
    duplicate = await store.create_cloud_workspace(
        db_session,
        user_id=user_id,
        repo_environment_id=repo_environment_id,
        display_name="feature",
        git_branch="feature",
        git_base_branch="main",
    )
    assert duplicate is None

    # Scratch rows all share git_branch="main" and are exempt from that index.
    scratch_a = await store.create_scratch_cloud_workspace(
        db_session, user_id=user_id, display_name="Workflow run a"
    )
    scratch_b = await store.create_scratch_cloud_workspace(
        db_session, user_id=user_id, display_name="Workflow run b"
    )
    assert scratch_a.id != scratch_b.id
    assert scratch_a.git_branch == scratch_b.git_branch == "main"
