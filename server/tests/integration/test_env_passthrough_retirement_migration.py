"""Round-trip proof for the env-passthrough retirement migration (slice 6a).

The retired shape — an ``api_key`` selection naming an env var with no vault
reference — is unstorable on a healthy schema (the
``ck_agent_auth_selection_api_key_shape`` CHECK has required ``api_key_id``
since the 2026-07 selection rebuild), so the legacy row is SYNTHESIZED here by
dropping the constraint first, exactly the drifted-database state the
migration exists to heal. The proof: upgrade deletes the row, restores the
CHECK (the shape is unstorable again), leaves vault-backed rows untouched, and
the revision stays traversable downward for the migration suite.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from tests.postgres import temporary_database

_REVISION = "b3d5f7a9c1e3"
_DOWN_REVISION = "f2a3b4c5d6e7"
_CONSTRAINT = "ck_agent_auth_selection_api_key_shape"


async def _insert_selection(
    conn,  # type: ignore[no-untyped-def]
    *,
    user_id: uuid.UUID,
    api_key_id: uuid.UUID | None,
    env_var_name: str,
) -> uuid.UUID:
    row_id = uuid.uuid4()
    await conn.execute(
        text(
            "INSERT INTO agent_auth_selection "
            "(id, user_id, harness_kind, surface, source_kind, api_key_id, "
            "env_var_name, enabled, created_at, updated_at) "
            "VALUES (:id, :user_id, 'claude', 'local', 'api_key', :api_key_id, "
            ":env_var_name, true, now(), now())"
        ),
        {
            "id": row_id,
            "user_id": user_id,
            "api_key_id": api_key_id,
            "env_var_name": env_var_name,
        },
    )
    return row_id


async def test_env_passthrough_rows_are_deleted_and_the_shape_resealed() -> None:
    async with temporary_database("env_passthrough_retirement") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        engine = create_async_engine(database_url, echo=False)
        try:
            user_id = uuid.uuid4()
            vault_key_id = uuid.uuid4()
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        'INSERT INTO "user" '
                        "(id, email, hashed_password, is_active, is_superuser, "
                        "is_verified, created_at) "
                        "VALUES (:id, :email, 'x', true, false, true, now())"
                    ),
                    {"id": user_id, "email": f"env-passthrough-{user_id}@example.com"},
                )
                await conn.execute(
                    text(
                        "INSERT INTO agent_api_key "
                        "(id, user_id, title, kind, value_ciphertext, encryption_key_id, "
                        "redacted_hint, status, created_at, updated_at) "
                        "VALUES (:id, :user_id, 'Kept key', 'api_key', 'ciphertext', "
                        "'test-key', 'sk-…keep', 'active', now(), now())"
                    ),
                    {"id": vault_key_id, "user_id": user_id},
                )
                # Synthesize the drifted database: the CHECK gone, a legacy
                # env-passthrough row stored.
                await conn.execute(
                    text(f"ALTER TABLE agent_auth_selection DROP CONSTRAINT {_CONSTRAINT}")
                )
                legacy_id = await _insert_selection(
                    conn,
                    user_id=user_id,
                    api_key_id=None,
                    env_var_name="ANTHROPIC_API_KEY",
                )
                kept_id = await _insert_selection(
                    conn,
                    user_id=user_id,
                    api_key_id=vault_key_id,
                    env_var_name="OPENROUTER_API_KEY",
                )

            await asyncio.to_thread(command.upgrade, config, _REVISION)

            async with engine.begin() as conn:
                rows = (
                    (
                        await conn.execute(
                            text(
                                "SELECT id FROM agent_auth_selection "
                                "WHERE source_kind = 'api_key' ORDER BY id"
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                assert legacy_id not in rows, "the env-passthrough row must be deleted"
                assert kept_id in rows, "vault-backed rows must survive untouched"

            # The CHECK is back: the retired shape is unstorable again.
            with pytest.raises(IntegrityError):
                async with engine.begin() as conn:
                    await _insert_selection(
                        conn,
                        user_id=user_id,
                        api_key_id=None,
                        env_var_name="XAI_API_KEY",
                    )

            # Traversable downward, and the kept row still exists below.
            await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
            async with engine.begin() as conn:
                count = (
                    await conn.execute(
                        text("SELECT count(*) FROM agent_auth_selection WHERE id = :id"),
                        {"id": kept_id},
                    )
                ).scalar_one()
                assert count == 1
        finally:
            await engine.dispose()


async def test_upgrade_is_a_no_op_on_a_healthy_schema() -> None:
    # The hosted database's case (audited 2026-08-27: zero legacy rows, CHECK
    # present): the migration deletes nothing and leaves the constraint as-is.
    async with temporary_database("env_passthrough_healthy") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _REVISION)
        engine = create_async_engine(database_url, echo=False)
        try:
            async with engine.begin() as conn:
                names = (
                    (
                        await conn.execute(
                            text(
                                "SELECT conname FROM pg_constraint "
                                "WHERE conrelid = 'agent_auth_selection'::regclass "
                                "AND contype = 'c'"
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
            assert _CONSTRAINT in names
        finally:
            await engine.dispose()
