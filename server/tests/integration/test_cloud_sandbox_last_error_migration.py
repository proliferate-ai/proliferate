"""Up/down proof for durable cloud-sandbox materialization error receipts."""

from __future__ import annotations

import asyncio

from alembic import command
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from tests.postgres import run_migrations_async, temporary_database

_REVISION = "f2c4a6e8b0d1"
_DOWN_REVISION = "e94a7c1d6b20"


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


async def test_last_error_migration_round_trips() -> None:
    async with temporary_database("cloud_sandbox_last_error") as (_name, database_url):
        await run_migrations_async(database_url)
        assert "last_error" in await _cloud_sandbox_columns(database_url)

        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
        assert "last_error" not in await _cloud_sandbox_columns(database_url)

        await asyncio.to_thread(command.upgrade, config, _REVISION)
        assert "last_error" in await _cloud_sandbox_columns(database_url)
