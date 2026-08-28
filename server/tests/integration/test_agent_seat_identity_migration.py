"""Up/down proof for the structured seat identity columns (b3d5f7a9c1e2).

Tier 2 (real postgres, real alembic). Slice 7's data enabler 1 adds nullable
``seat_email``/``seat_plan`` to ``agent_api_key`` with NO backfill — a seat
minted before the revision must come through the upgrade untouched, its new
columns NULL (the pane then renders its composed title, the ruled fallback).
The sibling API test (``test_agent_gateway_api.py``'s mint roundtrip) runs
against an already-migrated database, so it can never observe a pre-revision
row; this file owns the migration arms.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import command
from proliferate.db.migrations import build_alembic_config
from tests.postgres import temporary_database

_REVISION = "b3d5f7a9c1e2"
_DOWN_REVISION = "a9f3c17b42d8"
_TABLE = "agent_api_key"
_SEAT_COLUMNS = {"seat_email", "seat_plan"}


def _upgrade(database_url: str, revision: str) -> None:
    command.upgrade(build_alembic_config(database_url), revision)


def _downgrade(database_url: str, revision: str) -> None:
    command.downgrade(build_alembic_config(database_url), revision)


async def _columns(database_url: str) -> dict[str, bool]:
    """Column name -> nullable for ``agent_api_key``."""
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(
                lambda sync_conn: {
                    column["name"]: bool(column["nullable"])
                    for column in inspect(sync_conn).get_columns(_TABLE)
                }
            )
    finally:
        await engine.dispose()


async def _seed_pre_revision_seat(database_url: str) -> uuid.UUID:
    """One user plus the seat row an account minted before slice 7 holds."""
    seat_id = uuid.uuid4()
    minted = datetime(2026, 8, 20, 12, 0, tzinfo=UTC)
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            user_id = uuid.uuid4()
            await conn.execute(
                text(
                    'INSERT INTO "user" '
                    "(id, email, hashed_password, is_active, is_superuser, is_verified, "
                    "created_at) VALUES (:id, :email, 'x', true, false, true, :created_at)"
                ),
                {"id": user_id, "email": f"seat-{user_id}@example.com", "created_at": minted},
            )
            await conn.execute(
                text(
                    f"INSERT INTO {_TABLE} "
                    "(id, user_id, title, kind, value_ciphertext, encryption_key_id, "
                    "redacted_hint, status, created_at, updated_at) "
                    "VALUES (:id, :user_id, 'Max seat · pre@example.com · Max 5x', "
                    "'anthropic_subscription', 'ciphertext-not-a-token', 'v1', "
                    "'sk-...pre1', 'active', :minted, :minted)"
                ),
                {"id": seat_id, "user_id": user_id, "minted": minted},
            )
    finally:
        await engine.dispose()
    return seat_id


async def _seat_identity(
    database_url: str, seat_id: uuid.UUID
) -> tuple[str, str | None, str | None]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            row = (
                await conn.execute(
                    text(f"SELECT title, seat_email, seat_plan FROM {_TABLE} WHERE id = :id"),
                    {"id": seat_id},
                )
            ).one()
            return (row.title, row.seat_email, row.seat_plan)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_seat_identity_upgrade_leaves_existing_seats_null() -> None:
    async with temporary_database("seat_identity_migration") as (_name, database_url):
        await asyncio.to_thread(_upgrade, database_url, _DOWN_REVISION)
        assert not (_SEAT_COLUMNS & (await _columns(database_url)).keys())
        seat_id = await _seed_pre_revision_seat(database_url)

        await asyncio.to_thread(_upgrade, database_url, "head")

        columns = await _columns(database_url)
        assert columns.keys() >= _SEAT_COLUMNS
        assert all(columns[name] for name in _SEAT_COLUMNS), "seat columns must be nullable"
        title, seat_email, seat_plan = await _seat_identity(database_url, seat_id)
        # No backfill, by ruling: the composed title stays the row's only
        # identity and the structured fields stay NULL.
        assert title == "Max seat · pre@example.com · Max 5x"
        assert seat_email is None
        assert seat_plan is None


@pytest.mark.asyncio
async def test_seat_identity_downgrade_drops_the_columns() -> None:
    async with temporary_database("seat_identity_downgrade") as (_name, database_url):
        await asyncio.to_thread(_upgrade, database_url, _REVISION)
        assert (await _columns(database_url)).keys() >= _SEAT_COLUMNS

        await asyncio.to_thread(_downgrade, database_url, _DOWN_REVISION)

        assert not (_SEAT_COLUMNS & (await _columns(database_url)).keys())
