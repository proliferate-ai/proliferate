"""Real-Postgres upgrade/backfill proof for managed Workflow execution."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from tests.postgres import temporary_database

_REVISION = "d816f4895fc5"
_DOWN_REVISION = "c705e3784eb4"


@pytest.mark.asyncio
async def test_prior_invocation_schema_upgrades_and_backfills_exact_defaults() -> None:
    async with temporary_database("mc5b_managed_execution") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        engine = create_async_engine(database_url, echo=False)
        invocation_id = uuid.uuid4()
        user_id = uuid.uuid4()
        definition_id = uuid.uuid4()
        try:
            async with engine.begin() as conn:
                table_names = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert "workflow_invocation" in table_names
                assert "workflow_managed_execution" not in table_names
                await conn.execute(
                    text(
                        'INSERT INTO "user" '
                        "(id, email, hashed_password, is_active, is_superuser, "
                        "is_verified, created_at) "
                        "VALUES (:id, :email, 'x', true, false, true, now())"
                    ),
                    {"id": user_id, "email": f"mc5b-{uuid.uuid4()}@example.com"},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow_invocation "
                        "(id, user_id, workflow_definition_id, definition_revision, "
                        "title_snapshot, description_snapshot, schema_version, "
                        "creation_request_json, invocation_json, created_at, updated_at) "
                        "VALUES (:id, :user_id, :definition_id, 7, 'Legacy run', '', 1, "
                        "CAST(:request AS jsonb), CAST(:invocation AS jsonb), now(), now())"
                    ),
                    {
                        "id": invocation_id,
                        "user_id": user_id,
                        "definition_id": definition_id,
                        "request": "{}",
                        "invocation": "{}",
                    },
                )

            await asyncio.to_thread(command.upgrade, config, _REVISION)

            async with engine.begin() as conn:
                row = (
                    (
                        await conn.execute(
                            text(
                                "SELECT delivery_status, delivery_checkpoint, desired_state, "
                                "freshness_basis, execution_status, delivery_generation, "
                                "observation_generation, cancel_generation, "
                                "cancel_requested_at, created_at, updated_at "
                                "FROM workflow_managed_execution WHERE invocation_id = :id"
                            ),
                            {"id": invocation_id},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert {
                    key: row[key]
                    for key in (
                        "delivery_status",
                        "delivery_checkpoint",
                        "desired_state",
                        "freshness_basis",
                        "execution_status",
                        "delivery_generation",
                        "observation_generation",
                        "cancel_generation",
                        "cancel_requested_at",
                    )
                } == {
                    "delivery_status": "prepared",
                    "delivery_checkpoint": "none",
                    "desired_state": "active",
                    "freshness_basis": "pending",
                    "execution_status": None,
                    "delivery_generation": 1,
                    "observation_generation": 0,
                    "cancel_generation": 0,
                    "cancel_requested_at": None,
                }
                assert row["created_at"] is not None
                assert row["updated_at"] is not None

            await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
            async with engine.begin() as conn:
                table_names = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert "workflow_managed_execution" not in table_names
                assert "workflow_invocation" in table_names
        finally:
            await engine.dispose()
