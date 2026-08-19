"""Up/down proof for the (harness, context, owner) -> (harness, owner) re-key (B-3).

Tier 2 (real postgres, real alembic). Asserts the shape on both sides of the
revision, that pre-existing context-keyed rows are retained but retired to
``inactive`` (derived state: the runtime re-probes and the Worker uploads a
fresh composed document; the retained rows stay as the audit trail), and that
the re-keyed scope still carries no unique key — a racing duplicate upload
must be a benign extra row the next write collapses, not a 500 the Worker tick
cannot act on.
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

_REVISION = "c8d2e5f7a913"
_DOWN_REVISION = "ab5316095737"
_TABLE = "agent_model_snapshot"
_SCOPE_INDEX = f"ix_{_TABLE}_scope"


async def _columns(database_url: str) -> set[str]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(
                lambda sync_conn: {
                    column["name"] for column in inspect(sync_conn).get_columns(_TABLE)
                }
            )
    finally:
        await engine.dispose()


async def _indexes(database_url: str) -> dict[str, tuple[str, ...]]:
    """Index name -> column tuple (unique indexes included)."""
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(
                lambda sync_conn: {
                    index["name"]: tuple(index["column_names"])
                    for index in inspect(sync_conn).get_indexes(_TABLE)
                }
            )
    finally:
        await engine.dispose()


async def _seed_context_keyed_rows(database_url: str) -> uuid.UUID:
    """Context-keyed v1 rows as a pre-B-3 database holds them: two contexts for
    one harness (both active) plus one already-inactive historic row."""
    user_id = uuid.uuid4()
    engine = create_async_engine(database_url, echo=False)
    stamped = datetime(2026, 7, 20, 8, 0, tzinfo=UTC)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    'INSERT INTO "user" '
                    "(id, email, hashed_password, is_active, is_superuser, is_verified, "
                    "created_at) VALUES (:id, :email, 'x', true, false, true, :created_at)"
                ),
                {
                    "id": user_id,
                    "email": f"composed-rekey-{user_id}@example.com",
                    "created_at": stamped,
                },
            )
            for context, status in (
                ("gateway", "active"),
                ("anthropic-api", "active"),
                ("gateway", "inactive"),
            ):
                await conn.execute(
                    text(
                        f"INSERT INTO {_TABLE} "
                        "(id, harness_kind, auth_context_id, owner_user_id, snapshot_json, "
                        "probed_at, status) "
                        "VALUES (:id, 'claude', :context, :owner, :payload, :probed_at, :status)"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "context": context,
                        "owner": user_id,
                        "payload": '{"probedAt": "2026-07-20T08:00:00Z", "models": []}',
                        "probed_at": stamped,
                        "status": status,
                    },
                )
    finally:
        await engine.dispose()
    return user_id


async def _status_counts(database_url: str) -> dict[str, int]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            rows = await conn.execute(
                text(f"SELECT status, count(*) FROM {_TABLE} GROUP BY status")
            )
            return {status: int(count) for status, count in rows}
    finally:
        await engine.dispose()


async def _assert_duplicate_active_rows_are_tolerated(
    database_url: str,
    user_id: uuid.UUID,
) -> None:
    """Two active rows for one (harness, owner) must insert, not raise.

    Soft-versioning is kept as-is across the re-key: the scope carries no
    unique key, so a racing pair of Worker ticks stays a benign duplicate the
    next write collapses.
    """
    engine = create_async_engine(database_url, echo=False)
    stamped = datetime(2026, 7, 24, 9, 12, tzinfo=UTC)

    async def insert(status: str) -> None:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    f"INSERT INTO {_TABLE} "
                    "(id, harness_kind, owner_user_id, snapshot_json, probed_at, status) "
                    "VALUES (:id, 'claude', :owner, '{}', :probed_at, :status)"
                ),
                {"id": uuid.uuid4(), "owner": user_id, "probed_at": stamped, "status": status},
            )

    try:
        await insert("active")
        await insert("active")
        await insert("inactive")
        async with engine.begin() as conn:
            await conn.execute(
                text(f"DELETE FROM {_TABLE} WHERE probed_at = :probed_at"),
                {"probed_at": stamped},
            )
    finally:
        await engine.dispose()


async def test_composed_rekey_round_trips() -> None:
    async with temporary_database("ams_composed_rekey") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)

        # Pre-revision shape: the per-context key is present.
        before = await _columns(database_url)
        assert "auth_context_id" in before
        assert (await _indexes(database_url))[_SCOPE_INDEX] == (
            "harness_kind",
            "auth_context_id",
            "owner_user_id",
            "probed_at",
        )

        user_id = await _seed_context_keyed_rows(database_url)
        assert await _status_counts(database_url) == {"active": 2, "inactive": 1}

        await asyncio.to_thread(command.upgrade, config, _REVISION)

        # The column is gone; the scope index re-cut to (harness, owner, probed_at).
        after = await _columns(database_url)
        assert "auth_context_id" not in after
        assert after == {
            "id",
            "harness_kind",
            "owner_user_id",
            "snapshot_json",
            "probed_at",
            "status",
        }
        indexes = await _indexes(database_url)
        assert indexes[_SCOPE_INDEX] == ("harness_kind", "owner_user_id", "probed_at")
        assert not any(name.startswith("ux_") for name in indexes), (
            "the scope must carry no unique key (model-catalog.md §Storage)"
        )

        # Context-keyed rows are retired, not dropped and not promoted: no
        # single context's entry IS the composed observation, but the retained
        # rows are the audit trail. Reads filter active, so the layered read
        # serves the shipped seed until the first composed upload lands.
        assert await _status_counts(database_url) == {"inactive": 3}

        await _assert_duplicate_active_rows_are_tolerated(database_url, user_id)

        await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)

        # Composed rows cannot be attributed to a context, and the retired v1
        # rows lost their context id on the way up — the downgrade deletes.
        restored = await _columns(database_url)
        assert "auth_context_id" in restored
        assert await _status_counts(database_url) == {}
        assert (await _indexes(database_url))[_SCOPE_INDEX] == (
            "harness_kind",
            "auth_context_id",
            "owner_user_id",
            "probed_at",
        )

        await asyncio.to_thread(command.upgrade, config, "head")
        assert "auth_context_id" not in await _columns(database_url)
