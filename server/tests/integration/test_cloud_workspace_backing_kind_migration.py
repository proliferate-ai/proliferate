"""Real-Postgres upgrade proof for the cloud workspace backing-kind migration.

MC5A-MIGRATION-PROOF-01. Unlike the server-default test, this starts a
disposable database at the PRIOR migration head, inserts representative
pre-existing legacy repository rows (active + archived) into the old schema
(where ``repo_environment_id`` is NOT NULL and no ``workspace_kind`` column
exists), then upgrades through ``c3a7b8d9e0f1`` and verifies:

- every legacy row is backfilled to ``repository_worktree``;
- ``repo_environment_id`` becomes nullable but preserves the existing value;
- the kind/repo-environment check constraints are enforced;
- a scratch row (no repo environment) is now insertable;
- the branch-uniqueness partial index carries the exact
  ``archived_at IS NULL AND workspace_kind = 'repository_worktree'`` predicate,
  collides on duplicate active repository branches, and exempts scratch rows.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from tests.postgres import run_migrations_async, temporary_database

_REVISION = "c3a7b8d9e0f1"
_DOWN_REVISION = "6f545e279264"
_BRANCH_INDEX = "ux_cloud_workspace_active_repo_environment_branch"


async def _seed_repo_environment(conn, *, owner_email: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Insert a user + cloud repo environment via raw SQL (schema-version-agnostic)."""
    user_id = uuid.uuid4()
    repo_config_id = uuid.uuid4()
    repo_environment_id = uuid.uuid4()
    await conn.execute(
        text(
            'INSERT INTO "user" (id, email, hashed_password, is_active, is_superuser, '
            "is_verified, created_at) "
            "VALUES (:id, :email, 'x', true, false, true, now())"
        ),
        {"id": user_id, "email": owner_email},
    )
    await conn.execute(
        text(
            "INSERT INTO repo_config (id, user_id, git_provider, git_owner, git_repo_name, "
            "commit_instructions, created_at, updated_at) "
            "VALUES (:id, :user_id, 'github', 'proliferate-ai', :repo, '', now(), now())"
        ),
        {"id": repo_config_id, "user_id": user_id, "repo": f"repo-{uuid.uuid4().hex[:8]}"},
    )
    await conn.execute(
        text(
            "INSERT INTO repo_environment (id, repo_config_id, environment_kind, default_branch, "
            "setup_script, run_command, created_at, updated_at) "
            "VALUES (:id, :cfg, 'cloud', 'main', '', '', now(), now())"
        ),
        {"id": repo_environment_id, "cfg": repo_config_id},
    )
    return user_id, repo_environment_id


async def _insert_legacy_repository_row(
    conn,
    *,
    user_id: uuid.UUID,
    repo_environment_id: uuid.UUID,
    branch: str,
    archived: bool,
) -> uuid.UUID:
    """Insert into the OLD (pre-migration) cloud_workspace schema.

    The prior schema has no ``workspace_kind`` column and a NOT NULL
    ``repo_environment_id``; this models a real pre-existing repository row.
    """
    workspace_id = uuid.uuid4()
    await conn.execute(
        text(
            "INSERT INTO cloud_workspace "
            "(id, owner_user_id, repo_environment_id, display_name, git_branch, "
            " git_base_branch, created_at, updated_at, archived_at) "
            "VALUES (:id, :owner, :repo_env, :name, :branch, 'main', now(), now(), "
            ":archived_at)"
        ),
        {
            "id": workspace_id,
            "owner": user_id,
            "repo_env": repo_environment_id,
            "name": branch,
            "branch": branch,
            "archived_at": datetime.now(UTC) if archived else None,
        },
    )
    return workspace_id


async def _column_is_nullable(conn, table: str, column: str) -> bool:
    return await conn.run_sync(
        lambda sync_conn: next(
            c["nullable"] for c in inspect(sync_conn).get_columns(table) if c["name"] == column
        )
    )


async def _branch_index_predicate(conn) -> str | None:
    row = await conn.execute(
        text(
            "SELECT pg_get_indexdef(indexrelid) FROM pg_index i "
            "JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = :name"
        ),
        {"name": _BRANCH_INDEX},
    )
    return row.scalar_one_or_none()


@pytest.mark.asyncio
async def test_legacy_repository_rows_upgrade_to_repository_worktree() -> None:
    async with temporary_database("mc5a_backfill") as (_name, database_url):
        config = build_alembic_config(database_url)

        # 1. Start at the PRIOR migration head (no workspace_kind column yet).
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)

        engine = create_async_engine(database_url, echo=False)
        try:
            # 2. Insert representative legacy repository rows (active + archived).
            async with engine.begin() as conn:
                user_id, repo_environment_id = await _seed_repo_environment(
                    conn, owner_email=f"legacy-{uuid.uuid4()}@example.com"
                )
                active_id = await _insert_legacy_repository_row(
                    conn,
                    user_id=user_id,
                    repo_environment_id=repo_environment_id,
                    branch="feature-active",
                    archived=False,
                )
                archived_id = await _insert_legacy_repository_row(
                    conn,
                    user_id=user_id,
                    repo_environment_id=repo_environment_id,
                    branch="feature-archived",
                    archived=True,
                )
                # The old schema has no workspace_kind column.
                cols_before = await conn.run_sync(
                    lambda c: {col["name"] for col in inspect(c).get_columns("cloud_workspace")}
                )
                assert "workspace_kind" not in cols_before
                assert (
                    await _column_is_nullable(conn, "cloud_workspace", "repo_environment_id")
                    is False
                )

            # 3. Upgrade through the target revision.
            await asyncio.to_thread(command.upgrade, config, _REVISION)

            async with engine.begin() as conn:
                # Backfill: every pre-existing row is a repository_worktree with
                # its repo metadata preserved.
                rows = (
                    (
                        await conn.execute(
                            text(
                                "SELECT id, workspace_kind, repo_environment_id, git_branch, "
                                "archived_at FROM cloud_workspace ORDER BY git_branch"
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                by_id = {r["id"]: r for r in rows}
                assert by_id[active_id]["workspace_kind"] == "repository_worktree"
                assert by_id[archived_id]["workspace_kind"] == "repository_worktree"
                assert by_id[active_id]["repo_environment_id"] == repo_environment_id
                assert by_id[archived_id]["repo_environment_id"] == repo_environment_id
                assert by_id[archived_id]["archived_at"] is not None

                # repo_environment_id is now nullable at the schema level.
                assert (
                    await _column_is_nullable(conn, "cloud_workspace", "repo_environment_id")
                    is True
                )

                # Partial index predicate is exactly repository-worktree + active.
                # Postgres renders the stored predicate with explicit ::text casts,
                # so normalize casts/parens away before asserting the exact terms.
                predicate = await _branch_index_predicate(conn)
                assert predicate is not None
                normalized = predicate.replace("(", "").replace(")", "").replace("::text", "")
                assert "archived_at IS NULL" in normalized
                assert "workspace_kind = 'repository_worktree'" in normalized
                # Both conditions are AND-combined (scratch + archived are excluded).
                assert " AND " in predicate

            # 4. Constraint behavior on the upgraded schema.
            engine2 = create_async_engine(database_url, echo=False)
            try:
                # A scratch row (no repo environment) is now insertable.
                async with engine2.begin() as conn:
                    scratch_id = uuid.uuid4()
                    await conn.execute(
                        text(
                            "INSERT INTO cloud_workspace "
                            "(id, owner_user_id, workspace_kind, repo_environment_id, "
                            " display_name, git_branch, created_at, updated_at) "
                            "VALUES (:id, :owner, 'scratch', NULL, 'Workflow run x', 'main', "
                            "now(), now())"
                        ),
                        {"id": scratch_id, "owner": user_id},
                    )
                    # A second scratch row on the same main branch does NOT collide.
                    await conn.execute(
                        text(
                            "INSERT INTO cloud_workspace "
                            "(id, owner_user_id, workspace_kind, repo_environment_id, "
                            " display_name, git_branch, created_at, updated_at) "
                            "VALUES (:id, :owner, 'scratch', NULL, 'Workflow run y', 'main', "
                            "now(), now())"
                        ),
                        {"id": uuid.uuid4(), "owner": user_id},
                    )

                # A scratch row WITH a repo environment violates the kind constraint.
                with pytest.raises(IntegrityError):
                    async with engine2.begin() as conn:
                        await conn.execute(
                            text(
                                "INSERT INTO cloud_workspace "
                                "(id, owner_user_id, workspace_kind, repo_environment_id, "
                                " display_name, git_branch, created_at, updated_at) "
                                "VALUES (:id, :owner, 'scratch', :repo_env, 'bad', 'main', "
                                "now(), now())"
                            ),
                            {
                                "id": uuid.uuid4(),
                                "owner": user_id,
                                "repo_env": repo_environment_id,
                            },
                        )

                # A duplicate ACTIVE repository branch collides on the partial index.
                with pytest.raises(IntegrityError):
                    async with engine2.begin() as conn:
                        await conn.execute(
                            text(
                                "INSERT INTO cloud_workspace "
                                "(id, owner_user_id, workspace_kind, repo_environment_id, "
                                " display_name, git_branch, created_at, updated_at) "
                                "VALUES (:id, :owner, 'repository_worktree', :repo_env, 'dup', "
                                "'feature-active', now(), now())"
                            ),
                            {
                                "id": uuid.uuid4(),
                                "owner": user_id,
                                "repo_env": repo_environment_id,
                            },
                        )
            finally:
                await engine2.dispose()
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_migration_round_trips_to_head() -> None:
    """Sanity: upgrading straight to head from a fresh DB includes this revision."""
    async with temporary_database("mc5a_head") as (_name, database_url):
        await run_migrations_async(database_url)
        engine = create_async_engine(database_url, echo=False)
        try:
            async with engine.begin() as conn:
                cols = await conn.run_sync(
                    lambda c: {col["name"] for col in inspect(c).get_columns("cloud_workspace")}
                )
                assert "workspace_kind" in cols
        finally:
            await engine.dispose()
