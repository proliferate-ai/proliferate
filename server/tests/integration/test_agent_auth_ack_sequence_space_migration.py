"""Up/down proof for the ack sequence-space re-base (revision 189d414c1778).

Tier 2 (real postgres, real alembic). The slice-3 migration re-bases the ack
stamp's ordering domain: ``acked_revision`` (a ms-epoch ``max(updated_at)``
value, ~1.75e12) becomes ``acked_sequence``, a per-(user, surface) counter
that starts at 1 and steps by 1. A rename alone would leave every existing
receipt sitting permanently ABOVE the store's only-forward gate
(``acked_sequence <= incoming``), which suppresses the ack SILENTLY — the
upsert returns the stored row instead of raising — so every account that
acked before the revision would read "pending" forever, the exact falsehood
spec §3 flow 1 exists to prevent. The migration therefore deletes the
pre-revision rows, and this file proves the wedge is gone by ACKING at
sequence 1 across the upgraded database, not merely by reading a column.

The sibling ``test_agent_auth_sequence_governance.py`` is a store/API test
against an already-migrated database: it never constructs a pre-existing ack
row, which is precisely why the wedge shipped green. This file owns the
migration arms.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from alembic import command
from proliferate.db.migrations import build_alembic_config
from proliferate.db.store import agent_gateway as agent_gateway_store
from tests.postgres import temporary_database

_REVISION = "189d414c1778"
_DOWN_REVISION = "d9e4b7a2c6f1"
_ACK_TABLE = "agent_auth_delivery_ack"
_SEQUENCE_TABLE = "agent_auth_render_sequence"

# A realistic pre-slice-3 stamp: ms-epoch max(updated_at) over the surface's
# selection rows, i.e. 2026-08-26T15:00:00Z.
_MS_EPOCH_REVISION = 1756220400000
_PRE_FINGERPRINT = "fp-pre-slice-3-whole-document-hash"


async def _columns(database_url: str, table: str) -> set[str]:
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            return await conn.run_sync(
                lambda sync_conn: {
                    column["name"] for column in inspect(sync_conn).get_columns(table)
                }
            )
    finally:
        await engine.dispose()


async def _seed_pre_revision_ack(database_url: str) -> uuid.UUID:
    """One user plus the ack row a weeks-old account already holds."""
    user_id = uuid.uuid4()
    stamped = datetime(2026, 8, 26, 15, 0, tzinfo=UTC)
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    'INSERT INTO "user" '
                    "(id, email, hashed_password, is_active, is_superuser, is_verified, "
                    "created_at) VALUES (:id, :email, 'x', true, false, true, :created_at)"
                ),
                {"id": user_id, "email": f"ack-{user_id}@example.com", "created_at": stamped},
            )
            await conn.execute(
                text(
                    f"INSERT INTO {_ACK_TABLE} "
                    "(id, user_id, surface, acked_revision, acked_fingerprint, acked_at, "
                    "created_at, updated_at) "
                    "VALUES (:id, :user_id, 'local', :revision, :fingerprint, :stamped, "
                    ":stamped, :stamped)"
                ),
                {
                    "id": uuid.uuid4(),
                    "user_id": user_id,
                    "revision": _MS_EPOCH_REVISION,
                    "fingerprint": _PRE_FINGERPRINT,
                    "stamped": stamped,
                },
            )
    finally:
        await engine.dispose()
    return user_id


async def _rows(database_url: str) -> list[tuple[int, str]]:
    """Every ack row as (acked_sequence, acked_fingerprint)."""
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            result = await conn.execute(
                text(f"SELECT acked_sequence, acked_fingerprint FROM {_ACK_TABLE}")
            )
            return [(int(sequence), fingerprint) for sequence, fingerprint in result.all()]
    finally:
        await engine.dispose()


async def _ack_through_the_store(
    database_url: str,
    *,
    user_id: uuid.UUID,
    sequence: int,
    fingerprint: str,
) -> int:
    """Stamp through the real store (real gate) and report the stored sequence."""
    engine = create_async_engine(database_url, echo=False)
    try:
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            record = await agent_gateway_store.record_delivery_ack(
                session,
                user_id=user_id,
                surface="local",
                sequence=sequence,
                fingerprint=fingerprint,
            )
            await session.commit()
            return record.acked_sequence
    finally:
        await engine.dispose()


async def test_a_pre_slice_3_ms_epoch_ack_does_not_wedge_the_new_sequence_space() -> None:
    async with temporary_database("agent_auth_ack_sequence_space") as (_name, database_url):
        config = build_alembic_config(database_url)

        # 1 · the schema immediately BEFORE the re-base.
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        before = await _columns(database_url, _ACK_TABLE)
        assert "acked_revision" in before
        assert "acked_sequence" not in before

        # 2 · the row a pre-slice-3 account carries: a ms-epoch stamp.
        user_id = await _seed_pre_revision_ack(database_url)

        # 3 · the re-base.
        await asyncio.to_thread(command.upgrade, config, _REVISION)
        after = await _columns(database_url, _ACK_TABLE)
        assert "acked_sequence" in after
        assert "acked_revision" not in after

        # 3b · the render-sequence table exists with its full column set —
        # `lineage` included (non-null, minted app-side on insert): the
        # counter's birth identity that the runtime's foreign-lineage refusal
        # keys on. The table is created in this revision, so the column needs
        # no backfill and no server default.
        sequence_columns = await _columns(database_url, _SEQUENCE_TABLE)
        assert {
            "id",
            "user_id",
            "surface",
            "sequence",
            "lineage",
            "fingerprint",
            "rendered_at",
            "created_at",
            "updated_at",
        } <= sequence_columns

        # 4 · neutralized. The receipt is deleted, not rewritten: its sequence
        # AND its fingerprint address a document space that no longer exists,
        # so the honest post-governance state is "no machine has acked yet" —
        # which is also the state the applied read already spells as pending.
        assert await _rows(database_url) == []

        # 5 · THE POINT: the new counter's first ack lands. Under a
        # rename-only migration the preserved 1756220400000 would sit above
        # the store's ``acked_sequence <= incoming`` gate forever, the upsert
        # would return the stale row, and this would report the ms-epoch value
        # while the courier believed it had acked.
        assert (
            await _ack_through_the_store(
                database_url, user_id=user_id, sequence=1, fingerprint="fp-new-space-1"
            )
            == 1
        )
        assert await _rows(database_url) == [(1, "fp-new-space-1")]

        # ...and the stamp keeps moving forward from there.
        assert (
            await _ack_through_the_store(
                database_url, user_id=user_id, sequence=2, fingerprint="fp-new-space-2"
            )
            == 2
        )
        assert await _rows(database_url) == [(2, "fp-new-space-2")]

        # 6 · the downgrade arm runs and reverts the column name. It cannot
        # resurrect the deleted ms-epoch value — see the migration docstring —
        # and it drops the counter-space receipts for the same reason the
        # upgrade dropped the ms-epoch ones.
        await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
        rolled_back = await _columns(database_url, _ACK_TABLE)
        assert "acked_revision" in rolled_back
        assert "acked_sequence" not in rolled_back

        await asyncio.to_thread(command.upgrade, config, _REVISION)
        assert "acked_sequence" in await _columns(database_url, _ACK_TABLE)


async def test_an_above_gate_stamp_silently_suppresses_a_lower_ack() -> None:
    """Why the DELETE is load-bearing: the wedge mechanism, demonstrated.

    The only-forward gate is correct and worth keeping — a delayed ack for a
    superseded document must not move the stamp backwards. What makes a
    preserved ms-epoch stamp fatal is that suppression is INVISIBLE: the
    upsert returns the stored row, so the caller gets a 200-shaped success
    carrying someone else's sequence. This test pins that behaviour against a
    hand-planted above-gate stamp, so the migration's delete cannot be
    reverted without a failure here explaining what it costs.
    """
    async with temporary_database("agent_auth_ack_gate") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        user_id = await _seed_pre_revision_ack(database_url)
        # Rename only — skip the neutralizing delete, reproducing what a
        # rename-only migration would have left behind.
        engine = create_async_engine(database_url, echo=False)
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        f"ALTER TABLE {_ACK_TABLE} RENAME COLUMN acked_revision TO acked_sequence"
                    )
                )
        finally:
            await engine.dispose()

        stored = await _ack_through_the_store(
            database_url, user_id=user_id, sequence=1, fingerprint="fp-new-space-1"
        )
        # No error, no stamp: the ms-epoch value comes back instead of 1.
        assert stored == _MS_EPOCH_REVISION
        assert await _rows(database_url) == [(_MS_EPOCH_REVISION, _PRE_FINGERPRINT)]
