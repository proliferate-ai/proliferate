"""Compatibility proofs for the removed Cloud worktree-retention policy."""

from __future__ import annotations

import importlib.util
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import event, inspect
from sqlalchemy.ext.asyncio import AsyncEngine

import proliferate.integrations.anyharness as anyharness_integration
from tests.integration.cloud_api_helpers import register_and_login

_TABLE = "cloud_worktree_retention_policy"
_PATH = "/v1/cloud/worktree-retention-policy"


@pytest.mark.asyncio
async def test_authenticated_removed_policy_routes_404_without_database_access(
    client: AsyncClient,
    test_engine: AsyncEngine,
) -> None:
    tokens = await register_and_login(
        client,
        f"removed-policy-{uuid.uuid4().hex[:8]}@example.com",
    )
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    statements: list[str] = []

    def _record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(test_engine.sync_engine, "before_cursor_execute", _record_statement)
    try:
        get_response = await client.get(_PATH, headers=headers)
        put_response = await client.put(
            _PATH,
            headers=headers,
            json={"maxMaterializedWorktreesPerRepo": 50},
        )
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", _record_statement)

    assert get_response.status_code == 404
    assert put_response.status_code == 404
    assert statements == []


def test_removed_policy_has_no_runtime_adapter() -> None:
    assert not hasattr(anyharness_integration, "run_runtime_worktree_retention")
    assert not hasattr(anyharness_integration, "update_runtime_worktree_retention_policy")
    assert importlib.util.find_spec("proliferate.integrations.anyharness.worktrees") is None


@pytest.mark.asyncio
async def test_migrated_policy_table_keeps_rollback_compatible_shape(
    test_engine: AsyncEngine,
) -> None:
    async with test_engine.connect() as connection:
        shape = await connection.run_sync(
            lambda sync_connection: {
                "columns": {
                    column["name"] for column in inspect(sync_connection).get_columns(_TABLE)
                },
                "primary_key": inspect(sync_connection).get_pk_constraint(_TABLE),
                "unique_constraints": inspect(sync_connection).get_unique_constraints(_TABLE),
                "check_constraints": inspect(sync_connection).get_check_constraints(_TABLE),
                "indexes": inspect(sync_connection).get_indexes(_TABLE),
            }
        )

    assert shape["columns"] == {
        "id",
        "user_id",
        "max_materialized_worktrees_per_repo",
        "created_at",
        "updated_at",
    }
    assert shape["primary_key"]["constrained_columns"] == ["id"]

    unique = next(
        constraint
        for constraint in shape["unique_constraints"]
        if constraint["name"] == "uq_cloud_worktree_retention_policy_user_id"
    )
    assert unique["column_names"] == ["user_id"]

    check = next(
        constraint
        for constraint in shape["check_constraints"]
        if constraint["name"] == "ck_cloud_worktree_retention_policy_limit"
    )
    check_sql = " ".join(check["sqltext"].replace("(", "").replace(")", "").split())
    assert "max_materialized_worktrees_per_repo >= 10" in check_sql
    assert "max_materialized_worktrees_per_repo <= 100" in check_sql

    user_index = next(
        index
        for index in shape["indexes"]
        if index["name"] == "ix_cloud_worktree_retention_policy_user_id"
    )
    assert user_index["column_names"] == ["user_id"]
    assert user_index["unique"] is False
