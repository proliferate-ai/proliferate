"""WS3a — function-invocation semantic revisions (§7.2) + the WS3a migration.

Companion to ``test_workflow_capabilities.py`` (which owns the frozen-lease /
live-narrowing floor). This file pins:

- ``semantic_revision`` bumps on a semantic edit (endpoint/method/schema) but
  NOT on a secret-value-only header rotation, display-metadata edit, or a no-op
  re-save of identical values.
- The WS3a migration (b3d1f5a9c7e2) applies forward-only onto a populated
  pre-WS3a database and backfills existing rows to revision 1.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from alembic import command
from proliferate.db.migrations import build_alembic_config
from proliferate.db.store import function_invocations as invocations_store
from tests.postgres import temporary_database
from tests.unit.workflow_capability_helpers import make_user, seed_invocation

pytestmark = pytest.mark.asyncio

_PRE_WS3A_HEAD = "d9578c0275f3"
_WS3A_REVISION = "b3d1f5a9c7e2"


async def test_semantic_revision_bumps_on_semantic_edits_only(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    record = await seed_invocation(db_session, owner=user, name="fn_rev")
    assert record.semantic_revision == 1

    # Endpoint edit -> bump.
    record = await invocations_store.update(
        db_session,
        owner_user_id=user.id,
        name="fn_rev",
        endpoint_url="https://example.com/v2",
    )
    assert record is not None and record.semantic_revision == 2

    # Method + schema edits -> bump each.
    record = await invocations_store.update(
        db_session, owner_user_id=user.id, name="fn_rev", method="put"
    )
    assert record is not None and record.semantic_revision == 3
    record = await invocations_store.update(
        db_session,
        owner_user_id=user.id,
        name="fn_rev",
        args_schema_json={"type": "object", "properties": {"q": {"type": "string"}}},
    )
    assert record is not None and record.semantic_revision == 4

    # Secret rotation behind the same binding identity -> NO bump (§7.2).
    record = await invocations_store.rotate_headers(
        db_session, owner_user_id=user.id, name="fn_rev", headers={"x-api-key": "new"}
    )
    assert record is not None and record.semantic_revision == 4

    # Display metadata -> NO bump (not in the §7.2 bump list).
    record = await invocations_store.update(
        db_session,
        owner_user_id=user.id,
        name="fn_rev",
        display_name="Pretty Name",
        description="what it does",
    )
    assert record is not None and record.semantic_revision == 4

    # A no-op "edit" to the same values -> NO bump.
    record = await invocations_store.update(
        db_session,
        owner_user_id=user.id,
        name="fn_rev",
        endpoint_url="https://example.com/v2",
        method="put",
    )
    assert record is not None and record.semantic_revision == 4


async def test_ws3a_migration_applies_to_populated_pre_ws3a_database() -> None:
    """WS2a's populated-DB pattern applied to WS3a: upgrade a database stopped at
    the pre-WS3a head (d9578c0275f3), insert a live function invocation through
    the legacy columns, then upgrade to head — the row survives and backfills
    ``semantic_revision = 1`` via the server default."""

    async with temporary_database("ws3a_prefeature") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _PRE_WS3A_HEAD)

        engine = create_async_engine(database_url, echo=False)
        try:
            user_id = uuid.uuid4()
            invocation_id = uuid.uuid4()
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        'INSERT INTO "user" (id, email, hashed_password, is_active, '
                        "is_superuser, is_verified, created_at) "
                        "VALUES (:id, :email, 'x', true, false, true, now())"
                    ),
                    {"id": user_id, "email": f"pre-{uuid.uuid4().hex}@example.com"},
                )
                await conn.execute(
                    text(
                        "INSERT INTO function_invocation_definition (id, owner_user_id, "
                        "name, endpoint_url, method, args_schema_json, "
                        "chat_scope_enabled, created_at, updated_at) "
                        "VALUES (:id, :uid, 'legacy_fn', 'https://example.com/h', "
                        "'post', '{}', false, now(), now())"
                    ),
                    {"id": invocation_id, "uid": user_id},
                )

            await asyncio.to_thread(command.upgrade, config, "head")

            async with engine.connect() as conn:
                version_num = await conn.scalar(text("SELECT version_num FROM alembic_version"))
                assert version_num == _WS3A_REVISION
                revision = await conn.scalar(
                    text(
                        "SELECT semantic_revision FROM function_invocation_definition "
                        "WHERE id = :id"
                    ),
                    {"id": invocation_id},
                )
                assert revision == 1
        finally:
            await engine.dispose()
