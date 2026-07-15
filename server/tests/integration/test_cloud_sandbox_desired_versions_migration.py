"""Up/down proof for the ``cloud_sandbox`` target-scoped desired-versions migration.

Make Managed Runtime Updates Supervisor-Owned, decision 1: nullable
``desired_anyharness_version`` / ``desired_worker_version`` columns on
``cloud_sandbox``, added by revision ``6f545e279264``. ``head`` already runs
this migration on every test via the session-scoped ``migrated_test_database``
fixture (proving upgrade-to-head), so this test isolates the migration itself:
downgrading one step removes the columns, re-upgrading restores them, on a
disposable database.
"""

from __future__ import annotations

import asyncio

from alembic import command
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from tests.postgres import run_migrations_async, temporary_database

_REVISION = "6f545e279264"
_DOWN_REVISION = "ecffa1106847"
_NEW_COLUMNS = {"desired_anyharness_version", "desired_worker_version"}


async def _cloud_sandbox_columns(database_url: str) -> set[str]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(
                lambda sync_conn: {
                    column["name"] for column in inspect(sync_conn).get_columns("cloud_sandbox")
                }
            )
    finally:
        await engine.dispose()


async def test_migration_upgrade_adds_desired_version_columns() -> None:
    async with temporary_database("desired_versions_up") as (_name, database_url):
        await run_migrations_async(database_url)

        columns = await _cloud_sandbox_columns(database_url)

        assert columns >= _NEW_COLUMNS


async def test_migration_downgrade_removes_desired_version_columns() -> None:
    async with temporary_database("desired_versions_down") as (_name, database_url):
        await run_migrations_async(database_url)
        assert await _cloud_sandbox_columns(database_url) >= _NEW_COLUMNS

        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)

        columns_after_downgrade = await _cloud_sandbox_columns(database_url)
        assert _NEW_COLUMNS.isdisjoint(columns_after_downgrade)

        # Re-upgrading restores them (round-trip; no data-loss surprise on redo).
        await asyncio.to_thread(command.upgrade, config, _REVISION)
        assert await _cloud_sandbox_columns(database_url) >= _NEW_COLUMNS
