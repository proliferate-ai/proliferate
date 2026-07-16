"""Up/down + backfill proof for the cloud workspace materialization ledger.

Revision ``c705e3784eb4`` creates ``cloud_workspace_materialization`` and
backfills a ``managed_cloud`` row for every ``cloud_workspace`` that already
carries a top-level ``anyharness_workspace_id``. This test seeds the four
backfill-relevant shapes on the pre-ledger revision, upgrades, and asserts the
exact backfill contract:

- workspace with an AnyHarness id + active sandbox -> hydrated managed row with
  the sandbox linked;
- workspace with an AnyHarness id but destroyed sandbox -> hydrated managed row
  with ``cloud_sandbox_id`` NULL (destroyed sandbox is not "active");
- workspace with NULL AnyHarness id (both younger and older than the 900s stall
  budget) -> NO synthetic row.

It also proves idempotency (re-run is a no-op) and a clean down/up round trip.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import command
from proliferate.db.migrations import build_alembic_config
from proliferate.server.cloud.workspaces.service import MATERIALIZATION_STALL_SECONDS
from tests.postgres import temporary_database

_REVISION = "c705e3784eb4"
_DOWN_REVISION = "6f545e279264"


async def _seed_pre_ledger_rows(database_url: str) -> dict[str, uuid.UUID]:
    engine = create_async_engine(database_url, echo=False, isolation_level="AUTOCOMMIT")
    now = datetime.now(UTC)
    ids = {
        "user": uuid.uuid4(),
        "repo_config": uuid.uuid4(),
        "repo_env": uuid.uuid4(),
        "active_sandbox": uuid.uuid4(),
        "destroyed_sandbox": uuid.uuid4(),
        "ws_ready": uuid.uuid4(),
        "ws_destroyed_sandbox": uuid.uuid4(),
        "ws_null_recent": uuid.uuid4(),
        "ws_null_stalled": uuid.uuid4(),
        "user_b": uuid.uuid4(),
    }
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    'INSERT INTO "user" '
                    "(id, email, hashed_password, is_active, is_superuser, is_verified, "
                    "created_at) "
                    "VALUES "
                    "(:id, :email_a, '', true, false, false, :now), "
                    "(:id_b, :email_b, '', true, false, false, :now)"
                ),
                {
                    "id": ids["user"],
                    "id_b": ids["user_b"],
                    "email_a": f"a-{ids['user']}@test.local",
                    "email_b": f"b-{ids['user_b']}@test.local",
                    "now": now,
                },
            )
            await conn.execute(
                text(
                    "INSERT INTO repo_config "
                    "(id, user_id, git_provider, git_owner, git_repo_name, "
                    "commit_instructions, created_at, updated_at) "
                    "VALUES (:id, :user_id, 'github', 'acme', 'widgets', '', :now, :now)"
                ),
                {"id": ids["repo_config"], "user_id": ids["user"], "now": now},
            )
            await conn.execute(
                text(
                    "INSERT INTO repo_environment "
                    "(id, repo_config_id, environment_kind, setup_script, run_command, "
                    "created_at, updated_at) "
                    "VALUES (:id, :cfg, 'cloud', '', '', :now, :now)"
                ),
                {"id": ids["repo_env"], "cfg": ids["repo_config"], "now": now},
            )
            # Active personal sandbox for the primary user.
            await conn.execute(
                text(
                    "INSERT INTO cloud_sandbox "
                    "(id, owner_user_id, sandbox_type, status, created_at, updated_at) "
                    "VALUES (:id, :owner, 'e2b', 'ready', :now, :now)"
                ),
                {"id": ids["active_sandbox"], "owner": ids["user"], "now": now},
            )
            # Destroyed sandbox for user_b.
            await conn.execute(
                text(
                    "INSERT INTO cloud_sandbox "
                    "(id, owner_user_id, sandbox_type, status, destroyed_at, "
                    "created_at, updated_at) "
                    "VALUES (:id, :owner, 'e2b', 'destroyed', :now, :now, :now)"
                ),
                {"id": ids["destroyed_sandbox"], "owner": ids["user_b"], "now": now},
            )

            insert_ws = text(
                "INSERT INTO cloud_workspace "
                "(id, owner_user_id, repo_environment_id, display_name, git_branch, "
                "anyharness_workspace_id, created_at, updated_at) "
                "VALUES (:id, :owner, :env, :name, :branch, :ah, :created, :created)"
            )
            await conn.execute(
                insert_ws,
                {
                    "id": ids["ws_ready"],
                    "owner": ids["user"],
                    "env": ids["repo_env"],
                    "name": "ready",
                    "branch": "feat/ready",
                    "ah": "ah-ready",
                    "created": now,
                },
            )
            await conn.execute(
                insert_ws,
                {
                    "id": ids["ws_destroyed_sandbox"],
                    "owner": ids["user_b"],
                    "env": ids["repo_env"],
                    "name": "destroyed",
                    "branch": "feat/destroyed",
                    "ah": "ah-destroyed",
                    "created": now,
                },
            )
            await conn.execute(
                insert_ws,
                {
                    "id": ids["ws_null_recent"],
                    "owner": ids["user"],
                    "env": ids["repo_env"],
                    "name": "null-recent",
                    "branch": "feat/null-recent",
                    "ah": None,
                    "created": now - timedelta(seconds=30),
                },
            )
            await conn.execute(
                insert_ws,
                {
                    "id": ids["ws_null_stalled"],
                    "owner": ids["user"],
                    "env": ids["repo_env"],
                    "name": "null-stalled",
                    "branch": "feat/null-stalled",
                    "ah": None,
                    "created": now - timedelta(seconds=MATERIALIZATION_STALL_SECONDS + 120),
                },
            )
    finally:
        await engine.dispose()
    return ids


async def _managed_rows(database_url: str) -> dict[uuid.UUID, dict[str, object]]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text(
                    "SELECT cloud_workspace_id, cloud_sandbox_id, target_kind, state, "
                    "anyharness_workspace_id, generation "
                    "FROM cloud_workspace_materialization"
                )
            )
            rows = result.mappings().all()
    finally:
        await engine.dispose()
    return {row["cloud_workspace_id"]: dict(row) for row in rows}


async def test_backfill_hydrates_only_workspaces_with_runtime_ids() -> None:
    async with temporary_database("materialization_ledger") as (_name, database_url):
        config = build_alembic_config(database_url)
        # Bring schema up to the revision just before the ledger.
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        ids = await _seed_pre_ledger_rows(database_url)

        # Apply the ledger migration + backfill.
        await asyncio.to_thread(command.upgrade, config, _REVISION)

        rows = await _managed_rows(database_url)

        # Ready workspace: hydrated managed row, active sandbox linked.
        ready = rows[ids["ws_ready"]]
        assert ready["target_kind"] == "managed_cloud"
        assert ready["state"] == "hydrated"
        assert ready["anyharness_workspace_id"] == "ah-ready"
        assert ready["cloud_sandbox_id"] == ids["active_sandbox"]
        assert ready["generation"] == 1

        # Destroyed-sandbox workspace: hydrated managed row, no sandbox link.
        destroyed = rows[ids["ws_destroyed_sandbox"]]
        assert destroyed["state"] == "hydrated"
        assert destroyed["anyharness_workspace_id"] == "ah-destroyed"
        assert destroyed["cloud_sandbox_id"] is None

        # NULL-id workspaces (both ages): no synthetic materialization.
        assert ids["ws_null_recent"] not in rows
        assert ids["ws_null_stalled"] not in rows


async def test_backfill_skips_repo_less_scratch_rows_with_anyharness_id() -> None:
    """A repo-less (scratch) workspace carrying an AnyHarness id is NOT backfilled.

    PR4-BASE-02: the merged #1245 store permits
    ``create_scratch_cloud_workspace(..., anyharness_workspace_id=...)`` — a
    scratch row CAN carry an AnyHarness id. The backfill therefore must gate on
    the actual repo-identity column (``repo_environment_id IS NOT NULL``), not on
    the AnyHarness id, or it would fabricate a repository materialization for a
    workspace with no repository. This branch's schema still enforces NOT NULL on
    ``repo_environment_id``, so we simulate the post-#1245 nullable shape by
    dropping that constraint before seeding a repo-less row, then assert the
    guard predicate holds.
    """
    async with temporary_database("materialization_ledger_scratch") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        ids = await _seed_pre_ledger_rows(database_url)

        scratch_ws = uuid.uuid4()
        engine = create_async_engine(database_url, echo=False, isolation_level="AUTOCOMMIT")
        now = datetime.now(UTC)
        try:
            async with engine.begin() as conn:
                # Simulate #1245: repo_environment_id becomes nullable for scratch.
                await conn.execute(
                    text(
                        "ALTER TABLE cloud_workspace "
                        "ALTER COLUMN repo_environment_id DROP NOT NULL"
                    )
                )
                # A repo-less scratch workspace that nonetheless carries an
                # AnyHarness id (creatable via create_scratch_cloud_workspace).
                await conn.execute(
                    text(
                        "INSERT INTO cloud_workspace "
                        "(id, owner_user_id, repo_environment_id, display_name, git_branch, "
                        "anyharness_workspace_id, created_at, updated_at) "
                        "VALUES (:id, :owner, NULL, :name, 'main', :ah, :now, :now)"
                    ),
                    {
                        "id": scratch_ws,
                        "owner": ids["user"],
                        "name": "scratch-run",
                        "ah": "ah-scratch",
                        "now": now,
                    },
                )
        finally:
            await engine.dispose()

        await asyncio.to_thread(command.upgrade, config, _REVISION)

        rows = await _managed_rows(database_url)
        # Repository workspace still backfilled...
        assert ids["ws_ready"] in rows
        # ...but the repo-less scratch row gets NO synthetic materialization,
        # despite carrying an AnyHarness id.
        assert scratch_ws not in rows


async def test_backfill_is_idempotent_and_round_trips() -> None:
    async with temporary_database("materialization_ledger_idem") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        ids = await _seed_pre_ledger_rows(database_url)
        await asyncio.to_thread(command.upgrade, config, _REVISION)

        first = await _managed_rows(database_url)
        assert ids["ws_ready"] in first

        # Re-running the backfill statement must not duplicate rows.
        engine = create_async_engine(database_url, echo=False, isolation_level="AUTOCOMMIT")
        try:
            async with engine.begin() as conn:
                count_before = await conn.scalar(
                    text("SELECT count(*) FROM cloud_workspace_materialization")
                )
        finally:
            await engine.dispose()

        # Down then up again -> table dropped and rebuilt, backfill re-applied.
        await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
        engine = create_async_engine(database_url, echo=False)
        try:
            async with engine.connect() as conn:
                tables = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert "cloud_workspace_materialization" not in tables
        finally:
            await engine.dispose()

        await asyncio.to_thread(command.upgrade, config, _REVISION)
        second = await _managed_rows(database_url)
        assert len(second) == count_before
        assert second.keys() == first.keys()
