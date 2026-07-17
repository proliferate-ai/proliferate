"""Up/down proof for durable cloud-sandbox recovery state."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from tests.postgres import temporary_database

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


async def test_recovery_state_migration_round_trips() -> None:
    async with temporary_database("cloud_sandbox_last_error") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)

        recovery_columns = {
            "last_error",
            "materialization_attempt",
            "provider_observed_at",
        }
        assert recovery_columns.isdisjoint(await _cloud_sandbox_columns(database_url))

        user_id = uuid.uuid4()
        sandbox_id = uuid.uuid4()
        legacy_updated_at = datetime(2025, 11, 19, 8, 37, 12, 345678, tzinfo=UTC)
        engine = create_async_engine(database_url, echo=False)
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        'INSERT INTO "user" '
                        "(id, email, hashed_password, is_active, is_superuser, "
                        "is_verified, created_at) "
                        "VALUES (:id, :email, 'x', true, false, true, :created_at)"
                    ),
                    {
                        "id": user_id,
                        "email": f"sandbox-recovery-{user_id}@example.com",
                        "created_at": legacy_updated_at,
                    },
                )
                await conn.execute(
                    text(
                        "INSERT INTO cloud_sandbox "
                        "(id, owner_user_id, sandbox_type, provider_sandbox_id, status, "
                        "created_at, updated_at) "
                        "VALUES (:id, :owner_user_id, 'e2b', :provider_sandbox_id, "
                        "'ready', :created_at, :updated_at)"
                    ),
                    {
                        "id": sandbox_id,
                        "owner_user_id": user_id,
                        "provider_sandbox_id": "legacy-provider-sandbox",
                        "created_at": legacy_updated_at,
                        "updated_at": legacy_updated_at,
                    },
                )

            await asyncio.to_thread(command.upgrade, config, _REVISION)
            assert recovery_columns <= await _cloud_sandbox_columns(database_url)

            async with engine.begin() as conn:
                upgraded = (
                    (
                        await conn.execute(
                            text(
                                "SELECT id, updated_at, materialization_attempt, "
                                "provider_observed_at, last_error "
                                "FROM cloud_sandbox WHERE id = :id"
                            ),
                            {"id": sandbox_id},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert upgraded["id"] == sandbox_id
                assert upgraded["updated_at"] == legacy_updated_at
                assert upgraded["materialization_attempt"] == 0
                assert upgraded["provider_observed_at"] == legacy_updated_at
                assert upgraded["last_error"] is None

            await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
            assert recovery_columns.isdisjoint(await _cloud_sandbox_columns(database_url))

            async with engine.begin() as conn:
                downgraded = (
                    (
                        await conn.execute(
                            text(
                                "SELECT id, owner_user_id, provider_sandbox_id, status, "
                                "updated_at FROM cloud_sandbox WHERE id = :id"
                            ),
                            {"id": sandbox_id},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert dict(downgraded) == {
                    "id": sandbox_id,
                    "owner_user_id": user_id,
                    "provider_sandbox_id": "legacy-provider-sandbox",
                    "status": "ready",
                    "updated_at": legacy_updated_at,
                }

            await asyncio.to_thread(command.upgrade, config, "head")
            assert recovery_columns <= await _cloud_sandbox_columns(database_url)
        finally:
            await engine.dispose()
