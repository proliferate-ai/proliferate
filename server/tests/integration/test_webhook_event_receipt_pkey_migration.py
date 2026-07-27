"""Up/down proof for the webhook_event_receipt primary-key rename.

``9a0b1c2d3e4f_stripe_cloud_billing_foundation.py`` renamed the table
``sandbox_event_receipt`` to ``webhook_event_receipt`` via ``op.rename_table``,
which renames only the table — Postgres left the PRIMARY KEY constraint (and
its backing index, since Postgres keeps the two names identical) on
``sandbox_event_receipt_pkey``. A database that ran that migration therefore
diverges from ``Base.metadata.create_all`` (which names the constraint
``webhook_event_receipt_pkey``) forever, since nothing after 9a0b1c2d3e4f
touched it — the same bug class B4
(``b7c1e4d9f082_agent_model_snapshot_rekey.py``) found and fixed for its own
rename.

The load-bearing assertion is ``_pkey_name`` compared against what a fresh
``Base.metadata.create_all`` database produces for the same table: a
shape-only test (columns alone) cannot see a leftover pkey.
"""

from __future__ import annotations

import asyncio

from alembic import command
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from proliferate.db.models.base import Base
from tests.postgres import temporary_database

_REVISION = "ab5316095737"
_DOWN_REVISION = "35fa0038d703"
_TABLE = "webhook_event_receipt"
_OLD_PKEY = "sandbox_event_receipt_pkey"
_NEW_PKEY = "webhook_event_receipt_pkey"


async def _pkey_name(database_url: str, table: str) -> str | None:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(
                lambda sync_conn: inspect(sync_conn).get_pk_constraint(table).get("name")
            )
    finally:
        await engine.dispose()


async def test_webhook_event_receipt_pkey_rename_round_trips() -> None:
    async with temporary_database("webhook_event_receipt_pkey") as (_name, database_url):
        config = build_alembic_config(database_url)

        # Before this migration, a database that ran 9a0b1c2d3e4f still carries
        # the pre-rename constraint name.
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        assert await _pkey_name(database_url, _TABLE) == _OLD_PKEY

        await asyncio.to_thread(command.upgrade, config, _REVISION)
        assert await _pkey_name(database_url, _TABLE) == _NEW_PKEY

        # Re-running the upgrade against an already-migrated database must be a
        # true no-op (Postgres has no RENAME CONSTRAINT IF EXISTS, so the
        # migration's own inspector guard is what makes this safe).
        await asyncio.to_thread(command.upgrade, config, _REVISION)
        assert await _pkey_name(database_url, _TABLE) == _NEW_PKEY

        await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
        assert await _pkey_name(database_url, _TABLE) == _OLD_PKEY

        await asyncio.to_thread(command.upgrade, config, "head")
        assert await _pkey_name(database_url, _TABLE) == _NEW_PKEY


async def test_webhook_event_receipt_pkey_matches_fresh_create_all() -> None:
    """The migrated name must be name-for-name what create_all produces.

    Comparing against a virgin ``create_all`` schema is the assertion class
    that would have caught the original bug: a shape-only test (columns plus
    index names) sees nothing wrong with a leftover pkey, since the column set
    and the named indexes are unaffected by the constraint's name.
    """
    async with temporary_database("wer_pkey_fresh") as (_name, fresh_url):
        fresh_engine = create_async_engine(fresh_url, echo=False)
        try:
            async with fresh_engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                expected = await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).get_pk_constraint(_TABLE).get("name")
                )
        finally:
            await fresh_engine.dispose()
        assert expected == _NEW_PKEY

    async with temporary_database("wer_pkey_migrated") as (
        _name,
        migrated_url,
    ):
        config = build_alembic_config(migrated_url)
        await asyncio.to_thread(command.upgrade, config, "head")
        migrated = await _pkey_name(migrated_url, _TABLE)
        assert migrated == expected, (
            f"migrated {_TABLE} pkey diverges from Base.metadata.create_all: "
            f"{migrated!r} != {expected!r}"
        )
