"""Up/down proof for the agent_catalog_snapshot -> agent_model_snapshot re-key.

Tier 2 (real postgres, real alembic). Asserts the shape on both sides of the
revision, that a pre-existing row is dropped rather than mis-mapped (see the
migration's docstring for why mapping is impossible, not merely lossy), and that
the scope carries no unique key — a racing duplicate upload must be a benign
extra row the next write collapses, not a 500 the Worker tick cannot act on.

The ORM-metadata comparison that used to live here (migrated schema ==
``Base.metadata.create_all`` schema) moved to
``test_agent_model_snapshot_composed_rekey_migration.py``: the ORM now models
the post-B-3 composed shape (no ``auth_context_id``), so the comparison only
holds at the composed re-key's revision, not at this one.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import command
from proliferate.db.migrations import build_alembic_config
from tests.postgres import temporary_database

_REVISION = "b7c1e4d9f082"
_DOWN_REVISION = "28adf1a9e376"
_OLD_TABLE = "agent_catalog_snapshot"
_NEW_TABLE = "agent_model_snapshot"


async def _tables(database_url: str) -> set[str]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(lambda sync_conn: set(inspect(sync_conn).get_table_names()))
    finally:
        await engine.dispose()


async def _columns(database_url: str, table: str) -> dict[str, bool]:
    """Column name -> nullable."""
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(
                lambda sync_conn: {
                    column["name"]: bool(column["nullable"])
                    for column in inspect(sync_conn).get_columns(table)
                }
            )
    finally:
        await engine.dispose()


async def _indexes(database_url: str, table: str) -> set[str]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(
                lambda sync_conn: {
                    index["name"] for index in inspect(sync_conn).get_indexes(table)
                }
            )
    finally:
        await engine.dispose()


def _schema_names(sync_conn, table: str) -> dict[str, object]:  # type: ignore[no-untyped-def]
    """Every named constraint/index on a table, as an order-insensitive shape."""
    inspector = inspect(sync_conn)
    return {
        "pk": inspector.get_pk_constraint(table).get("name"),
        "fks": {fk["name"] for fk in inspector.get_foreign_keys(table)},
        "checks": {ck["name"] for ck in inspector.get_check_constraints(table)},
        "uniques": {uq["name"] for uq in inspector.get_unique_constraints(table)},
        "indexes": {ix["name"] for ix in inspector.get_indexes(table)},
    }


async def _constraint_shape(database_url: str, table: str) -> dict[str, object]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(_schema_names, table)
    finally:
        await engine.dispose()


async def _seed_pre_rekey_rows(database_url: str) -> uuid.UUID:
    """One ownerless seed row and one owned gateway row, as pre-B4 databases hold."""
    user_id = uuid.uuid4()
    engine = create_async_engine(database_url, echo=False)
    stamped = datetime(2026, 7, 1, 8, 0, tzinfo=UTC)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    'INSERT INTO "user" '
                    "(id, email, hashed_password, is_active, is_superuser, is_verified, "
                    "created_at) VALUES (:id, :email, 'x', true, false, true, :created_at)"
                ),
                {"id": user_id, "email": f"rekey-{user_id}@example.com", "created_at": stamped},
            )
            for owner, route, source in (
                (None, "gateway", "seed"),
                (user_id, "gateway", "probe"),
                (user_id, "native", "runtime-mirror"),
            ):
                await conn.execute(
                    text(
                        f"INSERT INTO {_OLD_TABLE} "
                        "(id, harness_kind, surface, route, owner_user_id, models_json, "
                        "probed_at, source, status) "
                        "VALUES (:id, 'claude', 'cloud', :route, :owner, :models, "
                        ":probed_at, :source, 'active')"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "route": route,
                        "owner": owner,
                        "models": '[{"id": "claude-sonnet-4-5"}]',
                        "probed_at": stamped,
                        "source": source,
                    },
                )
    finally:
        await engine.dispose()
    return user_id


async def _row_count(database_url: str, table: str) -> int:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return int((await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one())
    finally:
        await engine.dispose()


async def test_model_snapshot_rekey_round_trips() -> None:
    async with temporary_database("agent_model_snapshot_rekey") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)

        # Pre-revision shape: route/surface/source present, owner nullable.
        assert _OLD_TABLE in await _tables(database_url)
        before = await _columns(database_url, _OLD_TABLE)
        assert {"surface", "route", "source", "models_json"} <= set(before)
        assert before["owner_user_id"] is True

        user_id = await _seed_pre_rekey_rows(database_url)
        assert await _row_count(database_url, _OLD_TABLE) == 3

        await asyncio.to_thread(command.upgrade, config, _REVISION)

        tables = await _tables(database_url)
        assert _NEW_TABLE in tables
        assert _OLD_TABLE not in tables

        after = await _columns(database_url, _NEW_TABLE)
        assert set(after) == {
            "id",
            "harness_kind",
            "auth_context_id",
            "owner_user_id",
            "snapshot_json",
            "probed_at",
            "status",
        }
        # No ownerless seed rows any more: the seed tier is a read-time fallback.
        assert after["owner_user_id"] is False

        indexes = await _indexes(database_url, _NEW_TABLE)
        assert {f"ix_{_NEW_TABLE}_scope", f"ix_{_NEW_TABLE}_owner_user_id"} <= indexes
        assert not any(name.startswith("ux_") for name in indexes), (
            "the scope must carry no unique key (model-catalog.md §Storage)"
        )

        # Stale rows are dropped, not mis-mapped onto a guessed auth context.
        assert await _row_count(database_url, _NEW_TABLE) == 0

        # The rename must leave no pkey/fkey on its pre-rename name (the ORM
        # comparison that used to pin this lives at the composed re-key now).
        migrated_names = await _constraint_shape(database_url, _NEW_TABLE)
        assert migrated_names["pk"] == f"{_NEW_TABLE}_pkey"
        assert f"{_NEW_TABLE}_owner_user_id_fkey" in migrated_names["fks"]

        await _assert_duplicate_active_rows_are_tolerated(database_url, user_id)

        await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)

        rolled_back = await _tables(database_url)
        assert _OLD_TABLE in rolled_back
        assert _NEW_TABLE not in rolled_back
        restored = await _columns(database_url, _OLD_TABLE)
        assert {"surface", "route", "source", "models_json"} <= set(restored)
        assert restored["owner_user_id"] is True
        assert await _row_count(database_url, _OLD_TABLE) == 0
        # Symmetric: a rolled-back database carries the pre-B4 names back.
        rolled_back_names = await _constraint_shape(database_url, _OLD_TABLE)
        assert rolled_back_names["pk"] == f"{_OLD_TABLE}_pkey"
        assert f"{_OLD_TABLE}_owner_user_id_fkey" in rolled_back_names["fks"]

        await asyncio.to_thread(command.upgrade, config, "head")
        assert _NEW_TABLE in await _tables(database_url)


async def _assert_duplicate_active_rows_are_tolerated(
    database_url: str,
    user_id: uuid.UUID,
) -> None:
    """Two active rows for one scope must insert, not raise.

    Uploads are fire-and-forget from the Worker's convergence tick, so two ticks
    racing the same context is a real (if rare) sequence. A unique key here would
    turn it into a 500 the Worker cannot act on; the read takes the latest active
    row by ``probed_at`` instead, and the next write collapses the duplicate.
    """
    engine = create_async_engine(database_url, echo=False)
    stamped = datetime(2026, 7, 24, 9, 12, tzinfo=UTC)

    async def insert(status: str) -> None:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    f"INSERT INTO {_NEW_TABLE} "
                    "(id, harness_kind, auth_context_id, owner_user_id, snapshot_json, "
                    "probed_at, status) "
                    "VALUES (:id, 'claude', 'gateway', :owner, '{}', :probed_at, :status)"
                ),
                {
                    "id": uuid.uuid4(),
                    "owner": user_id,
                    "probed_at": stamped,
                    "status": status,
                },
            )

    try:
        await insert("active")
        await insert("active")
        await insert("inactive")
        assert await _row_count(database_url, _NEW_TABLE) == 3
        async with engine.begin() as conn:
            await conn.execute(text(f"DELETE FROM {_NEW_TABLE}"))
    finally:
        await engine.dispose()
